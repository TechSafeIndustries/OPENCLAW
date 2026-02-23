/**
 * OpenClaw — Tasks Oldest CLI v1
 * --------------------------------
 * Read-only. Returns the single oldest non-stub TODO task across ALL sessions
 * (or filtered by session if provided).
 *
 * Usage:
 *   node app/tasks_oldest_cli_v1.js
 *     [--session <session_id>]
 *     [--no-stub]
 *     [--owner <owner_agent>]
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK (task:null when no match), 1 error.
 *
 * IMPORTANT: This CLI is READ-ONLY. It does NOT transition task status.
 * Use tasks:next to actually pop a task.
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
    usage: 'node app/tasks_oldest_cli_v1.js [--session <id>] [--no-stub] [--owner <agent>]',
    flags: {
        '--session <id>': 'Restrict to a single session (optional — omit to search all sessions)',
        '--no-stub': 'Exclude tasks whose meta_json contains "source":"stub"',
        '--owner <agent>': 'Filter by owner_agent (exact match)',
    },
    notes: 'READ-ONLY. Does not pop or transition task status.',
    exit_codes: { 0: 'OK (task null if no match)', 1: 'Error' },
};

if (helpFlag) {
    process.stdout.write(JSON.stringify(HELP, null, 2) + '\n');
    process.exit(0);
}

// ── Parse flags ───────────────────────────────────────────────────────────────
function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const sessionFilter = flagVal('--session');
const ownerFilter = flagVal('--owner');
const noStub = args.includes('--no-stub');

// ── Build WHERE clause ────────────────────────────────────────────────────────
const clauses = ["status = 'todo'"];
const params = [];

if (sessionFilter) {
    clauses.push('session_id = ?');
    params.push(sessionFilter);
}

if (ownerFilter) {
    clauses.push('owner_agent = ?');
    params.push(ownerFilter);
}

if (noStub) {
    clauses.push('(meta_json IS NULL OR meta_json NOT LIKE \'%"source":"stub"%\')');
}

const sql =
    'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
    '       title, details, dependencies_json, meta_json ' +
    'FROM tasks ' +
    'WHERE ' + clauses.join(' AND ') + ' ' +
    'ORDER BY created_at ASC LIMIT 1';

// ── Query (read-only) ─────────────────────────────────────────────────────────
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
    row = db.prepare(sql).get(params);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}
db.close();

// ── Format output ─────────────────────────────────────────────────────────────
let task = null;
if (row) {
    const dependencies = (() => {
        try { return JSON.parse(row.dependencies_json || '[]'); } catch (_) { return []; }
    })();
    const meta = (() => {
        try { return JSON.parse(row.meta_json || '{}'); } catch (_) { return {}; }
    })();

    task = {
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
    };
}

process.stdout.write(JSON.stringify({
    ok: true,
    applied_filters: {
        session: sessionFilter || null,
        owner: ownerFilter || null,
        no_stub: noStub,
    },
    task,
}, null, 2) + '\n');
process.exit(0);
