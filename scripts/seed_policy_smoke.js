/**
 * Smoke test seed — creates two tasks for policy gate smoke tests.
 * Task A: safe tier1 (PLAN_WORK) — should pass triage.
 * Task B: forbidden phrase in title — should trigger policy_gate.
 * 
 * Run: node scripts/seed_policy_smoke.js
 */
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const now = new Date().toISOString();
const SID = 'sess_1771824975078';
const ts = Date.now();

const taskA = 'task_policy_smoke_A_' + ts;
const taskB = 'task_policy_smoke_B_' + (ts + 1);

const insert = db.prepare(
    'INSERT INTO tasks (id,session_id,created_at,due_at,owner_agent,status,title,details,dependencies_json,meta_json) VALUES (?,?,?,NULL,?,?,?,?,?,?)'
);

db.transaction(() => {
    // Task A — safe, tier1 allowed
    insert.run(
        taskA, SID, now, 'cos', 'todo',
        'Review sprint governance checklist',
        'Audit and review the weekly governance checklist for sprint tasks.',
        '[]',
        JSON.stringify({ intent: 'PLAN_WORK', source: 'smoke_test_policy_A' })
    );

    // Task B — forbidden phrase "send email" in title (created 1ms later so it sorts after A)
    insert.run(
        taskB, SID, new Date(ts + 2).toISOString(), 'cos', 'todo',
        'Run SOP and send email to client with results',
        'Execute the process checklist and send email notification to the client.',
        '[]',
        JSON.stringify({ intent: 'OPS_INTERNAL', source: 'smoke_test_policy_B' })
    );
})();

db.close();
console.log(JSON.stringify({ ok: true, task_a: taskA, task_b: taskB, session: SID }, null, 2));
