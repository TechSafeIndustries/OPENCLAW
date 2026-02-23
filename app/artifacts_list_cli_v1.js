/**
 * OpenClaw — Artifacts List CLI v1
 * ----------------------------------
 * Print all artifacts for a session with optional filters.
 *
 * Usage:
 *   node app/artifacts_list_cli_v1.js <session_id> [options]
 *
 * Options:
 *   --run <run_id>       Filter to artifacts whose meta_json contains run_id
 *   --type <type>        Filter by artifact type (exact match, e.g. plan, sequence)
 *   --q <search_text>    Filter by title substring (case-insensitive)
 *   --no-stub            Exclude artifacts tagged "stub" in tags_json
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK, 1 error.
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
    usage: 'node app/artifacts_list_cli_v1.js <session_id> [--run <run_id>] [--type <type>] [--q <text>] [--no-stub]',
    flags: {
        '--run <run_id>': 'Filter to artifacts whose meta_json contains the given run_id',
        '--type <type>': 'Filter by artifact type (exact match)',
        '--q <search_text>': 'Filter by title substring (case-insensitive)',
        '--no-stub': 'Exclude artifacts whose tags_json contains "stub"',
    },
    exit_codes: { 0: 'OK', 1: 'Error' },
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
const typeFilter = flagVal('--type');
const qFilter = flagVal('--q');
const noStub = args.includes('--no-stub');

// ── Build WHERE clause dynamically ───────────────────────────────────────────
//
// We always start with session_id = ? then conditionally append:
//   --run      AND meta_json LIKE ?         ('%"run_id":"<run_id>"%')
//   --type     AND type = ?
//   --q        AND LOWER(title) LIKE ?      ('%' + lower(q) + '%')
//   --no-stub  AND (tags_json IS NULL OR tags_json NOT LIKE '%"stub"%')
//
const clauses = ['session_id = ?'];
const params = [sessionId];

if (runId) {
    clauses.push('meta_json LIKE ?');
    params.push('%"run_id":"' + runId + '"%');
}

if (typeFilter) {
    clauses.push('type = ?');
    params.push(typeFilter);
}

if (qFilter) {
    clauses.push("LOWER(title) LIKE ?");
    params.push('%' + qFilter.toLowerCase() + '%');
}

if (noStub) {
    clauses.push("(tags_json IS NULL OR tags_json NOT LIKE '%\"stub\"%')");
    // No bound param — literal SQL predicate
}

const sql =
    'SELECT id, session_id, ts, type, title, classification, tags_json ' +
    'FROM artifacts ' +
    'WHERE ' + clauses.join(' AND ') + ' ' +
    'ORDER BY ts DESC';

// ── Query ─────────────────────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

let rows;
try {
    rows = db.prepare(sql).all(params);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

db.close();

// ── Format output ─────────────────────────────────────────────────────────────
const artifacts = rows.map(row => {
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { /* leave [] */ }
    return {
        id: row.id,
        ts: row.ts,
        type: row.type,
        title: row.title,
        classification: row.classification,
        tags,
    };
});

process.stdout.write(JSON.stringify({
    ok: true,
    session_id: sessionId,
    run_id: runId || null,
    count: artifacts.length,
    applied_filters: {
        no_stub: noStub,
        type: typeFilter || null,
        q: qFilter || null,
    },
    artifacts,
}, null, 2) + '\n');
process.exit(0);
