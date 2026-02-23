-- =========================================================
-- OpenClaw v1 SQLite Ledger Schema
-- Migration: 001_init
-- =========================================================
PRAGMA foreign_keys = ON;

-- Sessions: top-level interaction containers
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  initiator TEXT NOT NULL,          -- user/system
  mode TEXT NOT NULL,               -- on_demand
  status TEXT NOT NULL,             -- open/closed
  summary TEXT
);

-- Messages: raw conversational content
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  role TEXT NOT NULL,               -- user/cos/agent/system
  agent_name TEXT,                  -- nullable
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Actions: atomic orchestration steps
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,              -- cos/governance/sales/etc.
  type TEXT NOT NULL,               -- route/plan/check/produce/write_db
  input_ref TEXT,
  output_ref TEXT,
  status TEXT NOT NULL,             -- ok/blocked/failed
  reason TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Decisions: approval gates + final calls
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  decision_type TEXT NOT NULL,      -- approve/deny/defer
  subject TEXT NOT NULL,
  options_json TEXT,
  selected_option TEXT,
  rationale TEXT,
  approved_by TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Tasks: operating system work items
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  created_at TEXT NOT NULL,
  due_at TEXT,
  owner_agent TEXT NOT NULL,
  status TEXT NOT NULL,             -- todo/doing/done/blocked
  title TEXT NOT NULL,
  details TEXT,
  dependencies_json TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Artifacts: anything produced by agents
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,               -- brief/policy/plan/table/etc.
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  classification TEXT NOT NULL,     -- internal/confidential
  tags_json TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Agents: registry entries
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,            -- cos/governance/sales/marketing/product/ops
  version TEXT NOT NULL,
  status TEXT NOT NULL,             -- active/disabled
  purpose TEXT NOT NULL,
  scope_json TEXT NOT NULL,         -- allowed domains + exclusions
  io_schema_json TEXT NOT NULL,     -- required input + output structure rules
  policies_json TEXT NOT NULL,      -- hard rules + gating triggers
  priority INTEGER NOT NULL,
  owner TEXT
);

-- Routing rules: deterministic intent → agent mapping
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  intent TEXT NOT NULL UNIQUE,      -- controlled enum you define
  primary_agent TEXT NOT NULL,
  secondary_agents_json TEXT,
  requires_governance_review INTEGER NOT NULL DEFAULT 0,  -- 0/1
  constraints_json TEXT,
  FOREIGN KEY (primary_agent) REFERENCES agents(name) ON DELETE RESTRICT
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_ts   ON messages(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_actions_session_ts    ON actions(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_decisions_session_ts  ON decisions(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_artifacts_session_ts  ON artifacts(session_id, ts);
