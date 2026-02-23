/**
 * OpenClaw — Artifacts Get CLI v1
 * ---------------------------------
 * Fetch a single artifact by ID and print its full content.
 *
 * Usage:
 *   node app/artifacts_get_cli_v1.js <artifact_id>
 *
 * Arguments:
 *   <artifact_id>      Required. Exact artifact ID to retrieve.
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 * Exit codes: 0 OK, 1 error or not found.
 *
 * Deps: better-sqlite3 (already in project).
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
        usage: 'node app/artifacts_get_cli_v1.js <artifact_id>',
        exit_codes: { 0: 'OK', 1: 'Error or not found' },
    }, null, 2) + '\n');
    process.exit(0);
}

const artifactId = args.find(a => !a.startsWith('-'));

if (!artifactId) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'Missing required argument: <artifact_id>' }) + '\n');
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
        'SELECT id, session_id, ts, type, title, classification, tags_json, content, meta_json ' +
        'FROM artifacts WHERE id = ?'
    ).get(artifactId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

db.close();

if (!row) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'NOT_FOUND' }) + '\n');
    process.exit(1);
}

// ── Parse JSON fields with safe fallback ─────────────────────────────────────
function safeParse(raw) {
    if (raw === null || raw === undefined) return null;
    try { return JSON.parse(raw); } catch (_) { return raw; }
}

const tags = (() => {
    try { return JSON.parse(row.tags_json || '[]'); } catch (_) { return []; }
})();

process.stdout.write(JSON.stringify({
    ok: true,
    artifact: {
        id: row.id,
        session_id: row.session_id,
        ts: row.ts,
        type: row.type,
        title: row.title,
        classification: row.classification,
        tags,
        content: safeParse(row.content),
        meta: safeParse(row.meta_json),
    },
}, null, 2) + '\n');
process.exit(0);
