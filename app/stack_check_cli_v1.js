/**
 * OpenClaw — Stack Check CLI v1
 * ----------------------------------------
 * Runs the three core health checks sequentially and emits a single
 * consolidated deterministic JSON. Designed as the post-update sanity gate.
 *
 * Steps (in order, short-circuit on failure):
 *   1. runbook   — npm run workflow:runbook-check
 *                  (ledger integrity + Kimi auth ping + env sanity)
 *   2. policy    — npm run workflow:policy-validate
 *                  (deep-validate policy/autonomy_v1.json, 10 checks)
 *   3. triage    — npm run workflow:governance-triage -- --dry-run --owner cos
 *                  (end-to-end triage dry-run: pop candidate, policy gate,
 *                   shows would_pop_task without writing state)
 *
 * Usage:
 *   node app/stack_check_cli_v1.js
 *   npm run stack:check
 *
 * Output (ok:true, exit 0):
 *   {
 *     ok: true,
 *     checks: {
 *       runbook:      { ok:true, ... },
 *       policy:       { ok:true, version, checks:{...}, warnings:[] },
 *       triage_dry_run: { ok:true, dry_run:true, ... }
 *     },
 *     summary: { total:3, passed:3, failed:0 }
 *   }
 *
 * Output (ok:false, exit 1):
 *   {
 *     ok: false,
 *     failed_step: "runbook|policy|triage_dry_run",
 *     error: "STEP_FAILED",
 *     checks: { ... }    // all attempted steps included
 *     summary: { total:3, passed:N, failed:1 }
 *   }
 *
 * No DB writes. Deterministic JSON. Calls existing CLIs only.
 *
 * Timeout per step: 60s (runbook pings Kimi which can be slow).
 * triage dry-run timeout: 30s (does not call AI, exits before pop).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── Helper: run an npm script with optional extra args ─────────────────────────
// Returns { ok, parsed, raw_stdout, raw_stderr, exit_code, timed_out, error }
function runNpmScript(scriptName, extraArgs, timeoutMs) {
    timeoutMs = timeoutMs || 60000;

    // Build: npm run <script> [-- <extraArgs>]
    const npmArgs = ['run', scriptName];
    if (extraArgs && extraArgs.length > 0) {
        npmArgs.push('--');
        npmArgs.push(...extraArgs);
    }

    const result = spawnSync('npm', npmArgs, {
        cwd: ROOT,
        env: process.env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        shell: true,   // required on Windows for npm
    });

    if (result.error) {
        return {
            ok: false,
            parsed: null,
            raw_stdout: result.stdout || '',
            raw_stderr: result.stderr || '',
            exit_code: null,
            timed_out: result.error.code === 'ETIMEDOUT',
            error: result.error.message,
        };
    }

    const exitCode = result.status;
    const rawStdout = (result.stdout || '').trim();
    const rawStderr = (result.stderr || '').trim();

    // Extract the JSON payload — npm prepends header lines like:
    //   > openclaw-gateway@0.1.0 workflow:runbook-check
    //   > node app/...
    //   { "ok": true, ... }
    // Strategy: find the first '{', walk forward brace-counting to find matching '}'.
    // This robustly handles nested arrays without false matches on inner arrays.
    let parsed = null;
    const firstBrace = rawStdout.indexOf('{');
    if (firstBrace !== -1) {
        let depth = 0;
        let end = -1;
        for (let i = firstBrace; i < rawStdout.length; i++) {
            if (rawStdout[i] === '{') depth++;
            else if (rawStdout[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        if (end !== -1) {
            try { parsed = JSON.parse(rawStdout.slice(firstBrace, end + 1)); } catch (_) { /* fall through */ }
        }
    }

    const ok = exitCode === 0;

    return {
        ok,
        parsed,
        raw_stdout: rawStdout,
        raw_stderr: rawStderr,
        exit_code: exitCode,
        timed_out: false,
        error: ok ? null : `Exit code ${exitCode}`,
    };
}

// ── Check runner ───────────────────────────────────────────────────────────────
function runChecks() {
    const checks = {};
    let passed = 0;
    let failedAt = null;

    // ── Step 1: runbook-check ─────────────────────────────────────────────────
    const runbookRaw = runNpmScript('workflow:runbook-check', [], 90000);
    checks.runbook = runbookRaw.parsed || {
        _parse_failed: true,
        raw_stdout: runbookRaw.raw_stdout.slice(0, 500),
        raw_stderr: runbookRaw.raw_stderr.slice(0, 200),
        exit_code: runbookRaw.exit_code,
        error: runbookRaw.error,
    };

    if (!runbookRaw.ok) {
        failedAt = 'runbook';
        return { ok: false, failed_step: failedAt, error: 'STEP_FAILED', checks, passed, failed: 1 };
    }
    passed++;

    // ── Step 2: policy-validate ───────────────────────────────────────────────
    const policyRaw = runNpmScript('workflow:policy-validate', [], 15000);
    checks.policy = policyRaw.parsed || {
        _parse_failed: true,
        raw_stdout: policyRaw.raw_stdout.slice(0, 500),
        raw_stderr: policyRaw.raw_stderr.slice(0, 200),
        exit_code: policyRaw.exit_code,
        error: policyRaw.error,
    };

    if (!policyRaw.ok) {
        failedAt = 'policy';
        return { ok: false, failed_step: failedAt, error: 'STEP_FAILED', checks, passed, failed: 1 };
    }
    passed++;

    // ── Step 3: triage dry-run ────────────────────────────────────────────────
    const triageRaw = runNpmScript(
        'workflow:governance-triage',
        ['--dry-run', '--owner', 'cos'],
        30000
    );
    checks.triage_dry_run = triageRaw.parsed || {
        _parse_failed: true,
        raw_stdout: triageRaw.raw_stdout.slice(0, 500),
        raw_stderr: triageRaw.raw_stderr.slice(0, 200),
        exit_code: triageRaw.exit_code,
        error: triageRaw.error,
    };

    // Triage dry-run exits 0 in all valid operational states:
    //   ok:true  + dry_run:true  + would_pop_task  → candidate found, gate would pass
    //   ok:true  + dry_run:true  + no_work:true    → no todo tasks (healthy, not broken)
    // ok:false only signals a hard failure (missing session, DB error, etc.)
    if (!triageRaw.ok) {
        failedAt = 'triage_dry_run';
        return { ok: false, failed_step: failedAt, error: 'STEP_FAILED', checks, passed, failed: 1 };
    }
    passed++;

    return { ok: true, checks, passed, failed: 0 };
}

// ── Main ───────────────────────────────────────────────────────────────────────
const result = runChecks();
const TOTAL = 3;

const output = result.ok
    ? {
        ok: true,
        checks: result.checks,
        summary: { total: TOTAL, passed: result.passed, failed: 0 },
    }
    : {
        ok: false,
        failed_step: result.failed_step,
        error: result.error,
        checks: result.checks,
        summary: { total: TOTAL, passed: result.passed, failed: result.failed },
    };

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.exit(result.ok ? 0 : 1);
