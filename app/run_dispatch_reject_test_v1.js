/**
 * OpenClaw — Dispatch Reject Test v1
 * ------------------------------------
 * Proves that the REJECTED path from contract validation does NOT write
 * artifacts or tasks to the ledger.
 *
 * Runs one PLAN_WORK request through routeRequest + dispatch using
 * KIMI_MODE=bad_stub (which returns deliberately invalid output), then
 * queries the DB to confirm zero artifacts and zero tasks for the session.
 *
 * Usage:
 *   node app/run_dispatch_reject_test_v1.js
 *
 * Output: JSON only.
 */

'use strict';

process.env.KIMI_MODE = 'bad_stub';

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const { routeRequest } = require('./router_v1');
const { dispatch } = require('./dispatch_v1');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

// ── Build a clean PLAN_WORK request ──────────────────────────────────────────
const SESSION_ID = 'reject_test_session';
const run_id = 'run_reject_' + Date.now();

const request = {
    request_id: 'req_reject_' + Date.now(),
    session_id: SESSION_ID,
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Plan the Q1 roadmap — reject path validation test.',
    constraints: {
        no_public_exposure: true,
        structured_outputs_only: true,
        on_demand_only: true,
        additional: [],
    },
    context: {},
};

// ── Route ─────────────────────────────────────────────────────────────────────
let routeOutput;
try {
    routeOutput = routeRequest(request);
} catch (err) {
    process.stdout.write(JSON.stringify({ error: 'routeRequest failed: ' + err.message }) + '\n');
    process.exit(1);
}

if (routeOutput.error) {
    process.stdout.write(JSON.stringify({ error: routeOutput.error }) + '\n');
    process.exit(1);
}

// ── Dispatch (bad_stub will produce invalid output → REJECTED) ────────────────
let dispatchResult;
try {
    dispatchResult = dispatch(routeOutput, request, { override_governance: false, run_id });
} catch (err) {
    process.stdout.write(JSON.stringify({ error: 'dispatch failed: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Query DB: verify no artifacts/tasks written for this session + run_id ─────
const db = new Database(DB_PATH, { readonly: true });

const runPat = `%"run_id":"${run_id}"%`;

const artifactsCount = db.prepare(
    'SELECT COUNT(*) AS n FROM artifacts WHERE session_id = ? AND meta_json LIKE ?'
).get(SESSION_ID, runPat).n;

const tasksCount = db.prepare(
    'SELECT COUNT(*) AS n FROM tasks WHERE session_id = ? AND meta_json LIKE ?'
).get(SESSION_ID, runPat).n;

// Last 5 actions for this session (for human readability in output)
const recentActions = db.prepare(
    'SELECT ts, type, status, reason FROM actions WHERE session_id = ? ORDER BY rowid DESC LIMIT 5'
).all(SESSION_ID);

db.close();

// ── Output ────────────────────────────────────────────────────────────────────
const validationErrors = dispatchResult.meta?.validation_errors || [];

process.stdout.write(JSON.stringify({
    run_id,
    session_id: SESSION_ID,
    dispatch_state: dispatchResult.state,
    next_step: dispatchResult.next_step,
    reason: dispatchResult.reason,
    validation_errors_count: validationErrors.length,
    validation_errors: validationErrors,
    artifacts_count: artifactsCount,
    tasks_count: tasksCount,
    recent_actions_last5: recentActions,
}, null, 2) + '\n');

// ── Assert ────────────────────────────────────────────────────────────────────
const passed = (
    dispatchResult.state === 'REJECTED' &&
    validationErrors.length > 0 &&
    artifactsCount === 0 &&
    tasksCount === 0
);

process.stdout.write(JSON.stringify({
    test_passed: passed,
    checks: {
        state_is_REJECTED: dispatchResult.state === 'REJECTED',
        has_validation_errors: validationErrors.length > 0,
        artifacts_not_written: artifactsCount === 0,
        tasks_not_written: tasksCount === 0,
    },
}) + '\n');

process.exit(passed ? 0 : 1);
