/**
 * OpenClaw — Repair Smoke Test v1
 * ---------------------------------
 * Runs one real PLAN_WORK dispatch (KIMI_MODE=real, model override via env)
 * and reports whether the repair loop was triggered and what the outcome was.
 *
 * Usage:
 *   node app/repair_smoke_test_v1.js
 *
 * Env vars:
 *   MOONSHOT_API_KEY  (required)
 *   KIMI_MODEL        (overridden to kimi-k2-turbo-preview if unset)
 *   KIMI_BASE_URL     (optional — default https://api.moonshot.ai/v1)
 *
 * Output: JSON only.
 */

'use strict';

// Set real mode + model before any require
process.env.KIMI_MODE = 'real';
if (!process.env.KIMI_MODEL) {
    process.env.KIMI_MODEL = 'kimi-k2-turbo-preview';
}

const path = require('path');
const Database = require('better-sqlite3');

const { routeRequest } = require('./router_v1');
const { dispatch } = require('./dispatch_v1');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');
const SESSION = 'repair_smoke_session';
const run_id = 'run_repair_' + Date.now();

// ── Request ───────────────────────────────────────────────────────────────────
const request = {
    request_id: 'req_repair_' + Date.now(),
    session_id: SESSION,
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Plan the Q1 roadmap and identify top three workstreams.',
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
    process.stdout.write(JSON.stringify({ ok: false, error: 'routeRequest: ' + err.message }) + '\n');
    process.exit(1);
}

if (routeOutput.error) {
    process.stdout.write(JSON.stringify({ ok: false, error: routeOutput.error }) + '\n');
    process.exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
let result;
try {
    result = dispatch(routeOutput, request, { override_governance: false, run_id });
} catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'dispatch: ' + err.message }) + '\n');
    process.exit(1);
}

// ── Count artifacts/tasks written under this run_id ───────────────────────────
const db = new Database(DB_PATH, { readonly: true });
const runPat = '%' + run_id + '%';

const artifacts = db.prepare(
    'SELECT COUNT(*) AS n FROM artifacts WHERE session_id = ? AND meta_json LIKE ?'
).get(SESSION, runPat).n;

const tasks = db.prepare(
    'SELECT COUNT(*) AS n FROM tasks WHERE session_id = ? AND meta_json LIKE ?'
).get(SESSION, runPat).n;

db.close();

// ── Output ────────────────────────────────────────────────────────────────────
const out = {
    ok: result.state !== 'ERROR',
    run_id,
    model: process.env.KIMI_MODEL,
    dispatch_state: result.state,
    next_step: result.next_step,
    repair_attempted: result.meta?.repair_attempted ?? false,
    repair_succeeded: result.meta?.repair_succeeded ?? false,
    repair_errors: result.meta?.repair_errors || [],
    artifacts_written: artifacts,
    tasks_written: tasks,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(result.state === 'REJECTED' || result.state === 'ERROR' ? 1 : 0);
