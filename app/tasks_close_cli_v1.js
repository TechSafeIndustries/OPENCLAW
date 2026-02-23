/**
 * OpenClaw — Tasks Close CLI v1
 * --------------------------------
 * Close a single task: guard → update → audit action. Atomic transaction.
 *
 * Purpose: dedicated `task_close` action type + closure metadata block that
 * tasks:update cannot produce (it hardcodes type=task_update and cannot inject
 * close_reason/closed_by/closed_at/closed_artifact_id as a structured block).
 *
 * Usage:
 *   node app/tasks_close_cli_v1.js <task_id>
 *     --reason "<text>"              required, max 240 chars
 *     [--owner  <agent>]             default: cos
 *     [--artifact <artifact_id>]     optional: link closure to producing artefact
 *     [--session <session_id>]       optional: override session (else inferred from task row)
 *
 * Guard: task must have status = 'doing'. Any other status → ok:false, exit 1.
 *
 * Writes (single atomic transaction):
 *   1. UPDATE tasks SET status='done', meta_json=<merged> WHERE id = ?
 *   2. INSERT INTO actions ... type='task_close'
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK, 1 error/guard-failed/not-found.
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
    usage: 'node app/tasks_close_cli_v1.js <task_id> --reason "<text>" [--owner <agent>] [--artifact <id>] [--session <id>]',
    flags: {
        '--reason <text>': 'Closure reason (required, max 240 chars)',
        '--owner <agent>': 'Closed-by owner (default: cos)',
        '--artifact <id>': 'Artifact ID linked to this closure (optional)',
        '--session <id>': 'Override session_id for action row (else inferred from task row)',
    },
    guard: 'Task must have status="doing". Anything else causes exit 1.',
    exit_codes: { 0: 'OK — task closed', 1: 'Error / guard failed / not found' },
};

if (helpFlag) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
    process.exit(0);
}

// ── task_id: first positional arg ────────────────────────────────────────────
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
const owner = flagVal('--owner') || 'cos';
const artifactId = flagVal('--artifact') || null;
const sessionArg = flagVal('--session') || null;

// ── Validate ──────────────────────────────────────────────────────────────────
const validationErrors = [];

if (!reason || reason.trim().length === 0) {
    validationErrors.push('--reason is required and must be non-empty');
}
if (reason && reason.length > 240) {
    validationErrors.push(`--reason must be ≤ 240 chars (got ${reason.length})`);
}
if (owner.length > 40) {
    validationErrors.push(`--owner must be ≤ 40 chars (got ${owner.length})`);
}

if (validationErrors.length > 0) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'VALIDATION_FAILED', details: validationErrors }) + '\n');
    process.exit(1);
}

const trimmedReason = reason.trim();

// ── Open DB (read-write) ──────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Fetch existing task ───────────────────────────────────────────────────────
let existing;
try {
    existing = db.prepare(
        'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
        '       title, details, dependencies_json, meta_json ' +
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

// ── Guard: must be 'doing' ────────────────────────────────────────────────────
if (existing.status !== 'doing') {
    db.close();
    process.stdout.write(JSON.stringify({
        ok: false,
        error: `STATUS_GUARD_FAILED: task must be status="doing" to close (current status: "${existing.status}")`,
        task_id: taskId,
        status: existing.status,
        hint: existing.status === 'todo'
            ? 'Run tasks:next first to pop this task to "doing"'
            : existing.status === 'done'
                ? 'Task is already closed'
                : 'Task is blocked — resolve the block before closing',
    }) + '\n');
    process.exit(1);
}

// ── Build closure metadata ────────────────────────────────────────────────────
const now = new Date().toISOString();

let existingMeta = {};
try { existingMeta = JSON.parse(existing.meta_json || '{}'); } catch (_) { /* start fresh */ }

const resolvedSessionId = sessionArg || existing.session_id || 'openclaw_ops';

const newMeta = Object.assign({}, existingMeta, {
    close_reason: trimmedReason,
    closed_by: owner,
    closed_at: now,
    closed_artifact_id: artifactId,       // null if not provided — explicit null is fine
    closed_session_id: resolvedSessionId,
    updated_at: now,
});
const newMetaJson = JSON.stringify(newMeta);

// ── Action row ────────────────────────────────────────────────────────────────
const actionId = 'task_close_' + Date.now();
const reasonTrunc = trimmedReason.length > 80 ? trimmedReason.slice(0, 77) + '...' : trimmedReason;
const actionReason = [
    `task_id=${taskId}`,
    `owner=${owner}`,
    artifactId ? `artifact_id=${artifactId}` : null,
    `reason="${reasonTrunc}"`,
].filter(Boolean).join('; ');

const actionMeta = JSON.stringify({
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    artifact_id: artifactId,
    close_reason: trimmedReason,
    before: { status: existing.status, owner_agent: existing.owner_agent },
    after: { status: 'done', owner_agent: owner },
});

// ── Snapshot 'before' for output ──────────────────────────────────────────────
const beforeSnapshot = {
    status: existing.status,
    owner_agent: existing.owner_agent,
    meta: existingMeta,
};

// ── Single atomic transaction: UPDATE + INSERT action ─────────────────────────
try {
    db.transaction(() => {
        // 1. Close the task
        db.prepare(
            'UPDATE tasks SET status = ?, owner_agent = ?, meta_json = ? WHERE id = ?'
        ).run('done', owner, newMetaJson, taskId);

        // 2. Audit action: task_close
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
            type: 'task_close',
            input_ref: artifactId || null,
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
    close_reason: updatedMeta.close_reason,
    closed_by: updatedMeta.closed_by,
    closed_at: updatedMeta.closed_at,
    closed_artifact_id: updatedMeta.closed_artifact_id,
    closed_session_id: updatedMeta.closed_session_id,
};

// ── Deterministic JSON output ─────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    artifact_id: artifactId,
    before: beforeSnapshot,
    after: afterSnapshot,
    action_id: actionId,
    notes: [
        'Task transitioned doing → done in a single atomic transaction',
        'Action type: task_close (distinct from task_update)',
        artifactId ? `Closure linked to artifact_id: ${artifactId}` : 'No artifact_id linked',
    ],
}, null, 2) + '\n');
process.exit(0);
