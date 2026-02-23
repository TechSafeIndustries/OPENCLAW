/**
 * Seed: policy_override smoke test
 *
 * Creates ONE blocked task that has already been policy-gated:
 *   - status=blocked
 *   - stop_loss_triggered=true (required by human-review validate gate)
 *   - policy_gate_triggered=true (triggers policy_override logic on retry)
 *   - forbidden phrase "send email" in title
 *
 * Also inserts the original policy_gate action row (as triage would have written).
 *
 * Usage:
 *   node scripts/seed_policy_override_smoke.js
 *
 * Output:
 *   { ok: true, task_id, session_id }
 */

'use strict';

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (_) { }

const Database = require('better-sqlite3');
const DB_PATH = path.join(__dirname, '..', 'db', 'openclaw_ledger.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const sid = 'sess_policy_override_smoke_' + Date.now();
const now = new Date().toISOString();
const taskId = 'task_po_smoke_' + Date.now();

// Insert session if sessions table exists
const hasSessions = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
).get();
if (hasSessions) {
    db.prepare(
        'INSERT OR IGNORE INTO sessions (id, started_at, initiator, mode, status) VALUES (?,?,?,?,?)'
    ).run(sid, now, 'system', 'on_demand', 'open');
}

// Task meta — mirrors exactly what tasks:policy-gate CLI writes
const meta = JSON.stringify({
    intent: 'OPS_INTERNAL',
    source: 'smoke_policy_override',
    // Stop-loss block (human-review validate gate requires stop_loss_triggered=true)
    stop_loss_triggered: true,
    stop_loss_reason: 'policy_gate: FORBIDDEN_PHRASE — send email',
    stop_loss_failure_type: 'policy_gate',
    stop_loss_at: now,
    stop_loss_owner: 'cos',
    // Policy gate block
    hil_required: true,
    policy_gate_triggered: true,
    policy_gate_phrase: 'send email',
    policy_gate_policy: 'FORBIDDEN_PHRASE',
    policy_gate_at: now,
    policy_gate_reason: 'FORBIDDEN_PHRASE: send email',
});

// Insert policy-gated task
db.prepare(
    'INSERT INTO tasks (id, session_id, created_at, owner_agent, status, title, details, dependencies_json, meta_json) VALUES (?,?,?,?,?,?,?,?,?)'
).run(
    taskId, sid, now, 'cos', 'blocked',
    'Run SOP and send email to client with results',
    'Execute process checklist and send email notification to the client.',
    '[]', meta
);

// Insert original policy_gate action row
const pgActionId = 'policy_gate_smoke_' + (Date.now() + 1);
db.prepare(
    'INSERT INTO actions (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?)'
).run(
    pgActionId, sid, now, 'ops', 'policy_gate', null, null, 'ok',
    `task_id=${taskId}; FORBIDDEN_PHRASE: send email`,
    JSON.stringify({ task_id: taskId, phrase: 'send email', policy: 'FORBIDDEN_PHRASE' })
);

db.close();

process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: sid,
    note: 'Task seeded: blocked, policy_gate_triggered=true. Run human-review retry next.',
    next_cmd: `npm run workflow:human-review -- ${taskId} --decision retry --reason "Approved after review" --owner cos --session ${sid}`,
}, null, 2) + '\n');
