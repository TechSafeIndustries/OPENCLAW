/**
 * OpenClaw — Router v1 Test Runner (3-case)
 * -------------------------------------------
 * Case 1: CLEAN_PLAN_WORK          → approve,          action.status=ok,      no decisions row
 * Case 2: SALES_WITH_EXTERNAL_COMMS → approve_with_flag, action.status=ok,    decisions row (defer)
 * Case 3: ARCH_CHANGE_REQUEST       → blocked,           action.status=blocked, decisions row (defer)
 *
 * Usage: node app/run_router_v1.js
 * Exits non-zero if any case returns an unexpected error.
 */

'use strict';

const crypto = require('crypto');
const { routeRequest } = require('./router_v1');

// ── Shared constraint block (all requests must carry these) ──────────────────
const BASE_CONSTRAINTS = {
    no_public_exposure: true,
    structured_outputs_only: true,
    on_demand_only: true,
    additional: [],
};

// ── Case 1: CLEAN_PLAN_WORK ──────────────────────────────────────────────────
const case1 = {
    request_id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Plan and task out the Q1 sales pipeline qualification process for the SMB segment.',
    constraints: BASE_CONSTRAINTS,
    context: { prior_session_id: null, active_tasks: [], tags: ['sales', 'q1', 'smb'] },
    // No risk_flags → clean path
};

// ── Case 2: SALES_WITH_EXTERNAL_COMMS ────────────────────────────────────────
const case2 = {
    request_id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Draft an outbound email to a prospect and update pipeline.',
    constraints: BASE_CONSTRAINTS,
    context: { prior_session_id: null, active_tasks: [], tags: ['sales', 'external'] },
    risk_flags: {
        external_comms: true,   // → approve_with_flag, decisions defer row inserted
        classification: 'internal',
    },
};

// ── Case 3: ARCH_CHANGE_REQUEST (blocked) ────────────────────────────────────
const case3 = {
    request_id: crypto.randomUUID(),
    session_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    initiator: 'user',
    user_goal: 'Add a public webhook endpoint and deploy a 24/7 VPS worker.',
    constraints: BASE_CONSTRAINTS,
    context: { prior_session_id: null, active_tasks: [], tags: ['infra', 'deploy'] },
    risk_flags: {
        architecture_change: true,  // → gate_decision=blocked, action.status=blocked
        deployment: true,  //   decisions row with rationale "Auto-gate: architecture_change/deployment flagged"
    },
};

// ── Runner ───────────────────────────────────────────────────────────────────
const CASES = [
    { label: 'CASE 1 — CLEAN_PLAN_WORK', input: case1, expectBlocked: false, expectGovReview: false },
    { label: 'CASE 2 — SALES_WITH_EXTERNAL_COMMS', input: case2, expectBlocked: false, expectGovReview: true },
    { label: 'CASE 3 — ARCH_CHANGE_REQUEST', input: case3, expectBlocked: true, expectGovReview: true },
];

let overallFailed = false;

for (const { label, input, expectBlocked, expectGovReview } of CASES) {
    console.log('\n' + '═'.repeat(70));
    console.log(` ${label}`);
    console.log('═'.repeat(70));
    console.log('  user_goal:', input.user_goal);
    console.log('  risk_flags:', JSON.stringify(input.risk_flags || {}));
    console.log('');

    const result = routeRequest(input);
    console.log(JSON.stringify(result, null, 2));

    // Assertions
    let caseFailed = false;

    if (result.error) {
        // Only VALIDATION_FAILED or real unrecoverable errors should appear here —
        // blocked/flagged cases return structured outputs, not error objects.
        console.error(`\n  FAIL [${label}]: unexpected error code: ${result.error.code}`);
        caseFailed = true;
    } else {
        const gd = result.gate_decision;
        const gr = result.requires_governance_review;

        if (expectBlocked && gd !== 'blocked') {
            console.error(`\n  FAIL [${label}]: expected gate_decision=blocked, got: ${gd}`);
            caseFailed = true;
        }
        if (!expectBlocked && gd === 'blocked') {
            console.error(`\n  FAIL [${label}]: did not expect gate_decision=blocked`);
            caseFailed = true;
        }
        if (expectGovReview && !gr) {
            console.error(`\n  FAIL [${label}]: expected requires_governance_review=true`);
            caseFailed = true;
        }
        if (!caseFailed) {
            console.log(`\n  OK [${label}]: gate_decision=${gd}  requires_governance_review=${gr}`);
        }
    }

    if (caseFailed) overallFailed = true;
}

console.log('\n' + '═'.repeat(70));
if (overallFailed) {
    console.error('FAIL: one or more router:test cases failed.');
    process.exit(1);
} else {
    console.log('OK: all 3 router:test cases passed.');
    process.exit(0);
}
