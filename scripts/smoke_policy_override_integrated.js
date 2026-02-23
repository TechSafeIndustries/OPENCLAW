/**
 * Self-contained smoke test for policy_override logic.
 *
 * Runs entirely in one DB connection (no lock contention), so it can run
 * even when other node processes have the WAL open.
 *
 * Steps:
 *   1. Seed a blocked, policy-gated task
 *   2. Run the exact same logic as tasks_review_update_cli_v1.js retry path
 *      (including the policy_override INSERT)
 *   3. Query and return proof rows
 *
 * Usage:
 *   node scripts/smoke_policy_override_integrated.js
 */

'use strict';

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (_) { }

const Database = require('better-sqlite3');
const DB_PATH = path.join(__dirname, '..', 'db', 'openclaw_ledger.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const now = new Date().toISOString();
const ts = Date.now();
const sid = 'sess_po_integrated_' + ts;
const taskId = 'task_po_integrated_' + ts;
const owner = 'cos';
const trimmedReason = 'Approved after review — forbidden phrase was client notification SOP, reviewed and cleared';

// ── 1. Seed session + task + original policy_gate action ─────────────────────
db.prepare(
    'INSERT OR IGNORE INTO sessions (id, started_at, initiator, mode, status) VALUES (?,?,?,?,?)'
).run(sid, now, 'system', 'on_demand', 'open');

const existingMeta = {
    intent: 'OPS_INTERNAL',
    source: 'smoke_policy_override_integrated',
    stop_loss_triggered: true,
    stop_loss_reason: 'policy_gate: FORBIDDEN_PHRASE — send email',
    stop_loss_failure_type: 'policy_gate',
    stop_loss_at: now,
    stop_loss_owner: owner,
    hil_required: true,
    policy_gate_triggered: true,
    policy_gate_phrase: 'send email',
    policy_gate_policy: 'FORBIDDEN_PHRASE',
    policy_gate_at: now,
    policy_gate_reason: 'FORBIDDEN_PHRASE: send email',
};

db.prepare(
    'INSERT INTO tasks (id, session_id, created_at, owner_agent, status, title, details, dependencies_json, meta_json) VALUES (?,?,?,?,?,?,?,?,?)'
).run(
    taskId, sid, now, owner, 'blocked',
    'Run SOP and send email to client with results',
    'Execute process checklist and send email notification to the client.',
    '[]', JSON.stringify(existingMeta)
);

const pgActionId = 'policy_gate_' + ts;
db.prepare(
    'INSERT INTO actions (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?)'
).run(
    pgActionId, sid, now, 'ops', 'policy_gate', null, null, 'ok',
    `task_id=${taskId}; FORBIDDEN_PHRASE: send email`,
    JSON.stringify({ task_id: taskId, phrase: 'send email', policy: 'FORBIDDEN_PHRASE' })
);

// ── 2. Apply retry decision (mirrors tasks_review_update_cli_v1.js) ────────────

const nowRetry = new Date().toISOString();
const actionType = 'human_review_retry';
const mainActionId = actionType + '_' + (ts + 2);
const newStatus = 'todo';

const newMeta = Object.assign({}, existingMeta, {
    stop_loss_retry_approved: true,
    stop_loss_retry_reason: trimmedReason,
    stop_loss_retry_by: owner,
    stop_loss_retry_at: nowRetry,
    updated_at: nowRetry,
});

const reasonStr = `task_id=${taskId}; decision=retry; owner=${owner}; reason="${trimmedReason.slice(0, 80)}"`;
const actionMeta = JSON.stringify({
    task_id: taskId, session_id: sid, decision: 'retry', owner,
    reason: trimmedReason,
    before: { status: 'blocked', owner_agent: owner },
    after: { status: newStatus, owner_agent: owner },
});

// Main atomic transaction: UPDATE task + INSERT human_review_retry action
db.transaction(() => {
    db.prepare(
        'UPDATE tasks SET status = ?, owner_agent = ?, meta_json = ? WHERE id = ?'
    ).run(newStatus, owner, JSON.stringify(newMeta), taskId);

    db.prepare(`
        INSERT INTO actions
          (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
        VALUES
          (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
    `).run({
        id: mainActionId, session_id: sid, ts: nowRetry,
        actor: 'ops', type: actionType,
        input_ref: null, output_ref: null, status: 'ok',
        reason: reasonStr, meta_json: actionMeta,
    });
})();

// ── 3. Policy override INSERT (the new logic) ─────────────────────────────────
// This mirrors the new block in tasks_review_update_cli_v1.js exactly.

let policyOverrideActionId = null;
let policyOverrideNote = null;

if (existingMeta.policy_gate_triggered === true) {
    const poId = 'policy_override_' + (ts + 3);
    const poReason = [
        `task_id=${taskId}`,
        `session_id=${sid}`,
        `overridden_gate=policy_gate`,
        `owner=${owner}`,
        `review_reason="${trimmedReason.slice(0, 80)}"`,
    ].join('; ');
    const poMeta = JSON.stringify({
        task_id: taskId,
        session_id: sid,
        owner,
        review_reason: trimmedReason,
        overridden_gate: 'policy_gate',
        policy_gate_phrase: existingMeta.policy_gate_phrase || null,
        policy_gate_intent: existingMeta.policy_gate_intent || null,
        policy_gate_policy: existingMeta.policy_gate_policy || null,
        policy_gate_at: existingMeta.policy_gate_at || null,
        policy_gate_reason: existingMeta.policy_gate_reason || null,
    });

    try {
        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: poId, session_id: sid, ts: new Date().toISOString(),
            actor: 'ops', type: 'policy_override',
            input_ref: null, output_ref: null, status: 'ok',
            reason: poReason, meta_json: poMeta,
        });
        policyOverrideActionId = poId;
        policyOverrideNote = 'policy_override action written — operator explicitly approved policy exception';
    } catch (err) {
        policyOverrideNote = 'policy_override FAILED (non-fatal): ' + err.message;
    }
}

// ── 4. Proof: query back all relevant rows ─────────────────────────────────────

const taskRow = db.prepare('SELECT id, status, meta_json FROM tasks WHERE id=?').get(taskId);
const taskMeta = JSON.parse(taskRow.meta_json || '{}');

const actionRows = db.prepare(
    "SELECT id, ts, type, status, reason, meta_json FROM actions WHERE session_id=? ORDER BY rowid ASC"
).all(sid);

db.close();

const output = {
    ok: true,
    task_id: taskId,
    session_id: sid,
    result: {
        task_status: taskRow.status,
        stop_loss_triggered_preserved: taskMeta.stop_loss_triggered,
        policy_gate_triggered_preserved: taskMeta.policy_gate_triggered,
        stop_loss_retry_approved: taskMeta.stop_loss_retry_approved,
        policy_override_action_id: policyOverrideActionId,
        policy_override_note: policyOverrideNote,
    },
    action_rows: actionRows.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        reason: r.reason,
        meta: JSON.parse(r.meta_json || '{}'),
    })),
    checks: {
        task_unblocked: taskRow.status === 'todo',
        stop_loss_evidence_preserved: taskMeta.stop_loss_triggered === true,
        policy_gate_evidence_preserved: taskMeta.policy_gate_triggered === true,
        retry_approved: taskMeta.stop_loss_retry_approved === true,
        policy_override_action_written: policyOverrideActionId !== null,
        action_type_policy_override_exists: actionRows.some(r => r.type === 'policy_override'),
        original_policy_gate_action_exists: actionRows.some(r => r.type === 'policy_gate'),
    },
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(Object.values(output.checks).every(Boolean) ? 0 : 1);
