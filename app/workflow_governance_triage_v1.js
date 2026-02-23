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
 *   2a. Stop-loss gate — if candidate task.meta.stop_loss_triggered: abort, human_review_required
 *   3. Pop             — tasks:next <session_id> --no-stub --owner <owner>
 *   4. Execute         — openclaw:run <runtime_request.json>
 *   4a. Stop-loss gate — classify runResult; on REJECTED/BLOCKED/GATED/repair_fail:
 *                        call tasks:stop-loss, return ok:false next_action=human_review_required
 *   5. Retrieve        — artifacts:latest <session_id> --no-stub (1 retry)
 *   6. Output          — consolidated JSON
 *
 * Stop-loss trigger conditions (v1):
 *   - dispatch.state === 'REJECTED'                  → contract failed after repair exhausted
 *   - dispatch.state === 'BLOCKED'                   → gate keyword hard-blocked
 *   - dispatch.state === 'GATED'                     → governance required, stuck permanently
 *   - dispatch.repair_attempted && !repair_succeeded  → belt-and-suspenders
 *
 * Threshold gate:
 *   - If candidate task already has meta.stop_loss_triggered=true → abort before pop
 *     → ok:false, next_action: human_review_required
 *
 * Usage:
 *   node app/workflow_governance_triage_v1.js
 *     [--owner <agent>]       task owner (default: cos)
 *     [--session <id>]        use existing session instead of creating new
 *     [--dry-run]             steps 0-2 only, no state changes, shows WOULD-pop task
 *
 * Output: single JSON object on stdout.
 * Exit 0 = ok:true (task may be null if queue empty) OR ok:false (stop-loss).
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
    stopLoss: path.join(ROOT, 'app', 'tasks_stop_loss_cli_v1.js'),
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

// ── Helper: classify openclaw:run result for stop-loss ─────────────────────────
// Returns null if clean (ok to continue), or { failure_type, reason } if stop-loss needed.
//
// openclaw_cli_v1.js exits 0 for ALL terminal states (DISPATCHED/GATED/BLOCKED/REJECTED).
// We inspect the parsed JSON to classify the failure.
function classifyStopLoss(runResult) {
    if (!runResult) return { failure_type: 'MISSING_RESULT', reason: 'openclaw:run returned no parseable output' };

    const dispatch = runResult.dispatch || {};
    const state = dispatch.state;           // DISPATCHED | GATED | BLOCKED | REJECTED

    // REJECTED: contract validation failed both first-pass and repair
    if (state === 'REJECTED') {
        return {
            failure_type: 'REJECTED',
            reason: 'Contract validation failed (repair exhausted): ' + (dispatch.reason || 'no detail'),
        };
    }

    // BLOCKED: router gate keyword hard-stopped the request  
    if (state === 'BLOCKED') {
        return {
            failure_type: 'BLOCKED',
            reason: 'Gate decision blocked: ' + (dispatch.reason || 'no detail'),
        };
    }

    // GATED: governance required but not overridden — cannot proceed automatically
    if (state === 'GATED') {
        return {
            failure_type: 'GATED',
            reason: 'Governance gate held — manual approval required: ' + (dispatch.reason || 'no detail'),
        };
    }

    // Belt-and-suspenders: DISPATCHED but repair was attempted and failed
    // (repair_succeeded is false AND repair_attempted is true AND no artifact produced)
    if (state === 'DISPATCHED' && dispatch.repair_attempted === true && dispatch.repair_succeeded === false) {
        return {
            failure_type: 'REPAIR_FAILED',
            reason: 'Dispatch reached DISPATCHED but repair was needed and failed — no valid artifact produced',
        };
    }

    // DISPATCHED + repair not needed, or repair succeeded → clean
    return null;
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
let initRun = null;

if (sessionArg) {
    sessionId = sessionArg;
    sessionFromArg = true;
} else {
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
// STEP 2: Find oldest real TODO task (read-only peek)
// ─────────────────────────────────────────────────────────────────────────────
const oldestArgs = [CLI.tasksOldest, '--no-stub'];
if (sessionArg) {
    oldestArgs.push('--session', sessionId);
}

const step2 = runScript('tasks_oldest', oldestArgs, 10000);
if (!step2.ok) {
    fatal('tasks_oldest', step2.error || 'tasks:oldest failed', {
        stderr: step2.stderr,
    });
}

const candidateTask = step2.parsed && step2.parsed.task;

// ── Dry-run exits here ────────────────────────────────────────────────────────
if (dryRun) {
    // Peek at stop-loss status of candidate if it exists
    const dryRunStopLoss = candidateTask
        ? (candidateTask.meta && candidateTask.meta.stop_loss_triggered === true
            ? { stop_loss_triggered: true, stop_loss_reason: candidateTask.meta.stop_loss_reason, stop_loss_at: candidateTask.meta.stop_loss_at }
            : { stop_loss_triggered: false })
        : null;

    process.stdout.write(JSON.stringify({
        ok: true,
        dry_run: true,
        owner: ownerArg,
        session_id: sessionId,
        session_from_arg: sessionFromArg,
        would_pop_task: candidateTask,
        candidate_stop_loss: dryRunStopLoss,
        would_execute: candidateTask
            ? (dryRunStopLoss && dryRunStopLoss.stop_loss_triggered
                ? 'BLOCKED — stop_loss_triggered=true, human_review_required'
                : `openclaw:run <runtime_request> with session_id=${candidateTask.session_id}`)
            : 'nothing — no non-stub TODO task found',
        notes: [
            'Dry-run exits after step 2 (no state changes, no task pops)',
            '--no-stub enforced on tasks:oldest',
            'Stop-loss check shown but not enforced in dry-run (no pop occurs)',
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2a: STOP-LOSS THRESHOLD GATE — refuse re-execution of already-failed tasks
// ─────────────────────────────────────────────────────────────────────────────
const candidateMeta = candidateTask.meta || {};
if (candidateMeta.stop_loss_triggered === true) {
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'stop_loss_threshold_gate',
        error: 'STOP_LOSS_ALREADY_TRIGGERED: task has failed before and requires human review',
        task_id: candidateTask.id,
        session_id: candidateTask.session_id,
        owner: ownerArg,
        stop_loss: {
            triggered: true,
            reason: candidateMeta.stop_loss_reason,
            step: candidateMeta.stop_loss_step,
            at: candidateMeta.stop_loss_at,
            failure_type: candidateMeta.stop_loss_failure_type,
            run_id: candidateMeta.stop_loss_run_id,
        },
        next_action: 'human_review_required',
        notes: [
            'Task has stop_loss_triggered=true — triage refuses to re-execute automatically',
            'A human operator must review the task, clear the stop-loss flag, and re-queue',
            'To clear: manually update task meta_json.stop_loss_triggered=false and set status=todo',
        ],
    }, null, 2) + '\n');
    process.exit(0);   // exit 0 — this is an expected operational outcome not a crash
}

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
// ─────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

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
    session_id: workSessionId,
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

const runtimeFile = path.join(RUNTIME_DIR, `triage_${Date.now()}.json`);
fs.writeFileSync(runtimeFile, JSON.stringify(runtimeRequest, null, 2), 'utf8');

const step4 = runScript('openclaw_run_task', [
    CLI.run,
    runtimeFile,
], 90000);

// Clean temp file immediately — audit trail is in DB
try { fs.unlinkSync(runtimeFile); } catch (_) { /* ignore */ }

if (!step4.ok) {
    // Hard fail: spawn error or JSON parse error (not GATED/BLOCKED/REJECTED — those exit 0)
    fatal('openclaw_run_task', step4.error || 'openclaw:run failed on task', {
        task_id: poppedTask.id,
        session_id: workSessionId,
        detail: step4.parsed,
        stderr: step4.stderr,
    });
}
const runResult = step4.parsed;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4a: STOP-LOSS GATE — classify dispatch result
// openclaw:run exits 0 for GATED/BLOCKED/REJECTED — we must inspect the JSON
// ─────────────────────────────────────────────────────────────────────────────
const stopLossClassification = classifyStopLoss(runResult);

if (stopLossClassification !== null) {
    // Trigger stop-loss: call tasks:stop-loss CLI to update DB atomically
    const runId = runResult && runResult.run_id;
    const slReason = stopLossClassification.reason.slice(0, 240);

    const slArgs = [
        CLI.stopLoss,
        poppedTask.id,
        '--reason', slReason,
        '--step', 'openclaw_run_task',
        '--owner', ownerArg,
        '--session', workSessionId,
        '--failure-type', stopLossClassification.failure_type,
    ];
    if (runId) { slArgs.push('--run-id', runId); }

    const slResult = runScript('tasks_stop_loss', slArgs, 15000);

    // Build consolidated stop-loss output (exit 0 — this is an operational outcome)
    process.stdout.write(JSON.stringify({
        ok: false,
        step: 'stop_loss',
        task_id: poppedTask.id,
        session_id: workSessionId,
        owner: ownerArg,
        failure_summary: {
            failure_type: stopLossClassification.failure_type,
            reason: stopLossClassification.reason,
            dispatch_state: runResult && runResult.dispatch && runResult.dispatch.state,
            run_id: runId,
        },
        stop_loss_applied: slResult.ok,
        stop_loss_action_id: slResult.ok && slResult.parsed ? slResult.parsed.action_id : null,
        stop_loss_cli_error: !slResult.ok ? (slResult.error || null) : null,
        run: {
            status: runResult.status,
            run_id: runId,
            intent: runResult.route && runResult.route.intent,
            dispatch_state: runResult.dispatch && runResult.dispatch.state,
            agent: runResult.dispatch && runResult.dispatch.agent,
            repair_attempted: runResult.dispatch && runResult.dispatch.repair_attempted,
            repair_succeeded: runResult.dispatch && runResult.dispatch.repair_succeeded,
        },
        next_action: 'human_review_required',
        notes: [
            `Stop-loss triggered: ${stopLossClassification.failure_type}`,
            'Task marked blocked — will not auto-retry until stop-loss is manually cleared',
            'To remediate: review task in ledger, clear stop_loss_triggered flag, set status=todo',
        ],
    }, null, 2) + '\n');

    process.exit(0);   // exit 0 — operational outcome (not a crash)
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Retrieve artefact (non-stub, 1 retry)
// ─────────────────────────────────────────────────────────────────────────────
function fetchArtifact(sid) {
    return runScript('artifacts_latest_no_stub', [CLI.artifact, sid, '--no-stub'], 15000);
}

let step5a = fetchArtifact(workSessionId);

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
    triage_session_id: sessionId,
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
    stop_loss: null,   // null = clean run, no stop-loss triggered
    artifact: artifactResult ? artifactResult.artifact : null,
    artifact_attempts: artifactAttempts,
    artifact_retry_used: artifactRetryUsed,
    artifact_retry_delay_ms: ARTIFACT_RETRY_MS,
    notes: [
        '--no-stub enforced on tasks:oldest, tasks:next, and artifacts:latest',
        'Audit trail written by constituent CLIs (tasks:next, openclaw:run)',
        'Temp runtime request file written and immediately deleted after openclaw:run',
        'Stop-loss gate: clean run (no REJECTED/BLOCKED/GATED/REPAIR_FAILED)',
        artifactResult && artifactResult.artifact
            ? 'Artefact retrieved successfully'
            : 'artifact:null — dispatch artefacts carry [stub,dispatch] tags; use artifacts:latest SESSION_ID (no --no-stub) to retrieve content',
    ],
}, null, 2) + '\n');

process.exit(0);
