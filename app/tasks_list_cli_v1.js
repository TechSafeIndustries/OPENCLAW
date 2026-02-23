/**
 * OpenClaw — Tasks List CLI v1
 * ------------------------------
 * Lists all tasks for a given session_id, with optional run_id filter.
 *
 * Usage:
 *   node app/tasks_list_cli_v1.js <session_id> [--run <run_id>]
 *
 * Arguments:
 *   session_id     — Required. Filters tasks by session.
 *   --run <run_id> — Optional. Further filters by run_id in meta_json.
 *
 * Sort order:
 *   1. status: blocked → doing → todo → done
 *   2. created_at DESC within each status group
 *
 * Exit codes:
 *   0  — OK (may return empty tasks array if none found)
 *   1  — Missing argument or DB error
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Access: Read-only. No writes.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

// ── Status sort order ─────────────────────────────────────────────────────────
// SQLite CASE expression: blocked=0, doing=1, todo=2, done=3
const STATUS_ORDER_EXPR = `
    CASE status
        WHEN 'blocked' THEN 0
        WHEN 'doing'   THEN 1
        WHEN 'todo'    THEN 2
        WHEN 'done'    THEN 3
        ELSE                4
    END
`;

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(JSON.stringify({
        usage: 'node app/tasks_list_cli_v1.js <session_id> [--run <run_id>]',
        flags: { '--run <run_id>': 'Filter to tasks belonging to a specific run_id' },
        sort_order: 'blocked → doing → todo → done, then created_at DESC',
        exit_codes: { 0: 'OK', 1: 'Error' },
    }, null, 2) + '\n');
    process.exit(0);
}

// session_id = first non-flag argument
const session_id = args.find(a => !a.startsWith('-'));

if (!session_id) {
    process.stderr.write(JSON.stringify({
        error: 'Missing required argument: <session_id>',
        usage: 'node app/tasks_list_cli_v1.js <session_id> [--run <run_id>]',
    }) + '\n');
    process.exit(1);
}

// --run <run_id>
const runFlagIdx = args.indexOf('--run');
const run_id = runFlagIdx !== -1 ? (args[runFlagIdx + 1] || null) : null;

if (runFlagIdx !== -1 && !run_id) {
    process.stderr.write(JSON.stringify({
        error: '--run flag requires a value: --run <run_id>',
    }) + '\n');
    process.exit(1);
}

// ── Open DB (read-only) ───────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH, { readonly: true });
} catch (err) {
    process.stderr.write(JSON.stringify({ error: `DB open failed: ${err.message}` }) + '\n');
    process.exit(1);
}

// ── Query ─────────────────────────────────────────────────────────────────────
let rows;
try {
    const orderClause = `ORDER BY ${STATUS_ORDER_EXPR}, created_at DESC`;

    if (run_id) {
        rows = db.prepare(`
            SELECT id, created_at, due_at, owner_agent,
                   status, title, details, meta_json
            FROM   tasks
            WHERE  session_id = @session_id
              AND  meta_json  LIKE @run_pat
            ${orderClause}
        `).all({
            session_id,
            run_pat: `%"run_id":"${run_id}"%`,
        });
    } else {
        rows = db.prepare(`
            SELECT id, created_at, due_at, owner_agent,
                   status, title, details, meta_json
            FROM   tasks
            WHERE  session_id = @session_id
            ${orderClause}
        `).all({ session_id });
    }
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ error: `Query failed: ${err.message}` }) + '\n');
    process.exit(1);
}

db.close();

// ── Shape output ──────────────────────────────────────────────────────────────
const tasks = rows.map(r => ({
    id: r.id,
    created_at: r.created_at,
    due_at: r.due_at || null,
    owner_agent: r.owner_agent,
    status: r.status,
    title: r.title,
    details: r.details || null,
}));

process.stdout.write(JSON.stringify({
    ok: true,
    session_id,
    run_id: run_id || null,
    count: tasks.length,
    tasks,
}, null, 2) + '\n');
process.exit(0);
