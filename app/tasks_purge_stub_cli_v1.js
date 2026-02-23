// app/tasks_purge_stub_cli_v1.js
// Mark stub tasks as done (do not delete) to preserve auditability.

const path = require("path");
const Database = require("better-sqlite3");

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  // Accept BOTH forms:
  //   A) node file.js [--owner NAME] -- SESSION_ID   (explicit delimiter)
  //   B) node file.js [--owner NAME] SESSION_ID       (bare positional, no delimiter)
  const out = { owner: "ops", session_id: null };

  const delimIdx = argv.indexOf("--");
  if (delimIdx !== -1) {
    // Form A: everything before "--" is flags, first token after "--" is session_id
    const head = argv.slice(0, delimIdx);
    const tail = argv.slice(delimIdx + 1);
    for (let i = 0; i < head.length; i++) {
      if (head[i] === "--owner" && head[i + 1]) out.owner = head[i + 1];
    }
    out.session_id = (tail[0] || "").trim();
  } else {
    // Form B: scan argv; named flags consume the next token, anything else is session_id
    const NAMED_FLAGS = new Set(["--owner"]);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--owner" && argv[i + 1]) {
        out.owner = argv[i + 1];
        i++; // skip consumed value
      } else if (a.startsWith("--")) {
        // unknown flag — skip (and its value if next token is not a flag)
        if (argv[i + 1] && !argv[i + 1].startsWith("--")) i++;
      } else if (!out.session_id) {
        // first non-flag token is the session_id
        out.session_id = a.trim();
      }
    }
  }

  return out;
}

function safeJsonParse(s) {
  try {
    if (!s) return {};
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function main() {
  const { owner, session_id } = parseArgs(process.argv.slice(2));
  if (!session_id) {
    console.log(
      JSON.stringify(
        { ok: false, error: "MISSING_SESSION_ID: usage npm run tasks:purge-stub -- <session_id> [--owner <name>]" },
        null,
        2
      )
    );
    process.exit(1);
  }

  // DB path is locked by your design: db/openclaw_ledger.db
  const dbPath = path.join(process.cwd(), "db", "openclaw_ledger.db");
  const db = new Database(dbPath);

  const ts = nowIso();

  // Select candidate tasks
  const rows = db
    .prepare(
      `
      SELECT id, meta_json
      FROM tasks
      WHERE session_id = ?
        AND status IN ('todo','doing')
        AND json_extract(meta_json, '$.source') = 'stub'
      ORDER BY created_at ASC
      `
    )
    .all(session_id);

  const updateTask = db.prepare(
    `
    UPDATE tasks
    SET status = 'done',
        meta_json = ?
    WHERE id = ?
    `
  );

  let bad_meta_count = 0;
  const purgedIds = [];

  const txn = db.transaction(() => {
    for (const r of rows) {
      const meta = safeJsonParse(r.meta_json);
      if (!r.meta_json || (typeof r.meta_json === "string" && r.meta_json.trim() && meta && Object.keys(meta).length === 0)) {
        // heuristic: parse failed or empty
        // we still purge, but count it
        // (note: safeJsonParse returns {} on failure)
      }
      if (r.meta_json && r.meta_json.trim() && safeJsonParse(r.meta_json) && Object.keys(safeJsonParse(r.meta_json)).length === 0) {
        bad_meta_count += 1;
      }

      meta.purged_stub = true;
      meta.purged_by = owner;
      meta.purged_at = ts;

      updateTask.run(JSON.stringify(meta), r.id);
      purgedIds.push(r.id);
    }

    // Single audit action row — columns: id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json
    db.prepare(
      `
      INSERT INTO actions (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      `tasks_purge_stub_${Date.now()}`,
      session_id,
      ts,
      owner,
      "tasks_purge_stub",
      null,
      null,
      "ok",
      `session=${session_id}; purged=${purgedIds.length}; bad_meta=${bad_meta_count}`,
      JSON.stringify({ session_id, purged: purgedIds.length, bad_meta_count })
    );
  });

  txn();

  console.log(
    JSON.stringify(
      { ok: true, session_id, owner, purged: purgedIds.length, bad_meta_count, task_ids: purgedIds },
      null,
      2
    )
  );
}

main();