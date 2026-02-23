/**
 * OpenClaw — Tasks Update CLI v1
 * --------------------------------
 * Patch a task row and write an audit action record.
 *
 * Usage:
 *   node app/tasks_update_cli_v1.js <task_id>
 *     [--status todo|doing|done|blocked]
 *     [--owner <owner_agent>]
 *     [--due <ISO8601>]
 *     [--title <text>]
 *     [--details <text>]
 *     [--run <run_id>]
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK, 1 error/not-found/validation.
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
    usage: 'node app/tasks_update_cli_v1.js <task_id> [--status todo|doing|done|blocked] [--owner <agent>] [--due <ISO8601>] [--title <text>] [--details <text>] [--run <run_id>]',
    flags: {
        '--status <s>': 'New status: todo, doing, done, blocked',
        '--owner <s>': 'New owner_agent (max 40 chars)',
        '--due <ISO>': 'New due_at as ISO 8601 string',
        '--title <s>': 'New title (max 120 chars)',
        '--details <s>': 'New details (max 1000 chars)',
        '--run <s>': 'run_id to record in meta_json and action audit row',
    },
    exit_codes: { 0: 'OK', 1: 'Error / not found / validation failure' },
};

if (helpFlag) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
    process.exit(0);
}

// task_id is first positional arg not starting with '-'
const taskId = args.find(a => !a.startsWith('-'));

if (!taskId) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'Missing required argument: <task_id>', usage: HELP.usage }) + '\n');
    process.exit(1);
}

// ── Flag parser ───────────────────────────────────────────────────────────────
function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;          // undefined = not provided
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const newStatus = flagVal('--status');
const newOwner = flagVal('--owner');
const newDue = flagVal('--due');
const newTitle = flagVal('--title');
const newDetails = flagVal('--details');
const runId = flagVal('--run');

// ── Validate provided values ──────────────────────────────────────────────────
const VALID_STATUSES = new Set(['todo', 'doing', 'done', 'blocked']);
const errors = [];

if (newStatus !== undefined && newStatus !== null && !VALID_STATUSES.has(newStatus)) {
    errors.push(`--status must be one of: ${[...VALID_STATUSES].join(', ')} (got "${newStatus}")`);
}
if (newDue !== undefined && newDue !== null && isNaN(Date.parse(newDue))) {
    errors.push(`--due must be a valid ISO 8601 date string (got "${newDue}")`);
}
if (newTitle !== undefined && newTitle !== null && newTitle.length > 120) {
    errors.push(`--title must be ≤ 120 chars (got ${newTitle.length})`);
}
if (newOwner !== undefined && newOwner !== null && newOwner.length > 40) {
    errors.push(`--owner must be ≤ 40 chars (got ${newOwner.length})`);
}
if (newDetails !== undefined && newDetails !== null && newDetails.length > 1000) {
    errors.push(`--details must be ≤ 1000 chars (got ${newDetails.length})`);
}

if (errors.length > 0) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'VALIDATION_FAILED', details: errors }) + '\n');
    process.exit(1);
}

// Check at least one update flag was given
const anyUpdate = [newStatus, newOwner, newDue, newTitle, newDetails, runId].some(v => v !== undefined);
if (!anyUpdate) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'No update flags provided. Nothing to do.', usage: HELP.usage }) + '\n');
    process.exit(1);
}

// ── Open DB (read-write) ──────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');   // session may be from older run
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Fetch existing task ───────────────────────────────────────────────────────
let existing;
try {
    existing = db.prepare(
        'SELECT id, session_id, created_at, due_at, owner_agent, status, title, details, meta_json ' +
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

// ── Build patch ───────────────────────────────────────────────────────────────
const now = new Date().toISOString();

// Snapshot "before" values for changed fields only (for audit trail)
const before = {};
const after = {};
const changed = [];

const setClauses = [];
const setParams = [];

function applyField(colName, newVal, beforeKey) {
    if (newVal === undefined || newVal === null) return;   // not provided → skip
    before[beforeKey || colName] = existing[colName];
    after[beforeKey || colName] = newVal;
    changed.push(beforeKey || colName);
    setClauses.push(`${colName} = ?`);
    setParams.push(newVal);
}

applyField('status', newStatus, 'status');
applyField('owner_agent', newOwner, 'owner_agent');
applyField('due_at', newDue, 'due_at');
applyField('title', newTitle, 'title');
applyField('details', newDetails, 'details');

// ── Merge meta_json (always touches this if runId or anything changed) ─────
let existingMeta = {};
try { existingMeta = JSON.parse(existing.meta_json || '{}'); } catch (_) { /* start fresh */ }

const newMeta = Object.assign({}, existingMeta, {
    updated_at: now,
    ...(runId != null ? { run_id: runId } : {}),
});
const newMetaJson = JSON.stringify(newMeta);

setClauses.push('meta_json = ?');
setParams.push(newMetaJson);
if (runId != null) {
    before.run_id = existingMeta.run_id || null;
    after.run_id = runId;
    if (!changed.includes('run_id')) changed.push('run_id');
}

// ── Apply update in transaction with action insert ────────────────────────────
const actionId = 'task_update_' + Date.now();
const sessionId = existing.session_id || 'openclaw_ops';
const changeList = changed.join(', ');
const actionReason = `task_id=${taskId}; changes=${changeList}`;
const actionMeta = JSON.stringify({
    task_id: taskId,
    run_id: runId || null,
    before,
    after,
});

try {
    db.transaction(() => {
        // Update tasks row
        db.prepare(
            'UPDATE tasks SET ' + setClauses.join(', ') + ' WHERE id = ?'
        ).run([...setParams, taskId]);

        // Audit action row
        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: actionId,
            session_id: sessionId,
            ts: now,
            actor: 'ops',
            type: 'task_update',
            input_ref: null,
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

// ── Re-fetch updated task ─────────────────────────────────────────────────────
let updated;
try {
    updated = db.prepare(
        'SELECT id, session_id, created_at, due_at, owner_agent, status, title, details ' +
        'FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_REFETCH_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

db.close();

// ── Output ────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    changed,
    task: {
        id: updated.id,
        session_id: updated.session_id,
        created_at: updated.created_at,
        due_at: updated.due_at,
        owner_agent: updated.owner_agent,
        status: updated.status,
        title: updated.title,
        details: updated.details,
    },
    action_id: actionId,
    run_id: runId || null,
}, null, 2) + '\n');
process.exit(0);
