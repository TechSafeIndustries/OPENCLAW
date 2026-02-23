'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'db', 'openclaw_ledger.db'));
db.pragma('busy_timeout = 2000');

const rows = db.prepare(
    "SELECT id, ts, type, status, reason, meta_json FROM actions WHERE type='policy_override' ORDER BY ts DESC LIMIT 5"
).all();

console.log(JSON.stringify(rows.map(r => ({
    id: r.id,
    ts: r.ts,
    type: r.type,
    status: r.status,
    reason: r.reason,
    meta: JSON.parse(r.meta_json || '{}'),
})), null, 2));

db.close();
