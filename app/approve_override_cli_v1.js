/**
 * OpenClaw — Approve Override CLI v1
 * ------------------------------------
 * Writes a governance approval record to the ledger for a given session + intent.
 * Called by operators before using --override on openclaw_cli_v1.js.
 *
 * Usage:
 *   node app/approve_override_cli_v1.js <session_id> <intent> <approved_by> <rationale...> [--run <run_id>]
 *
 * Arguments:
 *   session_id   — Session ID that will use the override (must match request)
 *   intent       — Intent string to approve (e.g. SALES_INTERNAL)
 *   approved_by  — Operator identifier (name, email, or handle)
 *   rationale... — One or more words; joined as the approval rationale
 *
 * Exit codes:
 *   0  — Approval written successfully
 *   1  — Missing arguments or DB write error
 *
 * Output: JSON only (stdout).
 *
 * Deps: Node core only + existing approveOverride().
 */

'use strict';

const { approveOverride } = require('./approve_override_v1');

// Extract optional --run <run_id> flag, then collect remaining positional args
const args = process.argv.slice(2);
const runFlagIdx = args.indexOf('--run');
const run_id = runFlagIdx !== -1 ? (args[runFlagIdx + 1] || null) : null;
// Remove --run and its value from the positional args list (only when --run is present)
const positional = runFlagIdx !== -1
    ? args.filter((_, i) => i !== runFlagIdx && i !== runFlagIdx + 1)
    : args.slice();

if (positional.length < 4) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: 'Usage: node app/approve_override_cli_v1.js <session_id> <intent> <approved_by> <rationale...> [--run <run_id>]',
        received_args: args,
    }) + '\n');
    process.exit(1);
}

const session_id = positional[0];
const intent = positional[1];
const approved_by = positional[2];
const rationale = positional.slice(3).join(' ');

// ── Call approveOverride ───────────────────────────────────────────────────────
const result = approveOverride({ session_id, intent, approved_by, rationale, run_id });

if (!result.ok) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: result.error,
    }) + '\n');
    process.exit(1);
}

process.stdout.write(JSON.stringify({
    ok: true,
    session_id,
    intent,
    approved_by,
    run_id: run_id || null,
    decision_id: result.decision_id,
}) + '\n');
process.exit(0);
