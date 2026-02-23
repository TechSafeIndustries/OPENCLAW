/**
 * OpenClaw — Operator CLI v1
 * ---------------------------
 * On-demand single-request runner. No server. No persistent process.
 *
 * Usage:
 *   node app/openclaw_cli_v1.js <path_to_request.json> [--override]
 *
 * Arguments:
 *   <path_to_request.json>  Path to a JSON file conforming to the router input spec.
 *   --override              Set override_governance=true. Requires a prior approval
 *                           record in the ledger, otherwise exits with code 2.
 *
 * Exit codes:
 *   0  — OK (DISPATCHED / GATED / BLOCKED — all resolved states)
 *   1  — Input error or unexpected exception
 *   2  — APPROVAL_REQUIRED (override requested but no ledger record found)
 *
 * Output: JSON only (stdout). Errors: JSON on stderr.
 *
 * Deps: Node core only (no new deps beyond existing project modules).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const helpFlag = args.includes('--help') || args.includes('-h');

if (helpFlag || args.length === 0) {
    process.stdout.write(JSON.stringify({
        usage: 'node app/openclaw_cli_v1.js <path_to_request.json> [--override] [--new-session] [--founder]',
        flags: {
            '--override': 'Set override_governance=true (requires prior ledger approval)',
            '--new-session': 'Generate a fresh session_id (sess_<timestamp>) for this run',
            '--founder': 'Enable Founder Mode: auto-allow draft-only SALES_INTERNAL / MARKETING_INTERNAL requests'
                + ' when the ONLY governance flag is external_comms. All hard blocks remain active.',
        },
        notes: 'If request JSON omits session_id, defaults to "openclaw_ops" unless --new-session is set.',
        exit_codes: { 0: 'OK', 1: 'Input/runtime error', 2: 'APPROVAL_REQUIRED' },
    }, null, 2) + '\n');
    process.exit(0);
}

const overrideFlag = args.includes('--override');
const newSessionFlag = args.includes('--new-session');
const founderFlag = args.includes('--founder');
const requestPath = args.find(a => !a.startsWith('-'));

// Generate a stable run_id for this CLI invocation — threaded into dispatch + ledger meta
const run_id = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

if (!requestPath) {
    process.stderr.write(JSON.stringify({ error: 'Missing required argument: <path_to_request.json>' }) + '\n');
    process.exit(1);
}

// ── Load request file ─────────────────────────────────────────────────────────
const resolvedPath = path.resolve(requestPath);

if (!fs.existsSync(resolvedPath)) {
    process.stderr.write(JSON.stringify({ error: `Request file not found: ${resolvedPath}` }) + '\n');
    process.exit(1);
}

let request;
try {
    request = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
} catch (parseErr) {
    process.stderr.write(JSON.stringify({ error: `Failed to parse JSON: ${parseErr.message}` }) + '\n');
    process.exit(1);
}

// ── Validate minimal required fields ────────────────────────────────────────
// session_id is optional here — CLI injects a default below if absent.
const REQUIRED = ['request_id', 'ts', 'initiator', 'user_goal', 'constraints'];
const missing = REQUIRED.filter(f => !(f in request));
if (missing.length > 0) {
    process.stderr.write(JSON.stringify({
        error: 'Request JSON is missing required fields',
        missing,
        required: REQUIRED,
    }) + '\n');
    process.exit(1);
}

// ── Session discipline ────────────────────────────────────────────────────────
// Precedence: request.session_id (if set) > --new-session (fresh ID) > 'openclaw_ops'
if (!request.session_id) {
    request.session_id = newSessionFlag
        ? 'sess_' + Date.now()
        : 'openclaw_ops';
}
const effectiveSessionId = request.session_id;

// ── Load modules (after argv validated so help/error doesn't require DB) ─────
const { routeRequest } = require('./router_v1');
const { dispatch } = require('./dispatch_v1');

// ── Route ─────────────────────────────────────────────────────────────────────
let routeOutput;
try {
    routeOutput = routeRequest(request);
} catch (routeErr) {
    process.stderr.write(JSON.stringify({ error: `routeRequest failed: ${routeErr.message}` }) + '\n');
    process.exit(1);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
let dispatchResult;
try {
    dispatchResult = dispatch(routeOutput, request, {
        override_governance: overrideFlag,
        founder_mode: founderFlag,
        run_id,
    });
} catch (dispErr) {
    process.stderr.write(JSON.stringify({ error: `dispatch failed: ${dispErr.message}` }) + '\n');
    process.exit(1);
}

// ── Handle override denied ────────────────────────────────────────────────────
if (dispatchResult.meta?.override_denied === true) {
    const sessionId = request.session_id || dispatchResult.session_id || '';
    const intent = routeOutput.intent || dispatchResult.intent || '';

    process.stdout.write(JSON.stringify({
        status: 'APPROVAL_REQUIRED',
        run_id,
        session_id: sessionId,
        intent,
        dispatch_state: dispatchResult.state,
        reason: dispatchResult.reason,
        how_to_approve: `npm run approve:override -- "${sessionId}" "${intent}" "<approved_by>" "<rationale>"`,
    }, null, 2) + '\n');
    process.exit(2);
}

// ── Success output ────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    status: 'OK',
    run_id,
    session_id: effectiveSessionId,
    route: {
        intent: routeOutput.intent,
        gate_decision: routeOutput.gate_decision,
        requires_governance_review: routeOutput.requires_governance_review,
        primary_agent: routeOutput.route?.primary_agent || null,
    },
    dispatch: {
        state: dispatchResult.state,
        agent: dispatchResult.agent,
        next_step: dispatchResult.next_step,
        intent: dispatchResult.intent,
        reason: dispatchResult.reason,
        override_governance: dispatchResult.meta?.override_governance || false,
        artifact_id: dispatchResult.meta?.artifact_id || null,
        ledger_error: dispatchResult.meta?.ledger_error || null,
        contract: dispatchResult.meta?.contract || null,
        repair_attempted: dispatchResult.meta?.repair_attempted ?? false,
        repair_succeeded: dispatchResult.meta?.repair_succeeded ?? false,
        draft_only: dispatchResult.meta?.draft_only ?? false,
        governance_bypassed: dispatchResult.meta?.governance_bypassed || null,
    },
}, null, 2) + '\n');
process.exit(0);
