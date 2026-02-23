/**
 * OpenClaw — Override Flow Runner v1
 * -------------------------------------
 * Proves that override_governance=true is enforced by the ledger:
 *
 *   Step A: dispatch with override=true, NO approval → GATED + override_denied=true
 *   Step B: write approval record via approveOverride()
 *   Step C: dispatch with override=true, approval EXISTS → DISPATCHED + artifact written
 *
 * Usage: node app/run_override_flow_v1.js
 * Deps:  better-sqlite3, Node core only.
 */

'use strict';

process.env.KIMI_MODE = 'stub';

const path = require('path');
const Database = require('better-sqlite3');

const { routeRequest } = require('./router_v1');
const { dispatch } = require('./dispatch_v1');
const { approveOverride } = require('./approve_override_v1');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

// ── Helper: read artifact count from DB ──────────────────────────────────────
function artifactCount() {
    try {
        const db = new Database(DB_PATH, { readonly: true });
        const n = db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n;
        db.close();
        return n;
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// ── Shared input ──────────────────────────────────────────────────────────────
// Generate a fresh session ID each run so Step A always starts with no approval.
const { randomUUID } = require('crypto');
const SESSION_ID = 'override_test_' + randomUUID().slice(0, 8);

const salesInput = {
    request_id: 'req_override_test',
    session_id: SESSION_ID,
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Draft outbound email to prospect and update pipeline status.',
    classification: 'internal',
    constraints: {
        no_public_exposure: true,
        structured_outputs_only: true,
        on_demand_only: true,
        additional: [],
    },
    context: { prior_session_id: null, active_tasks: [], tags: ['sales', 'external'] },
    risk_flags: { external_comms: true },
};

// ── Step A: override attempted with NO ledger approval ────────────────────────
const routeA = routeRequest(salesInput);
const dispA = dispatch(routeA, salesInput, { override_governance: true });

process.stdout.write(JSON.stringify({
    step: 'A',
    dispatch_state: dispA.state,
    override_denied: dispA.meta.override_denied,
    artifacts_count: artifactCount(),
}) + '\n');

// ── Step B: write approval record ─────────────────────────────────────────────
const approvalResult = approveOverride({
    session_id: SESSION_ID,
    intent: 'SALES_INTERNAL',
    approved_by: 'operator',
    rationale: 'Testing override flow — approved for Q1 pipeline external comms test.',
});

process.stdout.write(JSON.stringify({
    step: 'B',
    approved: approvalResult.ok,
    decision_id: approvalResult.ok ? approvalResult.decision_id : null,
    error: approvalResult.ok ? null : approvalResult.error,
}) + '\n');

// ── Step C: override with approval record now present ─────────────────────────
const routeC = routeRequest(salesInput);
const dispC = dispatch(routeC, salesInput, { override_governance: true });

process.stdout.write(JSON.stringify({
    step: 'C',
    dispatch_state: dispC.state,
    override_denied: dispC.meta.override_denied,
    artifacts_count: artifactCount(),
}) + '\n');

process.exit(0);
