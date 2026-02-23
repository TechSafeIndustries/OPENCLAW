const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.cwd(), 'db', 'openclaw_ledger.db'), { readonly: true });

const actions = db.prepare('SELECT id, type, actor, status, reason, ts FROM actions ORDER BY ts DESC LIMIT 8').all();
const task = db.prepare("SELECT id, session_id, status, owner_agent FROM tasks WHERE id LIKE '%task_real%' LIMIT 1").get();
db.close();

console.log(JSON.stringify({ task_state: task, recent_actions: actions }, null, 2));
