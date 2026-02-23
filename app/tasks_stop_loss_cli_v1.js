/**
 * OpenClaw — Tasks Stop-Loss CLI v1
 * ------------------------------------
 * Marks a task as blocked due to a stop-loss trigger and writes a dedicated
 * `stop_loss` audit action. Called by workflow:governance-triage when execution
 * fails and human review is required.
 *
 * Tasks:update cannot do this cleanly:
 *   - It hardcodes action type=task_update; stop-loss needs type=stop_loss.
 *   - It cannot inject the structured stop-loss meta block atomically.
 *   - It has no semantic gate for "already stop-lossed" tasks.
 *
 * Usage:
 *   node app/tasks_stop_loss_cli_v1.js <task_id>
 *     --reason   "<text>"       short failure reason (max 240 chars, required)
 *     --step     "<step>"       which workflow step failed (required)
 *     --owner    <agent>        default: cos
 *     --session  <session_id>   override session (else inferred from task row)
 *     [--run-id  <run_id>]      run_id at point of failure (optional)
 *     [--failure-type <type>]   GATED|BLOCKED|REJECTED|REPAIR_FAILED (optional, for meta)
 *
 * Guard: if task.meta_json.stop_loss_triggered is already true → exit 1 (already triggered).
 *
 * Writes (single atomic transaction):
 *   1. UPDATE tasks SET status='blocked', meta_json=<merged stop-loss block>
 *   2. INSERT INTO actions type='stop_loss', status='ok'
 *
 * Output: JSON only (stdout). Errors: JSON stderr.
 * Exit 0 = OK (stop-loss applied). Exit 1 = error/guard/not-found.
 *
 * Deps: better-sqlite3 (already in project). No new deps.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const helpFlag = args.includes('--help') || args.includes('-h');

const HELP = {
    usage: 'node app/tasks_stop_loss_cli_v1.js <task_id> --reason "<text>" --step "<step>" [--owner <agent>] [--session <id>] [--run-id <id>] [--failure-type <type>]',
    flags: {
        '--reason <text>': 'Short failure reason (required, max 240 chars)',
        '--step <step>': 'Workflow step where failure occurred (required)',
        '--owner <agent>': 'default: cos',
        '--session <id>': 'Override session_id for audit row (else inferred)',
        '--run-id <id>': 'run_id at point of failure (optional)',
        '--failure-type <type>': 'GATED|BLOCKED|REJECTED|REPAIR_FAILED (optional)',
    },
    guard: 'If task.meta.stop_loss_triggered=true already: exits 1 (ALREADY_TRIGGERED).',
    exit_codes: { 0: 'Stop-loss applied', 1: 'Error / guard / not found' },
};

if (helpFlag) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
    process.exit(0);
}

// ── Positional: task_id ───────────────────────────────────────────────────────
const taskId = args.find(a => !a.startsWith('-'));
if (!taskId) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'Missing required argument: <task_id>', usage: HELP.usage }) + '\n');
    process.exit(1);
}

// ── Flag parser ───────────────────────────────────────────────────────────────
function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const reason = flagVal('--reason');
const step = flagVal('--step');
const owner = flagVal('--owner') || 'cos';
const sessionArg = flagVal('--session') || null;
const runId = flagVal('--run-id') || null;
const failureType = flagVal('--failure-type') || null;

// ── Validate ──────────────────────────────────────────────────────────────────
const validationErrors = [];

if (!reason || reason.trim().length === 0) {
    validationErrors.push('--reason is required and must be non-empty');
}
if (reason && reason.length > 240) {
    validationErrors.push(`--reason must be ≤ 240 chars (got ${reason.length})`);
}
if (!step || step.trim().length === 0) {
    validationErrors.push('--step is required and must be non-empty');
}
if (owner.length > 40) {
    validationErrors.push(`--owner must be ≤ 40 chars (got ${owner.length})`);
}

if (validationErrors.length > 0) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'VALIDATION_FAILED', details: validationErrors }) + '\n');
    process.exit(1);
}

const trimmedReason = reason.trim();
const trimmedStep = step.trim();

// ── Open DB ────────────────────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Fetch task ────────────────────────────────────────────────────────────────
let existing;
try {
    existing = db.prepare(
        'SELECT id, session_id, created_at, owner_agent, status, title, details, meta_json ' +
        'FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

if (!existing) {
    db.close();
    process.stdout.write(JSON.stringify({ ok: false, error: 'NOT_FOUND', task_id: taskId }) + '\n');
    process.exit(1);
}

// ── Guard: already stop-lossed? ───────────────────────────────────────────────
let existingMeta = {};
try { existingMeta = JSON.parse(existing.meta_json || '{}'); } catch (_) { /* start clean */ }

if (existingMeta.stop_loss_triggered === true) {
    db.close();
    process.stdout.write(JSON.stringify({
        ok: false,
        error: 'ALREADY_TRIGGERED: stop_loss_triggered=true already on this task',
        task_id: taskId,
        status: existing.status,
        stop_loss_at: existingMeta.stop_loss_at,
        stop_loss_reason: existingMeta.stop_loss_reason,
    }) + '\n');
    process.exit(1);
}

// ── Build stop-loss metadata block ────────────────────────────────────────────
const now = new Date().toISOString();
const resolvedSessionId = sessionArg || existing.session_id || 'openclaw_ops';

const newMeta = Object.assign({}, existingMeta, {
    stop_loss_triggered: true,
    stop_loss_reason: trimmedReason,
    stop_loss_step: trimmedStep,
    stop_loss_at: now,
    stop_loss_owner: owner,
    stop_loss_run_id: runId,
    stop_loss_failure_type: failureType,
    updated_at: now,
});
const newMetaJson = JSON.stringify(newMeta);

// ── Action row ─────────────────────────────────────────────────────────────────
const actionId = 'stop_loss_' + Date.now();
const reasonTrunc = trimmedReason.length > 80 ? trimmedReason.slice(0, 77) + '...' : trimmedReason;
const actionReason = [
    `task_id=${taskId}`,
    `session_id=${resolvedSessionId}`,
    `step=${trimmedStep}`,
    failureType ? `failure_type=${failureType}` : null,
    `reason="${reasonTrunc}"`,
].filter(Boolean).join('; ');

const actionMeta = JSON.stringify({
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    run_id: runId,
    failure_type: failureType,
    step: trimmedStep,
    reason: trimmedReason,
    before: { status: existing.status, owner_agent: existing.owner_agent },
    after: { status: 'blocked', owner_agent: owner },
});

// ── Snapshot 'before' ─────────────────────────────────────────────────────────
const beforeSnapshot = {
    status: existing.status,
    owner_agent: existing.owner_agent,
    meta: existingMeta,
};

// ── Atomic transaction: UPDATE + INSERT action ────────────────────────────────
try {
    db.transaction(() => {
        // 1. Mark task blocked + attach stop-loss meta
        db.prepare(
            'UPDATE tasks SET status = ?, owner_agent = ?, meta_json = ? WHERE id = ?'
        ).run('blocked', owner, newMetaJson, taskId);

        // 2. Audit action: stop_loss
        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: actionId,
            session_id: resolvedSessionId,
            ts: now,
            actor: 'ops',
            type: 'stop_loss',
            input_ref: runId || null,
            output_ref: null,
            status: 'ok',
            reason: actionReason,
            meta_json: actionMeta,
        });
    })();
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_WRITE_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Re-fetch to confirm ───────────────────────────────────────────────────────
let updated;
try {
    updated = db.prepare(
        'SELECT id, session_id, status, owner_agent, meta_json FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_REFETCH_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}
db.close();

const updatedMeta = (() => { try { return JSON.parse(updated.meta_json || '{}'); } catch (_) { return {}; } })();

const afterSnapshot = {
    status: updated.status,
    owner_agent: updated.owner_agent,
    stop_loss_triggered: updatedMeta.stop_loss_triggered,
    stop_loss_reason: updatedMeta.stop_loss_reason,
    stop_loss_step: updatedMeta.stop_loss_step,
    stop_loss_at: updatedMeta.stop_loss_at,
    stop_loss_owner: updatedMeta.stop_loss_owner,
    stop_loss_run_id: updatedMeta.stop_loss_run_id,
    stop_loss_failure_type: updatedMeta.stop_loss_failure_type,
};

// ── Output ────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    run_id: runId,
    before: beforeSnapshot,
    after: afterSnapshot,
    action_id: actionId,
    notes: [
        'Task transitioned to blocked in a single atomic transaction',
        'Action type: stop_loss (distinct from task_update)',
        'human_review_required: task cannot be re-queued until stop-loss is cleared',
    ],
}, null, 2) + '\n');
process.exit(0);
