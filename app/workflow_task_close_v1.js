/**
 * OpenClaw — Task Close Workflow v1
 * ------------------------------------
 * Thin orchestration wrapper around tasks_close_cli_v1.js.
 *
 * Adds:
 *   1. tasks:get pre-flight (confirm task exists + is doing)
 *   2. --dry-run (show what WOULD change, no DB writes)
 *   3. Consolidated output shape matching other workflow scripts
 *
 * Does NOT write to DB directly. All writes go through tasks_close_cli_v1.js.
 *
 * Usage:
 *   node app/workflow_task_close_v1.js <task_id>
 *     --reason "<text>"           required, max 240 chars
 *     [--owner   <agent>]         default: cos
 *     [--artifact <artifact_id>]  optional: link closure to artefact
 *     [--session  <session_id>]   optional: override session inference
 *     [--dry-run]                 show what would change; no DB writes
 *
 * Exit 0  = ok:true (dry-run or real close succeeded)
 * Exit 1  = hard failure (task not found, status guard, validation error)
 *
 * Deps: Node core. dotenv (already in project).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) { /* fall through */ }

const ROOT = path.resolve(__dirname, '..');

// ── CLI paths ─────────────────────────────────────────────────────────────────
const CLI = {
    tasksGet: path.join(ROOT, 'app', 'tasks_get_cli_v1.js'),
    tasksClose: path.join(ROOT, 'app', 'tasks_close_cli_v1.js'),
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

const reason = flagVal('--reason');
const owner = flagVal('--owner') || 'cos';
const artifactId = flagVal('--artifact') || null;
const sessionArg = flagVal('--session') || null;

// ── Validate argv ─────────────────────────────────────────────────────────────
if (!taskId) {
    process.stdout.write(JSON.stringify({
        ok: false, error: 'MISSING_TASK_ID',
        usage: 'npm run workflow:task-close -- <task_id> --reason "<text>" [--owner <agent>] [--artifact <id>] [--session <id>] [--dry-run]',
    }, null, 2) + '\n');
    process.exit(1);
}

if (!reason || reason.trim().length === 0) {
    process.stdout.write(JSON.stringify({
        ok: false, task_id: taskId, error: 'MISSING_REASON: --reason is required and must be non-empty',
    }, null, 2) + '\n');
    process.exit(1);
}

if (reason.length > 240) {
    process.stdout.write(JSON.stringify({
        ok: false, task_id: taskId,
        error: `REASON_TOO_LONG: --reason must be ≤ 240 chars (got ${reason.length})`,
    }, null, 2) + '\n');
    process.exit(1);
}

// ── Helper: spawnSync a node script ──────────────────────────────────────────
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
        return { ok: false, label, error: `SPAWN_ERROR: ${result.error.message}`, parsed: null, stderr: null };
    }

    const rawStdout = (result.stdout || '').trim();
    const rawStderr = (result.stderr || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawStdout); } catch (_) {
        return { ok: false, label, error: 'JSON_PARSE_ERROR: stdout not valid JSON', raw: rawStdout.slice(0, 400), parsed: null, stderr: rawStderr.slice(0, 200) };
    }

    // Some CLIs write ok:false on stdout AND exit 0 (e.g. tasks:get NOT_FOUND).
    // Treat any non-zero exit OR ok:false in parsed JSON as a failure.
    if (result.status !== 0 || parsed.ok === false) {
        return { ok: false, label, error: parsed.error || `EXIT_CODE_${result.status}`, parsed, stderr: rawStderr.slice(0, 200) };
    }

    return { ok: true, label, parsed, stderr: rawStderr };
}

// ── Helper: fatal exit ────────────────────────────────────────────────────────
function fatal(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, task_id: taskId, step, error }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Fetch task (pre-flight read — no DB write)
// ─────────────────────────────────────────────────────────────────────────────
const getResult = runScript('tasks_get', [CLI.tasksGet, taskId]);
if (!getResult.ok) {
    fatal('tasks_get', getResult.error || 'tasks:get failed', {
        detail: getResult.parsed,
        stderr: getResult.stderr,
    });
}

const task = getResult.parsed.task;

// Guard: must be 'doing'
if (task.status !== 'doing') {
    process.stdout.write(JSON.stringify({
        ok: false,
        task_id: taskId,
        step: 'status_guard',
        error: `STATUS_GUARD_FAILED: task must be "doing" to close (current: "${task.status}")`,
        session_id: task.session_id,
        before: { status: task.status, owner_agent: task.owner_agent },
        hint: task.status === 'todo'
            ? 'Run "npm run workflow:governance-triage" to pop this task to doing first'
            : task.status === 'done'
                ? 'Task is already closed (status: done)'
                : 'Task is blocked — resolve block before closing',
    }, null, 2) + '\n');
    process.exit(1);
}

// Resolve session — prefer explicit arg, else infer from task record
const resolvedSessionId = sessionArg || task.session_id || 'openclaw_ops';

// ─────────────────────────────────────────────────────────────────────────────
// DRY-RUN: show what WOULD change, do not call tasks_close
// ─────────────────────────────────────────────────────────────────────────────
if (dryRun) {
    const trimmedReason = reason.trim();
    process.stdout.write(JSON.stringify({
        ok: true,
        dry_run: true,
        task_id: taskId,
        session_id: resolvedSessionId,
        owner,
        artifact_id: artifactId,
        before: {
            status: task.status,
            owner_agent: task.owner_agent,
            meta: task.meta,
        },
        would_write: {
            status: 'done',
            owner_agent: owner,
            meta_close_reason: trimmedReason,
            meta_closed_by: owner,
            meta_closed_at: '<now ISO>',
            meta_closed_artifact_id: artifactId,
            meta_closed_session_id: resolvedSessionId,
        },
        would_insert_action: {
            type: 'task_close',
            status: 'ok',
            actor: 'ops',
            reason: `task_id=${taskId}; owner=${owner}; reason="${trimmedReason.slice(0, 80)}"`,
        },
        after: null,
        action_id: null,
        notes: [
            'Dry-run: no DB writes performed',
            'Re-run without --dry-run to execute',
        ],
    }, null, 2) + '\n');
    process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Close the task (tasks_close_cli does guard + update + action atomically)
// ─────────────────────────────────────────────────────────────────────────────
const closeArgs = [
    CLI.tasksClose,
    taskId,
    '--reason', reason.trim(),
    '--owner', owner,
];
if (artifactId) { closeArgs.push('--artifact', artifactId); }
if (sessionArg) { closeArgs.push('--session', sessionArg); }

const closeResult = runScript('tasks_close', closeArgs, 15000);

if (!closeResult.ok) {
    fatal('tasks_close', closeResult.error || 'tasks:close failed', {
        detail: closeResult.parsed,
        stderr: closeResult.stderr,
    });
}

const closed = closeResult.parsed;

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLIDATED OUTPUT
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    task_id: taskId,
    session_id: closed.session_id || resolvedSessionId,
    owner: closed.owner || owner,
    artifact_id: closed.artifact_id || artifactId,
    before: closed.before,
    after: closed.after,
    action_id: closed.action_id,
    notes: closed.notes || [],
}, null, 2) + '\n');

process.exit(0);
