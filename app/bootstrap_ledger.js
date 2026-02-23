/**
 * OpenClaw — SQLite Ledger Bootstrap
 * -----------------------------------
 * Applies 001_init.sql schema, upserts agents + routing_rules from registry,
 * and logs a bootstrap session + action as proof-of-life.
 *
 * Usage: node app/bootstrap_ledger.js
 * Deps:  better-sqlite3 (only non-core dep)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ── Paths (all relative to repo root) ────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'db');
const DB_PATH = path.join(DB_DIR, 'openclaw_ledger.db');
const SCHEMA_PATH = path.join(ROOT, 'schema', '001_init.sql');
const REGISTRY_PATH = path.join(ROOT, 'agents', 'registry_v1.json');

// ── Ensure db/ folder exists ──────────────────────────────────────────────────
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── Open DB ───────────────────────────────────────────────────────────────────
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
} catch (err) {
    console.error('FAIL: could not open database:', err.message);
    process.exit(1);
}

// ── Task 1: Apply schema ──────────────────────────────────────────────────────
try {
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schemaSql);
    console.log('OK: schema applied');
} catch (err) {
    console.error('FAIL: schema apply failed:', err.message);
    db.close();
    process.exit(1);
}

// ── Load registry ─────────────────────────────────────────────────────────────
let registry;
try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
} catch (err) {
    console.error('FAIL: could not parse registry_v1.json:', err.message);
    db.close();
    process.exit(1);
}

// ── Task 2: Upsert agents ─────────────────────────────────────────────────────
const upsertAgent = db.prepare(`
  INSERT INTO agents
    (name, version, status, purpose, scope_json, io_schema_json, policies_json, priority, owner)
  VALUES
    (@name, @version, @status, @purpose, @scope_json, @io_schema_json, @policies_json, @priority, @owner)
  ON CONFLICT(name) DO UPDATE SET
    version       = excluded.version,
    status        = excluded.status,
    purpose       = excluded.purpose,
    scope_json    = excluded.scope_json,
    io_schema_json = excluded.io_schema_json,
    policies_json = excluded.policies_json,
    priority      = excluded.priority,
    owner         = excluded.owner
`);

const insertAgents = db.transaction((agents) => {
    for (const agent of agents) {
        upsertAgent.run({
            name: agent.name,
            version: agent.version,
            status: agent.status,
            purpose: agent.purpose,
            scope_json: JSON.stringify(agent.scope ?? {}),
            io_schema_json: JSON.stringify(agent.io_schema ?? {}),
            policies_json: JSON.stringify(agent.policies ?? {}),
            priority: agent.priority ?? 0,
            owner: agent.owner ?? null,
        });
    }
});

try {
    insertAgents(registry.agents);
    console.log(`OK: agents upserted = ${registry.agents.length}`);
} catch (err) {
    console.error('FAIL: agent upsert failed:', err.message);
    db.close();
    process.exit(1);
}

// ── Task 3: Upsert routing_rules ──────────────────────────────────────────────
const upsertRule = db.prepare(`
  INSERT INTO routing_rules
    (id, intent, primary_agent, secondary_agents_json, requires_governance_review, constraints_json)
  VALUES
    (@id, @intent, @primary_agent, @secondary_agents_json, @requires_governance_review, @constraints_json)
  ON CONFLICT(intent) DO UPDATE SET
    primary_agent               = excluded.primary_agent,
    secondary_agents_json       = excluded.secondary_agents_json,
    requires_governance_review  = excluded.requires_governance_review,
    constraints_json            = excluded.constraints_json
`);

const insertRules = db.transaction((rules) => {
    for (const rule of rules) {
        upsertRule.run({
            id: 'rule_' + rule.intent.toLowerCase(),
            intent: rule.intent,
            primary_agent: rule.primary_agent,
            secondary_agents_json: JSON.stringify(rule.secondary_agents ?? []),
            requires_governance_review: rule.requires_governance_review ? 1 : 0,
            constraints_json: JSON.stringify(rule.constraints ?? []),
        });
    }
});

try {
    insertRules(registry.routing_rules);
    console.log(`OK: routing_rules upserted = ${registry.routing_rules.length}`);
} catch (err) {
    console.error('FAIL: routing_rules upsert failed:', err.message);
    db.close();
    process.exit(1);
}

// ── Task 4: Bootstrap session + action ───────────────────────────────────────
const now = new Date().toISOString();

const upsertSession = db.prepare(`
  INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
  VALUES (@id, @started_at, @ended_at, @initiator, @mode, @status, @summary)
  ON CONFLICT(id) DO UPDATE SET
    started_at = excluded.started_at,
    status     = excluded.status,
    summary    = excluded.summary
`);

const upsertAction = db.prepare(`
  INSERT INTO actions (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
  VALUES (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
  ON CONFLICT(id) DO UPDATE SET
    ts     = excluded.ts,
    status = excluded.status,
    reason = excluded.reason
`);

try {
    const bootTx = db.transaction(() => {
        upsertSession.run({
            id: 'boot_session',
            started_at: now,
            ended_at: null,
            initiator: 'system',
            mode: 'on_demand',
            status: 'open',
            summary: 'bootstrap',
        });
        upsertAction.run({
            id: 'boot_action',
            session_id: 'boot_session',
            ts: now,
            actor: 'system',
            type: 'bootstrap',
            input_ref: null,
            output_ref: null,
            status: 'ok',
            reason: 'schema+registry loaded',
            meta_json: null,
        });
    });
    bootTx();
    console.log('OK: boot session logged');
} catch (err) {
    console.error('FAIL: boot session/action insert failed:', err.message);
    db.close();
    process.exit(1);
}

db.close();
process.exit(0);
