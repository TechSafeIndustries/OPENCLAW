const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'openclaw_ledger.db'));
const ts = new Date().toISOString();
db.prepare(`
    INSERT INTO decisions (id, session_id, ts, decision_type, subject, options_json, selected_option, rationale, approved_by)
    VALUES (?, ?, ?, 'approve', ?, '{"intent":"CDMS_EXECUTE"}', 'approve', 'Smoke test approval', 'mikes')
`).run('smoke_approval_' + Date.now(), 'smoke_session', ts, 'CDMS batch: MoveBatch_smoke_test');
db.close();
console.log('Approval inserted for MoveBatch_smoke_test');
