/**
 * OpenClaw — Human Review Workflow v1
 * --------------------------------------
 * Governance override point: review a stop-lossed task → decide → retry|close|reject.
 * This is the ONLY authorised path to re-queue or close a blocked task.
 *
 * Usage:
 *   node app/workflow_human_review_v1.js <task_id>
 *     --decision  retry|close|reject        (required)
 *     --reason    "<text>"                  (required, max 240 chars)
 *     [--owner    <agent>]                  (default: cos)
 *     [--artifact <artifact_id>]            (link to artifact; used by close)
 *     [--session  <session_id>]             (override session; else inferred)
 *     [--dry-run]                           (steps 1-4 only, no DB writes)
 *
 * Flow:
 *   0. Preflight      — workflow:runbook-check (hard fail if fails)
 *   1. Load task      — tasks:get <task_id>
 *   2. Validate       — status=blocked AND meta.stop_loss_triggered=true
 *   3. Review summary — task fields, stop-loss meta, latest artifact (non-stub)
 *   4. [dry-run exits here]
 *   5. Apply decision:
 *      A) retry:
 *         - Guard: ALREADY_APPROVED_FOR_RETRY if meta.stop_loss_retry_approved=true
 *         - Write approve:override record (session + HUMAN_REVIEW_RETRY intent)
 *         - Call tasks:review-update --decision retry (status → todo, add retry meta)
 *         - Output ok:true + next_action "run triage again"
 *      B) close:
 *         - Write tasks:review-update --decision close (status → done, add close meta)
 *         - Output ok:true + next_action "no further automation"
 *      C) reject:
 *         - Guard: ALREADY_REJECTED if meta.review_rejected=true
 *         - Write tasks:review-update --decision reject (keeps blocked, adds reject meta)
 *         - Output ok:true + next_action "no further automation"
 *
 * Constraints:
 *   - Human review must be explicit. No automatic retries.
 *   - No direct DB writes in workflow layer (all writes via CLI tools).
 *   - Deterministic JSON output only. Exit 0 = managed outcome, Exit 1 = hard failure.
 *   - Internal/on-demand only. No SaaS, no public endpoints.
 *
 * Audit trail:
 *   retry:  decisions/actions rows from approve:override + action human_review_retry
 *   close:  action human_review_close
 *   reject: action human_review_reject
 *
 * Deps: Node core, dotenv (already in project).
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
    tasksGet: path.join(ROOT, 'app', 'tasks_get_cli_v1.js'),
    artifactsLatest: path.join(ROOT, 'app', 'artifacts_latest_cli_v1.js'),
    approveOverride: path.join(ROOT, 'app', 'approve_override_cli_v1.js'),
    reviewUpdate: path.join(ROOT, 'app', 'tasks_review_update_cli_v1.js'),
};

// ── Parse argv ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const taskId = args.find(a => !a.startsWith('-'));

function flagVal(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const next = args[idx + 1];
    return (next && !next.startsWith('-')) ? next : null;
}

const decision = flagVal('--decision');
const reason = flagVal('--reason');
const owner = flagVal('--owner') || 'cos';
const artifactId = flagVal('--artifact') || null;
const sessionArg = flagVal('--session') || null;

const VALID_DECISIONS = new Set(['retry', 'close', 'reject']);

// ── Validate argv before doing anything ───────────────────────────────────────
const argErrors = [];
if (!taskId) argErrors.push('Missing required argument: <task_id>');
if (!decision || !VALID_DECISIONS.has(decision)) argErrors.push(`--decision must be retry|close|reject (got "${decision}")`);
if (!reason || reason.trim().length === 0) argErrors.push('--reason is required and must be non-empty');
if (reason && reason.length > 240) argErrors.push(`--reason must be ≤ 240 chars (got ${reason.length})`);
if (owner.length > 40) argErrors.push(`--owner must be ≤ 40 chars (got ${owner.length})`);

if (argErrors.length > 0) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: 'ARG_VALIDATION_FAILED',
        details: argErrors,
        usage: 'npm run workflow:human-review -- <task_id> --decision retry|close|reject --reason "<text>" [--owner cos] [--artifact <id>] [--session <id>] [--dry-run]',
    }, null, 2) + '\n');
    process.exit(1);
}

const trimmedReason = reason.trim();

// ── Helper: spawnSync a node script ───────────────────────────────────────────
function runScript(label, nodeArgs, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    const result = spawnSync(process.execPath, nodeArgs, {
        cwd: ROOT,
        env: process.env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
    });

    if (result.error) {
        return { ok: false, label, error: `SPAWN_ERROR: ${result.error.message}`, parsed: null, raw: null, stderr: null };
    }

    const rawStdout = (result.stdout || '').trim();
    const rawStderr = (result.stderr || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawStdout); } catch (_) {
        return { ok: false, label, error: 'JSON_PARSE_ERROR: stdout not valid JSON', raw: rawStdout.slice(0, 400), parsed: null, stderr: rawStderr.slice(0, 200) };
    }

    if (result.status !== 0 || parsed.ok === false) {
        return { ok: false, label, error: parsed.error || `EXIT_CODE_${result.status}`, parsed, stderr: rawStderr.slice(0, 200) };
    }

    return { ok: true, label, parsed, stderr: rawStderr };
}

// ── Helper: fatal exit (hard failure — exit 1) ────────────────────────────────
function fatal(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, task_id: taskId, step, error }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(1);
}

// ── Helper: managed outcome exit (exit 0, ok:false) ─────────────────────────
function outcome(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, task_id: taskId, step, error }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 0: Preflight
// ─────────────────────────────────────────────────────────────────────────────
const preflight = runScript('preflight', [CLI.preflight], 60000);
if (!preflight.ok || !preflight.parsed || preflight.parsed.ok !== true) {
    fatal('preflight', 'PREFLIGHT_FAILED: workflow:runbook-check did not return ok:true', {
        detail: preflight.parsed || preflight.raw,
        stderr: preflight.stderr,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Load task
// ─────────────────────────────────────────────────────────────────────────────
const getResult = runScript('tasks_get', [CLI.tasksGet, taskId]);
if (!getResult.ok) {
    fatal('tasks_get', getResult.error || 'tasks:get failed', {
        detail: getResult.parsed,
        stderr: getResult.stderr,
    });
}

const task = getResult.parsed.task;
const taskMeta = task.meta || {};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Validate — must be blocked + stop_loss_triggered=true
// ─────────────────────────────────────────────────────────────────────────────
if (task.status !== 'blocked' || taskMeta.stop_loss_triggered !== true) {
    outcome('validate', 'NOT_STOP_LOSS_BLOCKED: task must have status=blocked AND meta.stop_loss_triggered=true', {
        task_status: task.status,
        stop_loss_triggered: taskMeta.stop_loss_triggered || false,
        hint: task.status !== 'blocked'
            ? `Task status is "${task.status}" — only stop-lossed (blocked) tasks can be reviewed here`
            : 'Task is blocked but stop_loss_triggered is not true — may be blocked for a different reason',
    });
}

// Resolve session
const resolvedSessionId = sessionArg || task.session_id || 'openclaw_ops';

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Review summary — task fields + stop-loss meta + latest artifact
// ─────────────────────────────────────────────────────────────────────────────
const stopLossSummary = {
    triggered: taskMeta.stop_loss_triggered,
    reason: taskMeta.stop_loss_reason,
    step: taskMeta.stop_loss_step,
    at: taskMeta.stop_loss_at,
    failure_type: taskMeta.stop_loss_failure_type,
    run_id: taskMeta.stop_loss_run_id,
    owner: taskMeta.stop_loss_owner,
    // Retry state (if any prior retry attempt was made)
    retry_approved: taskMeta.stop_loss_retry_approved || false,
    retry_by: taskMeta.stop_loss_retry_by || null,
    retry_at: taskMeta.stop_loss_retry_at || null,
    // Reject state
    review_rejected: taskMeta.review_rejected || false,
    rejected_at: taskMeta.review_rejected_at || null,
};

// Fetch latest non-stub artifact for session (1 retry allowed, non-fatal if missing)
let latestArtifact = null;
let artifactFetchNote = null;
const artifactResult = runScript('artifacts_latest', [CLI.artifactsLatest, resolvedSessionId, '--no-stub']);
if (artifactResult.ok && artifactResult.parsed && artifactResult.parsed.artifact) {
    latestArtifact = artifactResult.parsed.artifact;
} else if (!artifactResult.ok) {
    artifactFetchNote = `artifact fetch skipped: ${artifactResult.error}`;
}

const reviewSummary = {
    task: {
        id: task.id,
        session_id: task.session_id,
        created_at: task.created_at,
        status: task.status,
        owner_agent: task.owner_agent,
        title: task.title,
        details: task.details,
    },
    stop_loss: stopLossSummary,
    latest_artifact: latestArtifact,
    artifact_note: artifactFetchNote,
    proposed_decision: {
        decision: decision,
        reason: trimmedReason,
        owner: owner,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// DRY-RUN: exit after summary
// ─────────────────────────────────────────────────────────────────────────────
if (dryRun) {
    let wouldDo = [];
    if (decision === 'retry') {
        wouldDo = [
            `1. Write approve:override record (session=${resolvedSessionId}, intent=HUMAN_REVIEW_RETRY, approved_by=${owner})`,
            `2. tasks:review-update ${taskId} --decision retry --reason "${trimmedReason}" --owner ${owner}`,
            '   → task status: blocked → todo',
            '   → meta: stop_loss_retry_approved=true, stop_loss_retry_by, stop_loss_retry_at, stop_loss_retry_reason',
            '   → action type: human_review_retry',
            `3. Output ok:true, next_action="run triage again" with --session ${resolvedSessionId}`,
        ];
    } else if (decision === 'close') {
        wouldDo = [
            `1. tasks:review-update ${taskId} --decision close --reason "${trimmedReason}" --owner ${owner}`,
            '   → task status: blocked → done',
            '   → meta: close_reason, closed_by, closed_at, review_closed=true',
            '   → action type: human_review_close',
            '2. Output ok:true, next_action="no further automation"',
        ];
    } else {
        wouldDo = [
            `1. tasks:review-update ${taskId} --decision reject --reason "${trimmedReason}" --owner ${owner}`,
            '   → task status: blocked (unchanged)',
            '   → meta: review_rejected=true, review_rejected_reason, review_rejected_by, review_rejected_at',
            '   → action type: human_review_reject',
            '2. Output ok:true, next_action="no further automation"',
        ];
    }

    process.stdout.write(JSON.stringify({
        ok: true,
        dry_run: true,
        task_id: taskId,
        review: reviewSummary,
        would_do: wouldDo,
        notes: [
            'Dry-run exits after step 3 — no DB writes performed',
            'Re-run without --dry-run to apply the decision',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Apply decision
// ─────────────────────────────────────────────────────────────────────────────

// ── A) retry ─────────────────────────────────────────────────────────────────
if (decision === 'retry') {
    // Guard: ALREADY_APPROVED_FOR_RETRY
    if (taskMeta.stop_loss_retry_approved === true) {
        outcome('validate', 'ALREADY_APPROVED_FOR_RETRY: stop_loss_retry_approved=true already on this task', {
            review: reviewSummary,
            stop_loss_retry_at: taskMeta.stop_loss_retry_at,
            stop_loss_retry_by: taskMeta.stop_loss_retry_by,
            stop_loss_retry_reason: taskMeta.stop_loss_retry_reason,
        });
    }

    // 5A-1: Write approve:override record
    // Signature: <session_id> <intent> <approved_by> <rationale...>
    const overrideIntent = 'HUMAN_REVIEW_RETRY';
    const overrideRationale = `human_review retry approved by ${owner}: ${trimmedReason}`;

    const overrideResult = runScript('approve_override', [
        CLI.approveOverride,
        resolvedSessionId,
        overrideIntent,
        owner,
        overrideRationale,
    ], 15000);

    if (!overrideResult.ok) {
        fatal('approve_override', overrideResult.error || 'approve:override failed', {
            detail: overrideResult.parsed,
            stderr: overrideResult.stderr,
        });
    }

    // 5A-2: Apply retry via tasks:review-update
    const retryArgs = [
        CLI.reviewUpdate,
        taskId,
        '--decision', 'retry',
        '--reason', trimmedReason,
        '--owner', owner,
        '--session', resolvedSessionId,
    ];
    if (artifactId) retryArgs.push('--artifact', artifactId);

    const retryResult = runScript('tasks_review_update_retry', retryArgs, 15000);

    if (!retryResult.ok) {
        fatal('tasks_review_update', retryResult.error || 'tasks:review-update failed', {
            detail: retryResult.parsed,
            stderr: retryResult.stderr,
        });
    }

    process.stdout.write(JSON.stringify({
        ok: true,
        task_id: taskId,
        session_id: resolvedSessionId,
        decision: 'retry',
        owner,
        review: reviewSummary,
        override: {
            decision_id: overrideResult.parsed.decision_id,
            intent: overrideIntent,
            approved_by: owner,
        },
        apply: retryResult.parsed,
        next_action: 'run triage again',
        next_command: `npm run workflow:governance-triage -- --session ${resolvedSessionId}`,
        notes: [
            'approve:override record written — intent=HUMAN_REVIEW_RETRY, session logged in decisions+actions tables',
            'task status: blocked → todo',
            'stop_loss_triggered preserved (original stop-loss fields intact)',
            'stop_loss_retry_approved=true added to meta — triage threshold gate will check this to allow re-execution',
            `Run: npm run workflow:governance-triage -- --session ${resolvedSessionId}`,
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ── B) close ──────────────────────────────────────────────────────────────────
if (decision === 'close') {
    // Apply close via tasks:review-update (handles blocked→done directly)
    // Note: workflow:task-close guards for status=doing — cannot use it here.
    const closeArgs = [
        CLI.reviewUpdate,
        taskId,
        '--decision', 'close',
        '--reason', trimmedReason,
        '--owner', owner,
        '--session', resolvedSessionId,
    ];
    if (artifactId) closeArgs.push('--artifact', artifactId);

    const closeResult = runScript('tasks_review_update_close', closeArgs, 15000);

    if (!closeResult.ok) {
        fatal('tasks_review_update', closeResult.error || 'tasks:review-update close failed', {
            detail: closeResult.parsed,
            stderr: closeResult.stderr,
        });
    }

    process.stdout.write(JSON.stringify({
        ok: true,
        task_id: taskId,
        session_id: resolvedSessionId,
        decision: 'close',
        owner,
        review: reviewSummary,
        apply: closeResult.parsed,
        next_action: 'no further automation',
        notes: [
            'task transitioned: blocked → done',
            'action type: human_review_close (distinct from task_close)',
            'workflow:task-close bypassed — it guards for status=doing; human-review close handles blocked→done directly',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ── C) reject ─────────────────────────────────────────────────────────────────
if (decision === 'reject') {
    // Guard: ALREADY_REJECTED
    if (taskMeta.review_rejected === true) {
        outcome('validate', 'ALREADY_REJECTED: review_rejected=true already on this task', {
            review: reviewSummary,
            review_rejected_at: taskMeta.review_rejected_at,
            review_rejected_by: taskMeta.review_rejected_by,
            review_rejected_reason: taskMeta.review_rejected_reason,
        });
    }

    const rejectArgs = [
        CLI.reviewUpdate,
        taskId,
        '--decision', 'reject',
        '--reason', trimmedReason,
        '--owner', owner,
        '--session', resolvedSessionId,
    ];
    if (artifactId) rejectArgs.push('--artifact', artifactId);

    const rejectResult = runScript('tasks_review_update_reject', rejectArgs, 15000);

    if (!rejectResult.ok) {
        fatal('tasks_review_update', rejectResult.error || 'tasks:review-update reject failed', {
            detail: rejectResult.parsed,
            stderr: rejectResult.stderr,
        });
    }

    process.stdout.write(JSON.stringify({
        ok: true,
        task_id: taskId,
        session_id: resolvedSessionId,
        decision: 'reject',
        owner,
        review: reviewSummary,
        apply: rejectResult.parsed,
        next_action: 'no further automation',
        notes: [
            'task status unchanged (blocked) — schema has no rejected status',
            'review_rejected=true added to meta_json',
            'action type: human_review_reject',
            'Task is permanently closed from automated retry — requires manual DB intervention to re-open',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}
