/**
 * OpenClaw — Tasks Next CLI v1
 * ------------------------------
 * Queue-pop: find the oldest todo task in a session, transition it to "doing",
 * and write two audit action rows — all in a single transaction.
 *
 * Usage:
 *   node app/tasks_next_cli_v1.js <session_id>
 *     [--no-stub]
 *     [--owner <owner_agent>]
 *     [--run <run_id>]
 *
 * Flags:
 *   --no-stub          Exclude tasks whose meta_json contains "source":"stub"
 *   --owner <agent>    Set owner_agent on the claimed task
 *   --run <run_id>     Record run_id in meta_json and action rows
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK (task:null if no todo found), 1 error.
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
    usage: 'node app/tasks_next_cli_v1.js <session_id> [--no-stub] [--owner <agent>] [--run <run_id>]',
    flags: {
        '--no-stub': 'Exclude tasks whose meta_json contains "source":"stub"',
        '--owner <agent>': 'Set owner_agent on the claimed task',
        '--run <run_id>': 'Record run_id in meta_json and audit action rows',
    },
    exit_codes: { 0: 'OK (task null if no todo found)', 1: 'Error' },
};

if (helpFlag) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
    process.exit(0);
}

// ── Require session_id ────────────────────────────────────────────────────────
const sessionId = args.find(a => !a.startsWith('-'));

if (!sessionId) {
    process.stderr.write(JSON.stringify({
        ok: false,
        error: 'Missing required argument: <session_id>',
        usage: HELP.usage,
    }) + '\n');
    process.exit(1);
}

// ── Parse flags ───────────────────────────────────────────────────────────────
function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const runId = flagVal('--run');
const ownerArg = flagVal('--owner');
const noStub = args.includes('--no-stub');

// ── Build SELECT for oldest todo ──────────────────────────────────────────────
//
//   WHERE session_id = ?
//     AND status = 'todo'
//     [AND meta_json NOT LIKE '%"source":"stub"%']   -- if --no-stub
//   ORDER BY created_at ASC LIMIT 1
//
const selectClauses = ["session_id = ?", "status = 'todo'"];
const selectParams = [sessionId];

if (noStub) {
    selectClauses.push('(meta_json IS NULL OR meta_json NOT LIKE \'%"source":"stub"%\')');
}

const selectSql =
    'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
    '       title, details, dependencies_json, meta_json ' +
    'FROM tasks ' +
    'WHERE ' + selectClauses.join(' AND ') + ' ' +
    'ORDER BY created_at ASC LIMIT 1';

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

// ── Find claim candidate ──────────────────────────────────────────────────────
let candidate;
try {
    candidate = db.prepare(selectSql).get(selectParams);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// No todo task found — return ok:true, task:null
if (!candidate) {
    db.close();
    process.stdout.write(JSON.stringify({
        ok: true,
        session_id: sessionId,
        run_id: runId || null,
        no_stub: noStub,
        task: null,
        task_update_action_id: null,
        task_next_action_id: null,
    }, null, 2) + '\n');
    process.exit(0);
}

// ── Build update payload ──────────────────────────────────────────────────────
const now = new Date().toISOString();
const taskId = candidate.id;

// Merge meta_json
let existingMeta = {};
try { existingMeta = JSON.parse(candidate.meta_json || '{}'); } catch (_) { /* start fresh */ }

const newMeta = Object.assign({}, existingMeta, {
    popped_at: now,
    ...(runId != null ? { run_id: runId } : {}),
    ...(ownerArg != null ? { popped_owner: ownerArg } : {}),
});
const newMetaJson = JSON.stringify(newMeta);

// Determine final owner
const finalOwner = ownerArg || candidate.owner_agent;

// Build SET clauses
const setClauses = ['status = ?', 'meta_json = ?'];
const setParams = ['doing', newMetaJson];

if (ownerArg) {
    setClauses.push('owner_agent = ?');
    setParams.push(ownerArg);
}

// ── Action IDs ────────────────────────────────────────────────────────────────
const ts = now;
const taskUpdateActionId = 'task_update_' + Date.now();
// Ensure distinct timestamp for second action id
const taskNextActionId = 'task_next_' + (Date.now() + 1);

const commonMeta = JSON.stringify({
    task_id: taskId,
    session_id: sessionId,
    run_id: runId || null,
    no_stub: noStub,
    owner: finalOwner,
});

// ── Single transaction: UPDATE task + INSERT two action rows ──────────────────
try {
    db.transaction(() => {
        // 1. Transition task: todo → doing
        db.prepare(
            'UPDATE tasks SET ' + setClauses.join(', ') + ' WHERE id = ?'
        ).run([...setParams, taskId]);

        // 2. Audit: task_update (field-level change record)
        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: taskUpdateActionId,
            session_id: sessionId,
            ts,
            actor: 'ops',
            type: 'task_update',
            input_ref: null,
            output_ref: null,
            status: 'ok',
            reason: `task_id=${taskId}; changes=status, meta_json${ownerArg ? ', owner_agent' : ''}`,
            meta_json: JSON.stringify({
                task_id: taskId,
                run_id: runId || null,
                before: { status: 'todo', owner_agent: candidate.owner_agent },
                after: { status: 'doing', owner_agent: finalOwner },
            }),
        });

        // 3. Audit: task_next (queue-pop record)
        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: taskNextActionId,
            session_id: sessionId,
            ts,
            actor: 'ops',
            type: 'task_next',
            input_ref: null,
            output_ref: null,
            status: 'ok',
            reason: `queue pop: task_id=${taskId}; session=${sessionId}`,
            meta_json: commonMeta,
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
        'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
        '       title, details, dependencies_json, meta_json ' +
        'FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_REFETCH_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

db.close();

// ── Format task object (same shape as tasks:get) ──────────────────────────────
const dependencies = (() => {
    try { return JSON.parse(updated.dependencies_json || '[]'); } catch (_) { return []; }
})();
const meta = (() => {
    try { return JSON.parse(updated.meta_json || '{}'); } catch (_) { return {}; }
})();

const task = {
    id: updated.id,
    session_id: updated.session_id,
    created_at: updated.created_at,
    due_at: updated.due_at,
    owner_agent: updated.owner_agent,
    status: updated.status,
    title: updated.title,
    details: updated.details,
    dependencies,
    meta,
    raw: {
        dependencies_json: updated.dependencies_json,
        meta_json: updated.meta_json,
    },
};

// ── Output ────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    session_id: sessionId,
    run_id: runId || null,
    no_stub: noStub,
    task,
    task_update_action_id: taskUpdateActionId,
    task_next_action_id: taskNextActionId,
}, null, 2) + '\n');
process.exit(0);
