/**
 * OpenClaw — Ledger Verification
 * --------------------------------
 * Prints row counts and recent records from openclaw_ledger.db.
 *
 * Usage: node app/verify_ledger.js
 * Deps:  better-sqlite3 (already installed)
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'db', 'openclaw_ledger.db');

let db;
try {
    db = new Database(DB_PATH, { readonly: true });
} catch (err) {
    console.error('FAIL: could not open database:', err.message);
    process.exit(1);
}

// ── Helper ────────────────────────────────────────────────────────────────────
function section(title) {
    console.log('\n' + '─'.repeat(60));
    console.log(' ' + title);
    console.log('─'.repeat(60));
}

function printTable(rows) {
    if (!rows || rows.length === 0) { console.log('  (no rows)'); return; }
    const keys = Object.keys(rows[0]);
    // Column widths
    const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ');
    const divider = widths.map(w => '-'.repeat(w)).join('  ');
    console.log('  ' + header);
    console.log('  ' + divider);
    for (const row of rows) {
        console.log('  ' + keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '));
    }
}

// ── Counts ────────────────────────────────────────────────────────────────────
section('ROW COUNTS');
const countTables = ['agents', 'routing_rules', 'sessions', 'actions'];
const countRows = countTables.map(t => ({
    table: t,
    count: db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n,
}));
printTable(countRows);

// ── Recent sessions ───────────────────────────────────────────────────────────
section('sessions — last 3 (ORDER BY started_at DESC)');
const sessions = db.prepare(
    'SELECT id, started_at, status, summary FROM sessions ORDER BY started_at DESC LIMIT 3'
).all();
printTable(sessions);

// ── Recent actions ────────────────────────────────────────────────────────────
section('actions — last 3 (ORDER BY ts DESC)');
const actions = db.prepare(
    'SELECT id, ts, actor, type, status, reason FROM actions ORDER BY ts DESC LIMIT 3'
).all();
printTable(actions);

db.close();
console.log('\nOK: ledger verified\n');
process.exit(0);
