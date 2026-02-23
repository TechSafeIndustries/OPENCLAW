/**
 * OpenClaw — Decisions List CLI v1
 * ----------------------------------
 * Lists all decisions for a given session_id, with optional run_id filter.
 *
 * Usage:
 *   node app/decisions_list_cli_v1.js <session_id> [--run <run_id>]
 *
 * Arguments:
 *   session_id     — Required. Filters decisions by session.
 *   --run <run_id> — Optional. Further filters by run_id in meta_json.
 *
 * Exit codes:
 *   0  — OK (may return empty decisions array if none found)
 *   1  — Missing argument or DB error
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Access: Read-only. No writes.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(JSON.stringify({
        usage: 'node app/decisions_list_cli_v1.js <session_id> [--run <run_id>]',
        flags: { '--run <run_id>': 'Filter to decisions belonging to a specific run_id' },
        exit_codes: { 0: 'OK', 1: 'Error' },
    }, null, 2) + '\n');
    process.exit(0);
}

// session_id is the first non-flag argument
const session_id = args.find(a => !a.startsWith('-'));

if (!session_id) {
    process.stderr.write(JSON.stringify({
        error: 'Missing required argument: <session_id>',
        usage: 'node app/decisions_list_cli_v1.js <session_id> [--run <run_id>]',
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
    if (run_id) {
        // Filter by session_id AND run_id in meta_json
        rows = db.prepare(`
            SELECT id, ts, decision_type, subject,
                   selected_option, approved_by, rationale, meta_json
            FROM   decisions
            WHERE  session_id = @session_id
              AND  meta_json  LIKE @run_pat
            ORDER  BY ts DESC
        `).all({
            session_id,
            run_pat: `%"run_id":"${run_id}"%`,
        });
    } else {
        // Filter by session_id only
        rows = db.prepare(`
            SELECT id, ts, decision_type, subject,
                   selected_option, approved_by, rationale, meta_json
            FROM   decisions
            WHERE  session_id = @session_id
            ORDER  BY ts DESC
        `).all({ session_id });
    }
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ error: `Query failed: ${err.message}` }) + '\n');
    process.exit(1);
}

db.close();

// ── Shape output ──────────────────────────────────────────────────────────────
const decisions = rows.map(r => ({
    id: r.id,
    ts: r.ts,
    decision_type: r.decision_type,
    subject: r.subject,
    selected_option: r.selected_option,
    approved_by: r.approved_by || null,
    rationale: r.rationale || null,
}));

process.stdout.write(JSON.stringify({
    ok: true,
    session_id,
    run_id: run_id || null,
    count: decisions.length,
    decisions,
}, null, 2) + '\n');
process.exit(0);
