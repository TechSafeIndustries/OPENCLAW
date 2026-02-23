/**
 * OpenClaw — Governance Loop v1
 * ----------------------------------------
 * One-command operator loop: preflight → triage → tell you exactly what to do next.
 * Never auto-closes. Humans close tasks explicitly.
 *
 * Usage:
 *   node app/workflow_governance_loop_v1.js [--owner <agent>] [--dry-run] [--session <id>]
 *   npm run workflow:governance-loop
 *   npm run workflow:governance-loop -- --owner cos
 *   npm run workflow:governance-loop -- --dry-run
 *
 * Steps:
 *   1. workflow:runbook-check  (preflight: ledger + Kimi + env)
 *   2. workflow:governance-triage (pop oldest TODO → run AI → retrieve artifact)
 *
 * Next-action classification:
 *
 *   CASE A — no_work (queue empty / all stubs):
 *     ok: true, next_action: "no_work"
 *
 *   CASE B — task executed successfully (triage ok:true + task_id):
 *     ok: true,  next_action: "close_task"
 *     recommended_command: npm run workflow:task-close -- <task_id> ...
 *
 *   CASE C — policy gate / stop-loss / human review required:
 *     ok: false, next_action: "human_review_required"
 *     recommended_command: npm run workflow:human-review -- <task_id> ...
 *
 *   CASE D — hard failure (preflight fail, triage crash, etc.):
 *     ok: false, next_action: "check_errors"
 *
 *   CASE DRY-RUN — exits after triage dry-run, no next_action execution:
 *     ok: true, dry_run: true, next_action: "no_work" | "would_close_task"
 *
 * Output: single consolidated JSON object on stdout.
 * Exit 0 = managed outcome (including human_review_required).
 * Exit 1 = hard failure (preflight fail, spawn error, JSON parse error).
 *
 * No DB writes in this file. All writes happen inside CLIs it calls.
 * Deterministic JSON output.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// ── .env ──────────────────────────────────────────────────────────────────────
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) { /* fall through */ }

const ROOT = path.resolve(__dirname, '..');

// ── CLI paths ─────────────────────────────────────────────────────────────────
const CLI = {
    preflight: path.join(ROOT, 'app', 'workflow_runbook_check_v1.js'),
    triage: path.join(ROOT, 'app', 'workflow_governance_triage_v1.js'),
};

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const owner = flagVal('--owner') || 'cos';
const sessionArg = flagVal('--session') || null;

// ── Helper: spawnSync a node script, return { ok, parsed, raw, stderr, exit_code } ──
function runScript(label, nodeArgs, timeoutMs) {
    timeoutMs = timeoutMs || 60000;

    const result = spawnSync(process.execPath, nodeArgs, {
        cwd: ROOT,
        env: process.env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
    });

    if (result.error) {
        return {
            ok: false, label,
            error: `SPAWN_ERROR: ${result.error.message}`,
            timed_out: result.error.code === 'ETIMEDOUT',
            parsed: null, raw: null, stderr: null,
        };
    }

    const rawStdout = (result.stdout || '').trim();
    const rawStderr = (result.stderr || '').trim();

    // Brace-count extractor — find outermost JSON object
    let parsed = null;
    const firstBrace = rawStdout.indexOf('{');
    if (firstBrace !== -1) {
        let depth = 0, end = -1;
        for (let i = firstBrace; i < rawStdout.length; i++) {
            if (rawStdout[i] === '{') depth++;
            else if (rawStdout[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
            try { parsed = JSON.parse(rawStdout.slice(firstBrace, end + 1)); } catch (_) { }
        }
    }

    const ok = result.status === 0 && parsed && parsed.ok !== false;

    return {
        ok, label,
        exit_code: result.status,
        parsed,
        raw: rawStdout.slice(0, 600),
        stderr: rawStderr.slice(0, 200),
        error: (!ok && parsed) ? (parsed.error || `EXIT_${result.status}`) : null,
    };
}

// ── Helpers: fatal (exit 1) and managed (exit 0) ─────────────────────────────
function fatal(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, step, error, next_action: 'check_errors' }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(1);
}

function emit(payload) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

// ── Classify triage output → next_action ─────────────────────────────────────
// Returns { next_action, reason, task_id, artifact_id, recommended_command }
function classifyTriage(triageResult, isDryRun) {
    const p = triageResult.parsed || {};

    // ── DRY-RUN paths ─────────────────────────────────────────────────────────
    if (isDryRun) {
        const noWork = !p.would_pop_task || p.no_work ||
            (p.would_execute && p.would_execute.includes('no non-stub TODO task found'));
        if (noWork) {
            return {
                next_action: 'no_work',
                reason: 'Queue is empty or no non-stub TODO tasks found',
                task_id: null, artifact_id: null, recommended_command: null,
            };
        }

        const t = p.would_pop_task || {};
        const tid = t.id || null;
        const tMeta = t.meta || {};

        // Candidate would be gated on live run (no retry approval)
        const wouldBeGated =
            (p.would_execute && p.would_execute.toUpperCase().includes('BLOCKED')) ||
            (tMeta.stop_loss_triggered === true && tMeta.stop_loss_retry_approved !== true) ||
            (tMeta.policy_gate_triggered === true && tMeta.stop_loss_retry_approved !== true);

        if (wouldBeGated) {
            return {
                next_action: 'would_gate',
                reason: 'Dry-run: candidate task would be gated on live run (stop_loss or policy_gate) — run human-review first',
                task_id: tid,
                artifact_id: null,
                recommended_command: tid
                    ? `npm run workflow:human-review -- ${tid} --decision retry|close|reject --reason "<your reason>" --owner ${owner}`
                    : `npm run workflow:human-review -- <task_id> --decision retry|close|reject --reason "<your reason>"`,
                decisions: ['retry', 'close', 'reject'],
            };
        }

        // Clean candidate
        return {
            next_action: 'would_close_task',
            reason: 'Dry-run: candidate task found — would execute triage, then close',
            task_id: tid,
            artifact_id: null,
            recommended_command: tid
                ? `npm run workflow:task-close -- ${tid} --reason "Task completed" --owner ${owner}`
                : null,
        };
    }

    // ── LIVE paths ────────────────────────────────────────────────────────────

    // No work — check BEFORE the hard-failure branch (triage may emit ok:false with no step for empty queue)
    const noWorkSignal =
        p.no_work === true ||
        p.next_action === 'no_work' ||
        (p.task_id === null && !p.step && !p.task && !p.gated) ||
        (p.would_execute && p.would_execute.includes('no non-stub TODO task found'));

    if (noWorkSignal) {
        return {
            next_action: 'no_work',
            reason: p.notes ? (Array.isArray(p.notes) ? p.notes[0] : p.notes) : 'Queue is empty or no non-stub TODO tasks found',
            task_id: null, artifact_id: null, recommended_command: null,
        };
    }

    // Hard failure from triage (not a managed outcome) — step not set but also not no_work
    if (!triageResult.ok && !p.step) {
        return {
            next_action: 'check_errors',
            reason: triageResult.error || 'Triage returned ok:false with no step info',
            task_id: null, artifact_id: null, recommended_command: null,
        };
    }

    // Policy gate / stop-loss / human review gate
    const isHumanGate =
        p.next_action === 'human_review_required' ||
        p.step === 'policy_gate' ||
        p.step === 'stop_loss_gate' ||
        p.status === 'blocked' ||
        (p.task && p.task.status === 'blocked') ||
        p.gated ||
        (!triageResult.ok && (p.step || '').includes('gate'));

    if (isHumanGate) {
        const tid = p.task_id || (p.task && p.task.id) || null;
        const gateType = p.step === 'policy_gate' ? 'policy_gate' : 'stop_loss';
        const humanCmd = tid
            ? `npm run workflow:human-review -- ${tid} --decision retry|close|reject --reason "<your reason>" --owner ${owner}`
            : 'npm run workflow:human-review -- <task_id> --decision retry|close|reject --reason "<your reason>"';
        return {
            next_action: 'human_review_required',
            reason: p.error || p.step || 'Task gated — human review required before retry',
            gate_type: gateType,
            task_id: tid,
            artifact_id: null,
            recommended_command: humanCmd,
            decisions: ['retry', 'close', 'reject'],
        };
    }

    // No work (queue empty)
    const noWork =
        p.no_work ||
        p.next_action === 'no_work' ||
        p.task_id === null ||
        p.would_execute === 'nothing — no non-stub TODO task found';

    if (!triageResult.ok && noWork) {
        return {
            next_action: 'no_work',
            reason: 'Queue is empty or no non-stub TODO tasks found',
            task_id: null, artifact_id: null, recommended_command: null,
        };
    }

    // Successful execution — task popped + AI ran
    if (triageResult.ok && p.task_id) {
        const tid = p.task_id;
        const aid = p.artifact_id || null;
        const sid = p.session_id || sessionArg || null;

        let closeCmd = `npm run workflow:task-close -- ${tid} --reason "Task completed" --owner ${owner}`;
        if (aid) closeCmd += ` --artifact ${aid}`;
        if (sid) closeCmd += ` --session ${sid}`;

        return {
            next_action: 'close_task',
            reason: 'Task executed successfully — review artifact then close',
            task_id: tid,
            artifact_id: aid,
            session_id: sid,
            recommended_command: closeCmd,
            close_options: {
                retry: `npm run workflow:human-review -- ${tid} --decision retry --reason "<why>" --owner ${owner}`,
                reject: `npm run workflow:human-review -- ${tid} --decision reject --reason "<why>" --owner ${owner}`,
            },
        };
    }

    // ok:true but no task_id — edge case (triage ran but nothing to report)
    if (triageResult.ok && !p.task_id) {
        return {
            next_action: 'no_work',
            reason: 'Triage completed with ok:true but no task_id in output',
            task_id: null, artifact_id: null, recommended_command: null,
        };
    }

    // Fallback — surface raw triage output for operator
    return {
        next_action: 'check_errors',
        reason: triageResult.error || 'Unexpected triage output — see triage_result for details',
        task_id: p.task_id || null,
        artifact_id: null,
        recommended_command: null,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Preflight
// ─────────────────────────────────────────────────────────────────────────────
const preflightResult = runScript('preflight', [CLI.preflight], 90000);

if (!preflightResult.ok) {
    fatal('preflight', 'PREFLIGHT_FAILED', {
        preflight: preflightResult.parsed || { raw: preflightResult.raw },
        stderr: preflightResult.stderr,
        hint: 'Run npm run workflow:runbook-check to diagnose',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Governance Triage
// ─────────────────────────────────────────────────────────────────────────────
const triageArgs = [CLI.triage, '--owner', owner];
if (dryRun) triageArgs.push('--dry-run');
if (sessionArg) triageArgs.push('--session', sessionArg);

// Triage timeout: 5 min (AI calls can take time)
const triageResult = runScript('triage', triageArgs, 300000);

// Spawn-level failure (not a managed triage outcome)
if (triageResult.error && triageResult.error.startsWith('SPAWN_ERROR')) {
    fatal('triage', triageResult.error, {
        preflight: preflightResult.parsed,
        triage_raw: triageResult.raw,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Classify + emit consolidated output
// ─────────────────────────────────────────────────────────────────────────────
const classification = classifyTriage(triageResult, dryRun);
const overallOk = ['close_task', 'no_work', 'would_close_task'].includes(classification.next_action);

const output = {
    ok: overallOk,
    dry_run: dryRun || undefined,
    owner,
    preflight: preflightResult.parsed,
    triage: triageResult.parsed || { _parse_failed: true, raw: triageResult.raw },
    next_action: classification.next_action,
    ...(classification.gate_type ? { gate_type: classification.gate_type } : {}),
    ...(classification.task_id ? { task_id: classification.task_id } : {}),
    ...(classification.artifact_id ? { artifact_id: classification.artifact_id } : {}),
    ...(classification.session_id ? { session_id: classification.session_id } : {}),
    next_action_detail: {
        reason: classification.reason,
        recommended_command: classification.recommended_command,
        ...(classification.decisions ? { decisions: classification.decisions } : {}),
        ...(classification.close_options ? { close_options: classification.close_options } : {}),
    },
};

// Clean up undefined keys
Object.keys(output).forEach(k => output[k] === undefined && delete output[k]);

emit(output);

// Exit 0 for all managed outcomes (including human_review_required — it is expected, not a crash).
// Exit 1 only on hard failures (preflight fail, spawn error) — handled above via fatal().
process.exit(0);
