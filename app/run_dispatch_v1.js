/**
 * OpenClaw — Dispatcher v1 Test Runner
 * --------------------------------------
 * Runs 3 cases through routeRequest() → dispatch() and prints one compact
 * JSON line per case. No LLM calls. No SQLite writes.
 *
 * Usage: node app/run_dispatch_v1.js
 */

'use strict';

// ── Enable Kimi stub mode before any imports resolve env ────────────────────
process.env.KIMI_MODE = 'stub';

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const { routeRequest } = require('./router_v1');
const { dispatch } = require('./dispatch_v1');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

const BASE_CONSTRAINTS = {
    no_public_exposure: true,
    structured_outputs_only: true,
    on_demand_only: true,
    additional: [],
};

const CASES = [
    {
        label: 'CLEAN_PLAN_WORK',
        input: {
            request_id: crypto.randomUUID(),
            session_id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            initiator: 'user',
            user_goal: 'Plan and task out Q1 sales pipeline qualification process for the SMB segment.',
            constraints: BASE_CONSTRAINTS,
            context: { prior_session_id: null, active_tasks: [], tags: ['sales', 'q1', 'smb'] },
            // no risk_flags → clean path
        },
    },
    {
        label: 'SALES_WITH_EXTERNAL_COMMS',
        input: {
            request_id: crypto.randomUUID(),
            session_id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            initiator: 'user',
            user_goal: 'Draft outbound email to prospect and update pipeline status.',
            constraints: BASE_CONSTRAINTS,
            context: { prior_session_id: null, active_tasks: [], tags: ['sales', 'external'] },
            risk_flags: { external_comms: true },
        },
    },
    {
        label: 'ARCH_CHANGE_REQUEST',
        input: {
            request_id: crypto.randomUUID(),
            session_id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            initiator: 'user',
            user_goal: 'Add public webhook endpoint and deploy 24/7 VPS worker.',
            constraints: BASE_CONSTRAINTS,
            context: { prior_session_id: null, active_tasks: [], tags: ['infra'] },
            risk_flags: { architecture_change: true, deployment: true },
        },
    },
];

let exitCode = 0;

for (const { label, input } of CASES) {
    try {
        const route = routeRequest(input);
        const disp = dispatch(route, input, { override_governance: false });

        const line = {
            case: label,
            intent: route.intent || null,
            governance_required: route.requires_governance_review || false,
            gate_decision: route.gate_decision || null,
            dispatch_state: disp.state,
            agent: disp.agent,
            next_step: disp.next_step,
            action_status: ({ DISPATCHED: 'ok', GATED: 'gated', BLOCKED: 'blocked' })[disp.state] || 'unknown',
            ledger_error: disp.meta?.ledger_error || null,
        };

        process.stdout.write(JSON.stringify(line) + '\n');
    } catch (err) {
        process.stderr.write(JSON.stringify({ case: label, error: err.message }) + '\n');
        exitCode = 1;
    }
}
// ── Artifact count check ──────────────────────────────────────────────────────
try {
    const db = new Database(DB_PATH, { readonly: true });
    const count = db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n;
    db.close();
    process.stdout.write(JSON.stringify({ artifacts_written_check: String(count) }) + '\n');
} catch (err) {
    process.stdout.write(JSON.stringify({ artifacts_written_check: 'ERROR: ' + err.message }) + '\n');
}

process.exit(exitCode);
