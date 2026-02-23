/**
 * OpenClaw — Tasks Policy Gate CLI v1
 * ----------------------------------------
 * Marks a task as blocked due to an autonomy policy gate and writes a
 * dedicated `policy_gate` audit action row. Called by workflow:governance-triage
 * when the Autonomy Policy Matrix denies auto-execution.
 *
 * Why not tasks:stop-loss?
 *   tasks:stop-loss writes type=stop_loss — semantically wrong for a policy
 *   gate (the task never executed; it was blocked pre-execution by policy).
 *   Policy gates need their own action type for clean audit queries.
 *
 * Why not tasks:update?
 *   tasks:update hardcodes type=task_update. Cannot write policy_gate type.
 *
 * Usage:
 *   node app/tasks_policy_gate_cli_v1.js <task_id>
 *     --reason   "<text>"     short gate reason (max 240 chars, required)
 *     --policy   "<text>"     policy rule that triggered the gate (required)
 *     [--owner   <agent>]     default: cos
 *     [--session <id>]        override session (else inferred from task row)
 *     [--phrase  <phrase>]    forbidden phrase that matched (optional)
 *     [--intent  <intent>]    intent that was gated (optional)
 *
 * Guard: if task.meta_json.policy_gate_triggered=true already → idempotent exit 0.
 *
 * Writes (single atomic transaction):
 *   1. UPDATE tasks SET status='blocked', meta_json=<merged policy gate block>
 *      (adds hil_required=true, policy_gate_triggered=true, policy_gate_reason, etc.)
 *   2. INSERT INTO actions type='policy_gate', status='gated'
 *
 * Output: JSON only (stdout). Errors: JSON stderr.
 * Exit 0 = OK (gate applied or already applied). Exit 1 = error/not-found.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const taskId = args.find(a => !a.startsWith('-'));
const reason = flagVal('--reason');
const policy = flagVal('--policy');
const owner = flagVal('--owner') || 'cos';
const sessionArg = flagVal('--session') || null;
const matchedPhrase = flagVal('--phrase') || null;
const matchedIntent = flagVal('--intent') || null;

// ── Validate ──────────────────────────────────────────────────────────────────
const valErrors = [];
if (!taskId) valErrors.push('Missing required argument: <task_id>');
if (!reason || reason.trim().length === 0) valErrors.push('--reason is required and must be non-empty');
if (reason && reason.length > 240) valErrors.push(`--reason must be ≤ 240 chars (got ${reason.length})`);
if (!policy || policy.trim().length === 0) valErrors.push('--policy is required (policy rule name)');
if (owner.length > 40) valErrors.push(`--owner must be ≤ 40 chars (got ${owner.length})`);

if (valErrors.length > 0) {
    process.stderr.write(JSON.stringify({
        ok: false,
        error: 'VALIDATION_FAILED',
        details: valErrors,
        usage: 'node app/tasks_policy_gate_cli_v1.js <task_id> --reason "<text>" --policy "<rule>" [--owner <agent>] [--session <id>] [--phrase <phrase>] [--intent <intent>]',
    }) + '\n');
    process.exit(1);
}

const trimmedReason = reason.trim();
const trimmedPolicy = policy.trim();

// ── Open DB ───────────────────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
} catch (err) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_OPEN_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Fetch task ────────────────────────────────────────────────────────────────
let existing;
try {
    existing = db.prepare(
        'SELECT id, session_id, created_at, owner_agent, status, title, details, meta_json FROM tasks WHERE id = ?'
    ).get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_QUERY_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

if (!existing) {
    db.close();
    process.stdout.write(JSON.stringify({ ok: false, error: 'NOT_FOUND', task_id: taskId }) + '\n');
    process.exit(1);
}

let existingMeta = {};
try { existingMeta = JSON.parse(existing.meta_json || '{}'); } catch (_) { /* start clean */ }

const resolvedSessionId = sessionArg || existing.session_id || 'openclaw_ops';
const now = new Date().toISOString();

// ── Idempotency guard ─────────────────────────────────────────────────────────
if (existingMeta.policy_gate_triggered === true) {
    db.close();
    process.stdout.write(JSON.stringify({
        ok: true,
        idempotent: true,
        task_id: taskId,
        status: existing.status,
        policy_gate_reason: existingMeta.policy_gate_reason,
        policy_gate_at: existingMeta.policy_gate_at,
        notes: ['policy_gate_triggered=true already on this task — no-op (idempotent)'],
    }) + '\n');
    process.exit(0);
}

// ── Build policy gate metadata block ─────────────────────────────────────────
const newMeta = Object.assign({}, existingMeta, {
    hil_required: true,
    policy_gate_triggered: true,
    policy_gate_reason: trimmedReason,
    policy_gate_policy: trimmedPolicy,
    policy_gate_at: now,
    policy_gate_owner: owner,
    policy_gate_phrase: matchedPhrase,
    policy_gate_intent: matchedIntent,
    updated_at: now,
});
const newMetaJson = JSON.stringify(newMeta);

// ── Build action row ──────────────────────────────────────────────────────────
const actionId = 'policy_gate_' + Date.now();
const actionReason = [
    `task_id=${taskId}`,
    `policy=${trimmedPolicy}`,
    matchedPhrase ? `phrase="${matchedPhrase}"` : null,
    matchedIntent ? `intent=${matchedIntent}` : null,
    `reason="${trimmedReason.slice(0, 80)}"`,
].filter(Boolean).join('; ');

const actionMeta = JSON.stringify({
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    policy: trimmedPolicy,
    reason: trimmedReason,
    matched_phrase: matchedPhrase,
    matched_intent: matchedIntent,
    before: { status: existing.status, owner_agent: existing.owner_agent },
    after: { status: 'blocked', hil_required: true },
});

// ── Atomic transaction ────────────────────────────────────────────────────────
try {
    db.transaction(() => {
        db.prepare(
            'UPDATE tasks SET status = ?, owner_agent = ?, meta_json = ? WHERE id = ?'
        ).run('blocked', owner, newMetaJson, taskId);

        db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `).run({
            id: actionId,
            session_id: resolvedSessionId,
            ts: now,
            actor: 'ops',
            type: 'policy_gate',
            input_ref: null,
            output_ref: null,
            status: 'gated',
            reason: actionReason,
            meta_json: actionMeta,
        });
    })();
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_WRITE_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Re-fetch ──────────────────────────────────────────────────────────────────
let updated;
try {
    updated = db.prepare('SELECT id, status, owner_agent, meta_json FROM tasks WHERE id = ?').get(taskId);
} catch (err) {
    db.close();
    process.stderr.write(JSON.stringify({ ok: false, error: 'DB_REFETCH_FAILED: ' + err.message }) + '\n');
    process.exit(1);
}
db.close();

const updatedMeta = (() => { try { return JSON.parse(updated.meta_json || '{}'); } catch (_) { return {}; } })();

process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: resolvedSessionId,
    owner,
    action_id: actionId,
    action_type: 'policy_gate',
    before: {
        status: existing.status,
        owner_agent: existing.owner_agent,
    },
    after: {
        status: updated.status,
        hil_required: updatedMeta.hil_required,
        policy_gate_triggered: updatedMeta.policy_gate_triggered,
        policy_gate_reason: updatedMeta.policy_gate_reason,
        policy_gate_policy: updatedMeta.policy_gate_policy,
        policy_gate_phrase: updatedMeta.policy_gate_phrase,
        policy_gate_intent: updatedMeta.policy_gate_intent,
        policy_gate_at: updatedMeta.policy_gate_at,
    },
    notes: [
        'Task marked blocked in single atomic transaction (UPDATE tasks + INSERT action)',
        'action type: policy_gate (distinct from stop_loss and task_update)',
        'hil_required=true: task requires workflow:human-review before any retry',
        'To remediate: npm run workflow:human-review -- <task_id> --decision retry|close|reject --reason "<reason>"',
    ],
}, null, 2) + '\n');
process.exit(0);
