/**
 * OpenClaw — Tasks Get CLI v1
 * ----------------------------
 * Fetch a single task by ID and print its full detail.
 *
 * Usage:
 *   node app/tasks_get_cli_v1.js <task_id>
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK, 1 not found or error.
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

if (helpFlag || args.length === 0) {
    process.stdout.write(JSON.stringify({
        usage: 'node app/tasks_get_cli_v1.js <task_id>',
        exit_codes: { 0: 'OK', 1: 'Not found or error' },
    }, null, 2) + '\n');
    process.exit(0);
}

const taskId = args.find(a => !a.startsWith('-'));

if (!taskId) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'Missing required argument: <task_id>' }) + '\n');
    process.exit(1);
}

// ── Query ─────────────────────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

let row;
try {
    row = db.prepare(
        'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
        '       title, details, dependencies_json, meta_json ' +
        'FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

db.close();

if (!row) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'NOT_FOUND', task_id: taskId }) + '\n');
    process.exit(1);
}

// ── Parse JSON fields with safe fallbacks ─────────────────────────────────────
const dependencies = (() => {
    try { return JSON.parse(row.dependencies_json || '[]'); } catch (_) { return []; }
})();

const meta = (() => {
    try { return JSON.parse(row.meta_json || '{}'); } catch (_) { return {}; }
})();

// ── Output ────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    task: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at,
        due_at: row.due_at,
        owner_agent: row.owner_agent,
        status: row.status,
        title: row.title,
        details: row.details,
        dependencies,
        meta,
        raw: {
            dependencies_json: row.dependencies_json,
            meta_json: row.meta_json,
        },
    },
}, null, 2) + '\n');
process.exit(0);
