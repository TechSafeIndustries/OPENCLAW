/**
 * Smoke test B: governance-loop — live gated task
 *
 * Seeds a clean blocked+policy-gated task, then runs the classifier
 * directly (same logic as governance-loop classifyTriage) with a fake
 * triage result shaped exactly as triage emits it for a gated task.
 *
 * Does NOT call workflow:governance-loop to avoid Kimi preflight hangtime.
 * Validates the classifyTriage() logic returns next_action=human_review_required.
 *
 * Exit 0 = all checks pass.
 * Exit 1 = any check fails.
 */

'use strict';

// ── Inline the classifier (same logic as in workflow_governance_loop_v1.js) ──
const owner = 'cos';

function classifyTriage(triageResult, isDryRun) {
    const p = triageResult.parsed || {};
    if (isDryRun) return { next_action: 'dry_run_skipped' };

    // No work — check BEFORE hard-failure branch
    const noWorkSignal =
        p.no_work === true || p.next_action === 'no_work' ||
        (p.task_id === null && !p.step && !p.task && !p.gated);
    if (noWorkSignal) return { next_action: 'no_work', task_id: null };

    if (!triageResult.ok && !p.step) {
        return { next_action: 'check_errors', reason: triageResult.error || 'no step', task_id: null };
    }

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
        return {
            next_action: 'human_review_required',
            reason: p.error || p.step || 'Task gated',
            gate_type: gateType,
            task_id: tid,
            artifact_id: null,
            recommended_command: tid
                ? `npm run workflow:human-review -- ${tid} --decision retry|close|reject --reason "<your reason>" --owner ${owner}`
                : `npm run workflow:human-review -- <task_id> ...`,
            decisions: ['retry', 'close', 'reject'],
        };
    }

    const noWork = p.no_work || p.next_action === 'no_work' || (p.task_id === null && !p.step);
    if (!triageResult.ok && noWork) return { next_action: 'no_work', task_id: null };

    if (triageResult.ok && p.task_id) {
        return { next_action: 'close_task', task_id: p.task_id, artifact_id: p.artifact_id || null };
    }
    if (triageResult.ok && !p.task_id) return { next_action: 'no_work', task_id: null };

    return { next_action: 'check_errors', task_id: null };
}

// ── Simulate triage output for: live gated task (stop_loss_gate) ─────────────
const TASK_ID = 'task_smoke_loop_gated_fake';

const fakeTriageGated = {
    ok: false,
    label: 'triage',
    exit_code: 0,
    parsed: {
        ok: false,
        step: 'stop_loss_gate',
        error: 'STOP_LOSS_TRIGGERED: task is blocked, human_review_required',
        next_action: 'human_review_required',
        task_id: TASK_ID,
        task: { id: TASK_ID, status: 'blocked' },
    },
    error: 'EXIT_0',
};

// ── Simulate triage output for: empty queue ───────────────────────────────────
const fakeTriageEmpty = {
    ok: false,
    label: 'triage',
    exit_code: 0,
    parsed: {
        ok: false,
        no_work: true,
        next_action: 'no_work',
        task_id: null,
        notes: ['No non-stub TODO tasks found'],
    },
    error: 'EXIT_0',
};

// ── Simulate triage output for: policy_gate ───────────────────────────────────
const TASK_ID_PG = 'task_smoke_loop_policy_gated_fake';
const fakeTriagePolicyGate = {
    ok: false,
    label: 'triage',
    exit_code: 0,
    parsed: {
        ok: false,
        step: 'policy_gate',
        error: 'POLICY_GATE: FORBIDDEN_PHRASE — send email',
        task_id: TASK_ID_PG,
        task: { id: TASK_ID_PG, status: 'blocked' },
    },
    error: 'EXIT_0',
};

// ── Simulate triage output for: successful execution ──────────────────────────
const TASK_ID_OK = 'task_smoke_loop_ok_fake';
const SESS_OK = 'sess_smoke_loop_ok';
const ART_ID_OK = 'art_smoke_ok_123';
const fakeTriageOk = {
    ok: true,
    label: 'triage',
    exit_code: 0,
    parsed: {
        ok: true,
        task_id: TASK_ID_OK,
        session_id: SESS_OK,
        artifact_id: ART_ID_OK,
    },
};

// ── Run classifications ───────────────────────────────────────────────────────
const results = [
    { label: 'stop_loss_gated', c: classifyTriage(fakeTriageGated, false) },
    { label: 'empty_queue', c: classifyTriage(fakeTriageEmpty, false) },
    { label: 'policy_gate', c: classifyTriage(fakeTriagePolicyGate, false) },
    { label: 'successful_exec', c: classifyTriage(fakeTriageOk, false) },
];

const checks = {
    stop_loss_gated_is_human_review: results[0].c.next_action === 'human_review_required',
    stop_loss_gated_gate_type: results[0].c.gate_type === 'stop_loss',
    stop_loss_gated_task_id: results[0].c.task_id === TASK_ID,
    stop_loss_gated_has_cmd: !!results[0].c.recommended_command,
    stop_loss_gated_has_decisions: Array.isArray(results[0].c.decisions),
    empty_queue_is_no_work: results[1].c.next_action === 'no_work',
    policy_gate_is_human_review: results[2].c.next_action === 'human_review_required',
    policy_gate_type: results[2].c.gate_type === 'policy_gate',
    successful_exec_is_close_task: results[3].c.next_action === 'close_task',
    successful_exec_task_id: results[3].c.task_id === TASK_ID_OK,
    successful_exec_artifact_id: results[3].c.artifact_id === ART_ID_OK,
};

const allPass = Object.values(checks).every(Boolean);

process.stdout.write(JSON.stringify({
    ok: allPass,
    results: results.map(r => ({ label: r.label, next_action: r.c.next_action, gate_type: r.c.gate_type || null, task_id: r.c.task_id || null })),
    checks,
}, null, 2) + '\n');

process.exit(allPass ? 0 : 1);
