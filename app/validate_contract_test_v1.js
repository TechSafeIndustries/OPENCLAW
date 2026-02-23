/**
 * OpenClaw — Contract Validate Test v1
 * --------------------------------------
 * Smoke-tests validateAgainstContract() against:
 *   - good_output: conforms to all rules
 *   - bad_output:  summary > 300 chars, missing ledger_writes, outputs item missing title
 *
 * Usage:
 *   node app/validate_contract_test_v1.js
 *
 * Output: JSON only.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { validateAgainstContract } = require('./contract_validate_v1');

// ── Load cos contract ─────────────────────────────────────────────────────────
const contractPath = path.resolve(__dirname, '..', 'agents', 'contracts', 'cos.contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

// ── Good output ───────────────────────────────────────────────────────────────
const good_output = {
    agent: 'cos',
    version: 'v1.0',
    intent: 'PLAN_WORK',
    summary: 'CoS agent received a valid planning request and produced a structured Q1 roadmap plan.',
    outputs: [
        {
            type: 'plan',
            title: 'Q1 Roadmap Plan',
            content: 'Structured plan for Q1 including milestones and owners.',
        },
    ],
    ledger_writes: [
        {
            table: 'artifacts',
            type: 'plan',
        },
    ],
    next_actions: [
        {
            title: 'Review Q1 milestones with stakeholders',
            details: 'Schedule a 30-minute review session with the product and eng leads.',
            owner_agent: 'cos',
        },
    ],
};

// ── Bad output ────────────────────────────────────────────────────────────────
// Failures introduced:
//   1. summary > 300 chars
//   2. ledger_writes missing entirely (required_fields includes it)
//   3. outputs[0] missing "title"
const bad_output = {
    agent: 'cos',
    version: 'v1.0',
    intent: 'PLAN_WORK',
    // summary is 350 chars — intentionally too long
    summary: 'A'.repeat(350),
    outputs: [
        {
            type: 'plan',
            // title intentionally missing
            content: 'Some content here.',
        },
    ],
    // ledger_writes intentionally missing
};

// ── Run both ──────────────────────────────────────────────────────────────────
const good_result = validateAgainstContract(contract, good_output);
const bad_result = validateAgainstContract(contract, bad_output);

process.stdout.write(JSON.stringify({
    good_ok: good_result.ok,
    bad_ok: bad_result.ok,
    bad_errors: bad_result.errors || [],
}, null, 2) + '\n');
