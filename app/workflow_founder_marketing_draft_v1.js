/**
 * OpenClaw — Founder Marketing Draft Workflow v1
 * -----------------------------------------------
 * Deterministic workflow runner for the Founder Mode marketing-draft sequence.
 * Chains three existing CLIs in order with --no-stub enforced:
 *
 *   1. openclaw:run  — requests/marketing_draft.json --founder --new-session
 *   2. artifacts:latest NEW_SESSION_ID --no-stub
 *   3. tasks:next    NEW_SESSION_ID --no-stub --owner cos
 *
 * Mirrors workflow_founder_sales_draft_v1.js exactly, differing only in the
 * request file and script identity. No direct DB writes — all audit writes
 * happen inside the called CLIs.
 *
 * Usage:
 *   node app/workflow_founder_marketing_draft_v1.js [--dry-run] [--owner <agent>] [--kimi-stub]
 *
 * Flags:
 *   --dry-run    Print the commands that would run, then exit (no DB writes, no LLM call).
 *   --owner <a>  Override the owner passed to tasks:next (default: cos).
 *   --kimi-stub  Force KIMI_MODE=stub for smoke-testing without a live API call.
 *
 * Output: single JSON object on stdout. Exit 0 = ok:true or task/artifact null.
 *         Exit 1 = any step failed.
 *
 * Deps: Node core (child_process, path), dotenv (already in project deps).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// ── Load .env so MOONSHOT_API_KEY and KIMI_MODE reach child processes ─────────
// dotenv.config() is a no-op if vars are already set in the shell environment,
// which is the correct override order: shell > .env.
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) {
    // dotenv not available — fall through, rely on ambient env
}

const ROOT = path.resolve(__dirname, '..');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const kimiStub = args.includes('--kimi-stub');

const ownerIdx = args.indexOf('--owner');
const ownerArg = (ownerIdx !== -1 && args[ownerIdx + 1] && !args[ownerIdx + 1].startsWith('--'))
    ? args[ownerIdx + 1]
    : 'cos';

// ── CLI paths (absolute — avoids cwd dependency) ──────────────────────────────
const CLI = {
    run: path.join(ROOT, 'app', 'openclaw_cli_v1.js'),
    artifact: path.join(ROOT, 'app', 'artifacts_latest_cli_v1.js'),
    task: path.join(ROOT, 'app', 'tasks_next_cli_v1.js'),
};

const REQUEST_FILE = path.join(ROOT, 'requests', 'marketing_draft.json');

// ── Derive child env ──────────────────────────────────────────────────────────
const childEnv = Object.assign({}, process.env);
if (kimiStub) {
    childEnv.KIMI_MODE = 'stub';
}

// ── Artifact retry config ─────────────────────────────────────────────────────
// Exactly one retry after ARTIFACT_RETRY_DELAY_MS if artifact is null.
// Atomics.wait is used for a synchronous, non-polling sleep that does not
// require timers, async/await, or any new dependencies.
const ARTIFACT_RETRY_DELAY_MS = 1000;

// ── Dry-run ───────────────────────────────────────────────────────────────────
if (dryRun) {
    const SESSION_PLACEHOLDER = '<NEW_SESSION_ID>';
    const cmds = [
        ['node', CLI.run, REQUEST_FILE, '--founder', '--new-session'],
        ['node', CLI.artifact, SESSION_PLACEHOLDER, '--no-stub'],
        ['node', CLI.task, SESSION_PLACEHOLDER, '--no-stub', '--owner', ownerArg],
    ];
    process.stdout.write(JSON.stringify({
        ok: true,
        dry_run: true,
        kimi_stub: kimiStub,
        owner: ownerArg,
        commands: cmds.map(c => c.join(' ')),
        notes: [
            '--no-stub enforced on artifacts:latest and tasks:next',
            'Audit trail written by constituent CLIs, not by this workflow',
            'Set KIMI_MODE=stub (or pass --kimi-stub) for no-API smoke-test',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ── Helper: run a CLI and return { ok, parsed, raw, stderr } ─────────────────
function runCLI(label, nodeArgs, timeoutMs) {
    timeoutMs = timeoutMs || 90000;   // 90 s default — real Kimi calls can take ~30 s

    const result = spawnSync(process.execPath, nodeArgs, {
        cwd: ROOT,
        env: childEnv,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,  // 4 MB
    });

    if (result.error) {
        return {
            ok: false,
            label,
            error: result.error.message,
            raw: null,
            parsed: null,
            stderr: null,
        };
    }

    const rawStdout = (result.stdout || '').trim();
    const rawStderr = (result.stderr || '').trim();

    let parsed = null;
    try {
        parsed = JSON.parse(rawStdout);
    } catch (_) {
        return {
            ok: false,
            label,
            error: 'JSON_PARSE_ERROR: stdout was not valid JSON',
            raw: rawStdout.slice(0, 500),
            parsed: null,
            stderr: rawStderr.slice(0, 500),
        };
    }

    if (result.status !== 0) {
        return {
            ok: false,
            label,
            error: `EXIT_CODE_${result.status}`,
            raw: rawStdout,
            parsed,
            stderr: rawStderr.slice(0, 500),
        };
    }

    return { ok: true, label, parsed, raw: rawStdout, stderr: rawStderr };
}

// ── Step 1: openclaw:run --founder --new-session ──────────────────────────────
const step1 = runCLI('openclaw_run', [
    CLI.run,
    REQUEST_FILE,
    '--founder',
    '--new-session',
], 90000);

if (!step1.ok) {
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'openclaw_run',
        error: step1.error,
        stderr: step1.stderr,
        raw: step1.raw,
    }, null, 2) + '\n');
    process.exit(1);
}

const runResult = step1.parsed;
const sessionId = runResult && runResult.session_id;

if (!sessionId) {
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'openclaw_run',
        error: 'MISSING_SESSION_ID: run step returned no session_id',
        parsed: runResult,
    }, null, 2) + '\n');
    process.exit(1);
}

// ── Step 2: artifacts:latest NEW_SESSION_ID --no-stub (1 retry on null) ──────
// Attempt 1
const step2a = runCLI('artifacts_latest_no_stub', [
    CLI.artifact,
    sessionId,
    '--no-stub',
], 15000);

if (!step2a.ok) {
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'artifacts_latest_no_stub',
        error: step2a.error,
        session_id: sessionId,
        stderr: step2a.stderr,
    }, null, 2) + '\n');
    process.exit(1);
}

let artifactResult = step2a.parsed;
let artifactAttempts = 1;
let artifactRetryUsed = false;

// Attempt 2 — only if attempt 1 returned artifact:null
// Atomics.wait blocks this thread for exactly ARTIFACT_RETRY_DELAY_MS with no
// polling or event-loop involvement. SharedArrayBuffer requires no extra deps.
if (!artifactResult || !artifactResult.artifact) {
    Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0, 0,
        ARTIFACT_RETRY_DELAY_MS
    );
    const step2b = runCLI('artifacts_latest_no_stub_retry', [
        CLI.artifact,
        sessionId,
        '--no-stub',
    ], 15000);
    artifactAttempts = 2;
    artifactRetryUsed = true;
    // Use retry result if it parsed cleanly; otherwise keep null from attempt 1
    if (step2b.ok) {
        artifactResult = step2b.parsed;
    }
}

// ── Step 3: tasks:next NEW_SESSION_ID --no-stub --owner cos ──────────────────
const step3 = runCLI('tasks_next_no_stub', [
    CLI.task,
    sessionId,
    '--no-stub',
    '--owner', ownerArg,
], 15000);

if (!step3.ok) {
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'tasks_next_no_stub',
        error: step3.error,
        session_id: sessionId,
        artifact: artifactResult ? artifactResult.artifact : null,
        stderr: step3.stderr,
    }, null, 2) + '\n');
    process.exit(1);
}

const taskResult = step3.parsed;

// ── Consolidated output ───────────────────────────────────────────────────────
const output = {
    ok: true,
    session_id: sessionId,
    kimi_stub: kimiStub,
    run: {
        status: runResult.status,
        run_id: runResult.run_id,
        intent: runResult.route && runResult.route.intent,
        dispatch_state: runResult.dispatch && runResult.dispatch.state,
        agent: runResult.dispatch && runResult.dispatch.agent,
        artifact_id: runResult.dispatch && runResult.dispatch.artifact_id,
        founder_bypass: runResult.dispatch && runResult.dispatch.governance_bypassed,
        repair_attempted: runResult.dispatch && runResult.dispatch.repair_attempted,
        repair_succeeded: runResult.dispatch && runResult.dispatch.repair_succeeded,
        ledger_error: runResult.dispatch && runResult.dispatch.ledger_error,
    },
    artifact: artifactResult ? artifactResult.artifact : null,
    artifact_attempts: artifactAttempts,
    artifact_retry_used: artifactRetryUsed,
    artifact_retry_delay_ms: ARTIFACT_RETRY_DELAY_MS,
    task: taskResult ? taskResult.task : null,
    task_audit: taskResult ? {
        task_update_action_id: taskResult.task_update_action_id,
        task_next_action_id: taskResult.task_next_action_id,
    } : null,
    notes: [
        '--no-stub enforced on artifacts:latest and tasks:next',
        'Audit trail written by constituent CLIs, not by this workflow script',
        'artifact:null means no non-stub artifact exists for this session',
        'task:null means no non-stub todo task existed in the queue',
        kimiStub
            ? 'KIMI_MODE=stub was active — no live LLM call made'
            : 'KIMI_MODE=real — live Kimi API call executed',
    ],
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(0);
