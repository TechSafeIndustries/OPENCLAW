const Database = require("better-sqlite3");
const db = new Database("db/openclaw_ledger.db");

function dump(name){
  console.log("\n=== " + name.toUpperCase() + " ===");
  const rows = db.prepare(`PRAGMA table_info('${name}')`).all();
  rows.forEach(r => console.log(`${r.cid}\t${r.name}\t${r.type}\t${r.notnull}\t${r.dflt_value}\t${r.pk}`));
}

dump("actions");
dump("sessions");
db.close();
