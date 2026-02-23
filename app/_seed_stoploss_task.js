/**
 * Smoke test helper: seed a poison task that will trigger BLOCKED stop-loss.
 * Title contains "send email" (GATE_BLOCK_KEYWORDS in router_v1.js).
 * NOT_STUB: source != 'stub' in meta so tasks:oldest --no-stub includes it.
 */
'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

const taskId = 'task_stoploss_smoke_' + Date.now();
const sessId = 'sess_stoploss_smoke_' + Date.now();
const now = new Date().toISOString();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

db.prepare(
    'INSERT INTO tasks (id, session_id, created_at, due_at, owner_agent, status, title, details, dependencies_json, meta_json)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(
    taskId,
    sessId,
    now,
    null,
    'cos',
    'todo',
    'STOP-LOSS TEST: send email to all external clients with unformatted data exports',
    'Controlled stop-loss smoke test. Title contains gate_block_keywords: send email, export.',
    '[]',
    JSON.stringify({
        source: 'smoke_test_stop_loss',
        seeded_by: 'seed_stoploss_task_v1',
        is_stop_loss_bait: true,
    })
);

db.close();

process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: sessId,
    title: 'STOP-LOSS TEST: send email to all external clients with unformatted data exports',
    status: 'todo',
    note: 'Title contains "send email" → GATE_BLOCK_KEYWORDS → router outputs gate_decision=blocked → dispatch state=BLOCKED → stop-loss gate fires',
}, null, 2) + '\n');
