/**
 * OpenClaw — Governance Triage Workflow v1
 * ------------------------------------------
 * Execution loop (one iteration): pop the oldest real TODO task, run OpenClaw
 * on it deterministically, retrieve the artefact, and emit a consolidated JSON.
 *
 * This is the first "execution" workflow (vs draft-only). It calls existing CLIs
 * only — no direct DB writes.
 *
 * Flow:
 *   0. Preflight       — workflow:runbook-check
 *   1. Session         — use --session if supplied, else init via openclaw:run
 *   2. Find work       — tasks:oldest --no-stub [--session <id>]
 *   3. Pop             — tasks:next <session_id> --no-stub --owner <owner>
 *   4. Execute         — openclaw:run <runtime_request.json>
 *   5. Retrieve        — artifacts:latest <session_id> --no-stub (1 retry)
 *   6. Output          — consolidated JSON
 *
 * Usage:
 *   node app/workflow_governance_triage_v1.js
 *     [--owner <agent>]       task owner (default: cos)
 *     [--session <id>]        use existing session instead of creating new
 *     [--dry-run]             steps 0-2 only, no state changes, shows WOULD-pop task
 *
 * Output: single JSON object on stdout.
 * Exit 0 = ok:true (task may be null if queue empty).
 * Exit 1 = hard failure (preflight, CLI error, etc.).
 *
 * Deps: Node core (child_process, path, fs), dotenv (already in project).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) { /* fall through */ }

const ROOT = path.resolve(__dirname, '..');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const ownerArg = flagVal('--owner') || 'cos';
const sessionArg = flagVal('--session') || null;

// ── CLI paths ─────────────────────────────────────────────────────────────────
const CLI = {
    preflightScript: path.join(ROOT, 'app', 'workflow_runbook_check_v1.js'),
    run: path.join(ROOT, 'app', 'openclaw_cli_v1.js'),
    tasksOldest: path.join(ROOT, 'app', 'tasks_oldest_cli_v1.js'),
    tasksNext: path.join(ROOT, 'app', 'tasks_next_cli_v1.js'),
    artifact: path.join(ROOT, 'app', 'artifacts_latest_cli_v1.js'),
};

const INIT_REQUEST_FILE = path.join(ROOT, 'requests', 'governance_triage.json');
const RUNTIME_DIR = path.join(ROOT, 'requests', '_runtime');
const ARTIFACT_RETRY_MS = 1000;

// ── Child env ─────────────────────────────────────────────────────────────────
const childEnv = Object.assign({}, process.env);

// ── Helper: spawnSync a node script and return structured result ───────────────
function runScript(label, nodeArgs, timeoutMs) {
    timeoutMs = timeoutMs || 60000;

    const result = spawnSync(process.execPath, nodeArgs, {
        cwd: ROOT,
        env: childEnv,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
    });

    if (result.error) {
        return { ok: false, label, error: `SPAWN_ERROR: ${result.error.message}`, parsed: null, raw: null, stderr: null };
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
            raw: rawStdout.slice(0, 600),
            parsed: null,
            stderr: rawStderr.slice(0, 300),
        };
    }

    if (result.status !== 0) {
        return {
            ok: false,
            label,
            error: `EXIT_CODE_${result.status}`,
            parsed,
            raw: rawStdout,
            stderr: rawStderr.slice(0, 300),
        };
    }

    return { ok: true, label, parsed, raw: rawStdout, stderr: rawStderr };
}

// ── Helper: fatal exit ────────────────────────────────────────────────────────
function fatal(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, step, error }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(1);
}

// ── Helper: synchronous sleep (Atomics.wait — no polling, no event loop) ──────
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0: Preflight
// ─────────────────────────────────────────────────────────────────────────────
const preflight = runScript('preflight', [CLI.preflightScript], 60000);
if (!preflight.ok || !preflight.parsed || preflight.parsed.ok !== true) {
    fatal('preflight', 'PREFLIGHT_FAILED: workflow:runbook-check did not return ok:true', {
        detail: preflight.parsed || preflight.raw,
        stderr: preflight.stderr,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Session
// ─────────────────────────────────────────────────────────────────────────────
let sessionId;
let sessionFromArg = false;
let initRun = null;  // populated if we created a new session via openclaw:run

if (sessionArg) {
    // Use provided session — skip openclaw:run init
    sessionId = sessionArg;
    sessionFromArg = true;
} else {
    // Create a new triage session via openclaw:run (no --founder — this is governance work)
    const step1 = runScript('triage_session_init', [
        CLI.run,
        INIT_REQUEST_FILE,
        '--new-session',
    ], 90000);

    if (!step1.ok) {
        fatal('triage_session_init', step1.error || 'openclaw:run failed', {
            detail: step1.parsed,
            stderr: step1.stderr,
        });
    }

    sessionId = step1.parsed && step1.parsed.session_id;
    if (!sessionId) {
        fatal('triage_session_init', 'MISSING_SESSION_ID: openclaw:run returned no session_id', {
            parsed: step1.parsed,
        });
    }
    initRun = step1.parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Find oldest real TODO task
// tasks:oldest --no-stub [--session <id>] — read-only, no state change
// ─────────────────────────────────────────────────────────────────────────────
const oldestArgs = [CLI.tasksOldest, '--no-stub'];
if (sessionArg) {
    // Session-scoped: only look within the provided session
    oldestArgs.push('--session', sessionId);
}
// Without --session: peeks across ALL sessions to find any pending TODO

const step2 = runScript('tasks_oldest', oldestArgs, 10000);
if (!step2.ok) {
    fatal('tasks_oldest', step2.error || 'tasks:oldest failed', {
        stderr: step2.stderr,
    });
}

const candidateTask = step2.parsed && step2.parsed.task;

// ── Dry-run exits here after showing what would be popped ─────────────────────
if (dryRun) {
    process.stdout.write(JSON.stringify({
        ok: true,
        dry_run: true,
        owner: ownerArg,
        session_id: sessionId,
        session_from_arg: sessionFromArg,
        would_pop_task: candidateTask,
        would_execute: candidateTask
            ? `openclaw:run <runtime_request> with session_id=${candidateTask.session_id}`
            : 'nothing — no non-stub TODO task found',
        notes: [
            'Dry-run exits after step 2 (no state changes, no task pops)',
            '--no-stub enforced on tasks:oldest',
            'To execute: re-run without --dry-run',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ── No work available ─────────────────────────────────────────────────────────
if (!candidateTask) {
    process.stdout.write(JSON.stringify({
        ok: true,
        owner: ownerArg,
        session_id: sessionId,
        task: null,
        run: null,
        artifact: null,
        artifact_attempts: 0,
        notes: [
            'No non-stub TODO task found — queue is empty or all tasks are stub/doing/done',
            '--no-stub enforced on tasks:oldest',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// The task to pop may belong to a DIFFERENT session than our triage init session.
// tasks:next is session-scoped — we use the CANDIDATE task's session_id.
const workSessionId = candidateTask.session_id;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Pop the task (tasks:next — writes audit trail)
// ─────────────────────────────────────────────────────────────────────────────
const step3 = runScript('tasks_next_no_stub', [
    CLI.tasksNext,
    workSessionId,
    '--no-stub',
    '--owner', ownerArg,
], 15000);

if (!step3.ok) {
    fatal('tasks_next', step3.error || 'tasks:next failed', {
        session_id: workSessionId,
        candidate: candidateTask.id,
        stderr: step3.stderr,
    });
}

const taskResult = step3.parsed;
const poppedTask = taskResult && taskResult.task;

// tasks:next is session-scoped AND first-match — it's possible another process
// claimed the task between our peek and pop (unlikely but safe to guard).
if (!poppedTask) {
    process.stdout.write(JSON.stringify({
        ok: true,
        owner: ownerArg,
        session_id: workSessionId,
        task: null,
        run: null,
        artifact: null,
        artifact_attempts: 0,
        notes: [
            'tasks:oldest found a candidate but tasks:next returned null — task may have been claimed by another pop',
            '--no-stub enforced',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Execute the task via openclaw:run
//
// openclaw_cli_v1.js reads a JSON file — it does NOT accept --session.
// We write a runtime request file with session_id injected from the popped task.
// Written to requests/_runtime/ which is gitignored.
// ─────────────────────────────────────────────────────────────────────────────

// Ensure runtime dir exists
if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

// Build user_goal from task payload
// Uses 'checklist' to target OPS_INTERNAL (router keyword 'checklist')
// OPS_INTERNAL has governance_required=true so it will be GATED unless override.
// For governance triage the correct intent is GOVERNANCE_REVIEW (audit/review keywords).
// We phrase the goal to match GOVERNANCE_REVIEW deterministically.
const taskGoal = [
    `Audit and review this governance task: "${poppedTask.title}".`,
    poppedTask.details ? `Details: ${poppedTask.details}.` : '',
    'Produce a single structured artefact that resolves this item.',
    'Draft-only output. No external publishing, no execution of forbidden actions.',
].filter(Boolean).join(' ');

const runtimeRequest = {
    request_id: 'req_triage_exec_' + poppedTask.id.slice(-8) + '_' + Date.now(),
    ts: new Date().toISOString(),
    initiator: 'system',
    session_id: workSessionId,    // Pin to the task's session so artifacts/actions link correctly
    user_goal: taskGoal,
    constraints: {
        no_public_exposure: true,
        structured_outputs_only: true,
        on_demand_only: true,
        task_id: poppedTask.id,
    },
    risk_flags: {
        external_comms: false,
    },
    context: {
        audience: 'internal_ops',
        channel: 'governance_triage',
        task_id: poppedTask.id,
        task_title: poppedTask.title,
        source: 'workflow_governance_triage_v1',
    },
};

// Write temp file — safe because requests/_runtime/ is gitignored
const runtimeFile = path.join(RUNTIME_DIR, `triage_${Date.now()}.json`);
fs.writeFileSync(runtimeFile, JSON.stringify(runtimeRequest, null, 2), 'utf8');

const step4 = runScript('openclaw_run_task', [
    CLI.run,
    runtimeFile,
    // No --founder (governance triage is not a founder-mode bypass flow)
    // Session is injected into the JSON file above
], 90000);

// Clean up temp file immediately after run — audit trail is in the DB
try { fs.unlinkSync(runtimeFile); } catch (_) { /* ignore */ }

if (!step4.ok) {
    fatal('openclaw_run_task', step4.error || 'openclaw:run failed on task', {
        task_id: poppedTask.id,
        session_id: workSessionId,
        detail: step4.parsed,
        stderr: step4.stderr,
    });
}
const runResult = step4.parsed;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Retrieve artefact (non-stub, 1 retry)
// ─────────────────────────────────────────────────────────────────────────────
function fetchArtifact(sid) {
    return runScript('artifacts_latest_no_stub', [CLI.artifact, sid, '--no-stub'], 15000);
}

let step5a = fetchArtifact(workSessionId);

// Hard fail only on CLI-level error (spawnError, parse error) — not on null result
if (!step5a.ok) {
    fatal('artifacts_latest', step5a.error, {
        session_id: workSessionId,
        stderr: step5a.stderr,
    });
}

let artifactResult = step5a.parsed;
let artifactAttempts = 1;
let artifactRetryUsed = false;

if (!artifactResult || !artifactResult.artifact) {
    sleepMs(ARTIFACT_RETRY_MS);
    const step5b = fetchArtifact(workSessionId);
    artifactAttempts = 2;
    artifactRetryUsed = true;
    if (step5b.ok) { artifactResult = step5b.parsed; }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: Consolidated output
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    owner: ownerArg,
    session_id: workSessionId,
    triage_session_id: sessionId,        // session created for this triage run
    task: poppedTask,
    task_audit: {
        task_update_action_id: taskResult.task_update_action_id,
        task_next_action_id: taskResult.task_next_action_id,
    },
    run: {
        status: runResult.status,
        run_id: runResult.run_id,
        intent: runResult.route && runResult.route.intent,
        dispatch_state: runResult.dispatch && runResult.dispatch.state,
        agent: runResult.dispatch && runResult.dispatch.agent,
        artifact_id: runResult.dispatch && runResult.dispatch.artifact_id,
        repair_attempted: runResult.dispatch && runResult.dispatch.repair_attempted,
        repair_succeeded: runResult.dispatch && runResult.dispatch.repair_succeeded,
        ledger_error: runResult.dispatch && runResult.dispatch.ledger_error,
    },
    artifact: artifactResult ? artifactResult.artifact : null,
    artifact_attempts: artifactAttempts,
    artifact_retry_used: artifactRetryUsed,
    artifact_retry_delay_ms: ARTIFACT_RETRY_MS,
    notes: [
        '--no-stub enforced on tasks:oldest, tasks:next, and artifacts:latest',
        'Audit trail written by constituent CLIs (tasks:next, openclaw:run)',
        'Temp runtime request file written and immediately deleted after openclaw:run',
        artifactResult && artifactResult.artifact
            ? 'Artefact retrieved successfully'
            : 'artifact:null — dispatch artefacts carry [stub,dispatch] tags; use artifacts:latest SESSION_ID (no --no-stub) to retrieve content',
    ],
}, null, 2) + '\n');

process.exit(0);
