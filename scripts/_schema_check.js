'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '..', 'db', 'openclaw_ledger.db'));
db.pragma('busy_timeout = 3000');

const tables = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
).all();

for (const t of tables) {
    console.log('\n=== ' + t.name + ' ===');
    console.log(t.sql);
}

db.close();
