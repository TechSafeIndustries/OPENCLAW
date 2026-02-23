/**
 * OpenClaw — Tasks Latest CLI v1
 * --------------------------------
 * Return the single newest task for a session, with optional filters.
 *
 * Usage:
 *   node app/tasks_latest_cli_v1.js <session_id>
 *     [--run <run_id>]
 *     [--status todo|doing|done|blocked]
 *     [--owner <owner_agent>]
 *     [--q <text>]
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK (task:null when no match), 1 error.
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
    usage: 'node app/tasks_latest_cli_v1.js <session_id> [--run <run_id>] [--status <s>] [--owner <agent>] [--q <text>] [--oldest]',
    flags: {
        '--run <run_id>': 'Filter to tasks whose meta_json contains the given run_id',
        '--status <s>': 'Filter by status (todo, doing, done, blocked)',
        '--owner <agent>': 'Filter by owner_agent (exact match)',
        '--q <text>': 'Filter by title or details substring (case-insensitive)',
        '--oldest': 'Return oldest matching task instead of newest (queue/FIFO behaviour)',
    },
    exit_codes: { 0: 'OK (task null if no match)', 1: 'Error' },
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
        flags: HELP.flags,
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
const statusFilter = flagVal('--status');
const ownerFilter = flagVal('--owner');
const qFilter = flagVal('--q');
const oldestFlag = args.includes('--oldest');

// ── Build WHERE clause ────────────────────────────────────────────────────────
//
//   Base:     session_id = ?
//   --run:    AND meta_json LIKE '%"run_id":"<run_id>"%'
//   --status: AND status = ?
//   --owner:  AND owner_agent = ?
//   --q:      AND (LOWER(title) LIKE '%<q>%' OR LOWER(details) LIKE '%<q>%')
//
//   ORDER BY created_at DESC LIMIT 1
//
const clauses = ['session_id = ?'];
const params = [sessionId];

if (runId) {
    clauses.push('meta_json LIKE ?');
    params.push('%"run_id":"' + runId + '"%');
}

if (statusFilter) {
    clauses.push('status = ?');
    params.push(statusFilter);
}

if (ownerFilter) {
    clauses.push('owner_agent = ?');
    params.push(ownerFilter);
}

if (qFilter) {
    const pat = '%' + qFilter.toLowerCase() + '%';
    clauses.push('(LOWER(title) LIKE ? OR LOWER(details) LIKE ?)');
    params.push(pat, pat);
}

const sql =
    'SELECT id, session_id, created_at, due_at, owner_agent, status, ' +
    '       title, details, dependencies_json, meta_json ' +
    'FROM tasks ' +
    'WHERE ' + clauses.join(' AND ') + ' ' +
    'ORDER BY created_at ' + (oldestFlag ? 'ASC' : 'DESC') + ' LIMIT 1';

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
        raw: {
            dependencies_json: row.dependencies_json,
            meta_json: row.meta_json,
        },
    };
}

process.stdout.write(JSON.stringify({
    ok: true,
    session_id: sessionId,
    applied_filters: {
        run_id: runId || null,
        status: statusFilter || null,
        owner: ownerFilter || null,
        q: qFilter || null,
        oldest: oldestFlag,
    },
    task,
}, null, 2) + '\n');
process.exit(0);
