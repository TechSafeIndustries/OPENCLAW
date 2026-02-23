/**
 * Smoke test audit verifier — confirms policy_gate action rows and task states.
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db'), { readonly: true });

// Policy gate action rows
const actions = db.prepare(
    "SELECT id,ts,type,status,reason,meta_json FROM actions WHERE type='policy_gate' ORDER BY ts DESC LIMIT 5"
).all();
console.log('=== policy_gate audit rows ===');
actions.forEach(a => {
    const m = JSON.parse(a.meta_json || '{}');
    console.log(JSON.stringify({
        id: a.id,
        ts: a.ts,
        type: a.type,
        status: a.status,
        task_id: m.task_id,
        matched_phrase: m.matched_phrase,
        intent: m.matched_intent,
        reason: (a.reason || '').slice(0, 120),
    }, null, 2));
});

// Task B state
const tasksB = db.prepare(
    "SELECT id,status,meta_json FROM tasks WHERE id LIKE 'task_policy_smoke_B%' ORDER BY created_at DESC LIMIT 3"
).all();
console.log('\n=== Task B state (should be blocked + policy_gate_triggered) ===');
tasksB.forEach(t => {
    const m = JSON.parse(t.meta_json || '{}');
    console.log(JSON.stringify({
        id: t.id,
        status: t.status,
        hil_required: m.hil_required,
        policy_gate_triggered: m.policy_gate_triggered,
        policy_gate_phrase: m.policy_gate_phrase,
        policy_gate_reason: (m.policy_gate_reason || '').slice(0, 80),
    }, null, 2));
});

// Task A state
const tasksA = db.prepare(
    "SELECT id,status,meta_json FROM tasks WHERE id LIKE 'task_policy_smoke_A%' ORDER BY created_at DESC LIMIT 3"
).all();
console.log('\n=== Task A state (policy_gate NOT triggered — was tier1 allowed) ===');
tasksA.forEach(t => {
    const m = JSON.parse(t.meta_json || '{}');
    console.log(JSON.stringify({
        id: t.id,
        status: t.status,
        policy_gate_triggered: m.policy_gate_triggered || false,
        stop_loss_triggered: m.stop_loss_triggered || false,
    }, null, 2));
});

db.close();
