/**
 * OpenClaw — Run Brief CLI v1
 * ----------------------------
 * Returns a structured JSON summary of a single run, identified by run_id.
 *
 * run_id is embedded inside meta_json on actions, messages, decisions, and
 * artifacts rows. This tool uses LIKE matching to find all rows that belong
 * to the run without any schema changes.
 *
 * Usage:
 *   node app/run_brief_cli_v1.js <run_id>
 *
 * Exit codes:
 *   0  — OK (may have empty arrays if run_id not found)
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
const run_id = process.argv[2];

if (!run_id) {
    process.stderr.write(JSON.stringify({
        error: 'Missing required argument: <run_id>',
        usage: 'node app/run_brief_cli_v1.js <run_id>',
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

const likePat = `%"run_id":"${run_id}"%`;

// ── Actions with this run_id ──────────────────────────────────────────────────
const actions = db.prepare(`
    SELECT session_id, ts, actor, type, status, reason, meta_json
    FROM   actions
    WHERE  meta_json LIKE ?
    ORDER  BY rowid DESC
`).all(likePat);

// ── Messages with this run_id ─────────────────────────────────────────────────
const messages = db.prepare(`
    SELECT session_id, ts, role, agent_name, meta_json
    FROM   messages
    WHERE  meta_json LIKE ?
    ORDER  BY rowid DESC
`).all(likePat);

// ── Decisions (approvals) with this run_id ────────────────────────────────────
const decisions = db.prepare(`
    SELECT id, session_id, ts, decision_type, subject,
           options_json, selected_option, rationale, approved_by
    FROM   decisions
    WHERE  meta_json LIKE ?
    ORDER  BY rowid DESC
`).all(likePat);

// ── Artifacts with this run_id ────────────────────────────────────────────────
const artifacts = db.prepare(`
    SELECT id, session_id, ts, type, title, classification
    FROM   artifacts
    WHERE  meta_json LIKE ?
    ORDER  BY rowid DESC
`).all(likePat);

db.close();

// ── Build summary fields ──────────────────────────────────────────────────────
const unique = arr => [...new Set(arr.filter(Boolean))];

// session_ids — union from all tables
const allSessionIds = unique([
    ...actions.map(r => r.session_id),
    ...messages.map(r => r.session_id),
    ...decisions.map(r => r.session_id),
    ...artifacts.map(r => r.session_id),
]);

// intents — from action.reason (intent=XXX pattern) or decision.options_json
const intentSet = new Set();
for (const a of actions) {
    const m = (a.reason || '').match(/intent=([A-Z_]+)/);
    if (m) intentSet.add(m[1]);
}
for (const d of decisions) {
    try {
        const opts = JSON.parse(d.options_json || '{}');
        if (opts.intent) intentSet.add(opts.intent);
    } catch (_) { /* ignore */ }
}
const intents = [...intentSet];

// dispatch_states — from actions of type "dispatch", map status→state label
const STATE_MAP = { ok: 'DISPATCHED', gated: 'GATED', blocked: 'BLOCKED', failed: 'REJECTED' };
const dispatchStates = unique(
    actions
        .filter(a => a.type === 'dispatch')
        .map(a => STATE_MAP[a.status] || a.status.toUpperCase())
);

// gated_or_blocked reasons — from actions where status is gated/blocked/failed
const gatedReasons = actions
    .filter(a => ['gated', 'blocked', 'failed'].includes(a.status) && a.reason)
    .map(a => a.reason);

// ── Approvals ─────────────────────────────────────────────────────────────────
const approvals = decisions
    .filter(d => d.selected_option === 'override_approved')
    .map(d => ({
        decision_id: d.id,
        intent: (() => { try { return JSON.parse(d.options_json || '{}').intent || null; } catch { return null; } })(),
        approved_by: d.approved_by,
        ts: d.ts,
        rationale: d.rationale,
    }));

// ── Artifacts ─────────────────────────────────────────────────────────────────
const artifactList = artifacts.map(a => ({
    artifact_id: a.id,
    type: a.type,
    title: a.title,
    classification: a.classification,
    ts: a.ts,
}));

// ── Last 5 actions ────────────────────────────────────────────────────────────
const actions_last5 = actions.slice(0, 5).map(a => ({
    ts: a.ts,
    type: a.type,
    status: a.status,
    reason: a.reason,
}));

// ── Last 5 messages ───────────────────────────────────────────────────────────
const messages_last5 = messages.slice(0, 5).map(m => ({
    ts: m.ts,
    role: m.role,
    agent_name: m.agent_name,
    meta: (() => { try { return JSON.parse(m.meta_json || 'null'); } catch { return m.meta_json; } })(),
}));

// ── Output ────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    run_id,
    summary: {
        session_ids: allSessionIds,
        intents,
        dispatch_states: dispatchStates,
        gated_or_blocked_reasons: gatedReasons,
    },
    approvals,
    artifacts: artifactList,
    actions_last5,
    messages_last5,
}, null, 2) + '\n');

process.exit(0);
