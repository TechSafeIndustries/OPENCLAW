/**
 * OpenClaw — Workflow: Policy Show v1
 * ----------------------------------------
 * Prints the current Autonomy Policy Matrix as deterministic JSON.
 * Read-only. No DB access. No writes.
 *
 * Usage:
 *   node app/workflow_policy_show_v1.js
 *   npm run workflow:policy-show
 *
 * Output on success:
 *   {
 *     ok: true,
 *     policy_path: "policy/autonomy_v1.json",
 *     version: "1.0",
 *     policy: { ... }    // full parsed policy object
 *   }
 *
 * Output on failure (exit code 1):
 *   { ok: false, error: "POLICY_NOT_FOUND|POLICY_READ_FAIL|...", detail: "..." }
 */

'use strict';

const path = require('path');
const { loadPolicy } = require('./utils/policy_loader_v1');

const ROOT = path.resolve(__dirname, '..');

const result = loadPolicy();

if (!result.ok) {
    // Map loader error codes to the spec'd error names
    const specError = result.error === 'POLICY_FILE_NOT_FOUND'
        ? 'POLICY_NOT_FOUND'
        : 'POLICY_READ_FAIL';

    process.stdout.write(JSON.stringify({
        ok: false,
        error: specError,
        loader_code: result.error,
        detail: result.detail || null,
        policy_path: path.relative(ROOT, result.path || ''),
    }, null, 2) + '\n');
    process.exit(1);
}

process.stdout.write(JSON.stringify({
    ok: true,
    policy_path: path.relative(ROOT, result.path),
    version: result.policy.version || null,
    policy: result.policy,
}, null, 2) + '\n');
process.exit(0);
