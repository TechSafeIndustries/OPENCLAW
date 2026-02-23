/**
 * OpenClaw — Deterministic Dispatcher v1
 * ----------------------------------------
 * Evaluates dispatch_state from router output and returns a structured result.
 *
 * States:
 *   BLOCKED    — gate_decision was "blocked"; do not proceed.
 *   GATED      — governance required and not overridden; await approval.
 *   DISPATCHED — clear to dispatch to primary agent.
 *
 * Usage:
 *   const { dispatch } = require('./dispatch_v1');
 *   const result = dispatch(routeOutput, structuredInput, { override_governance: false });
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { callKimi } = require('./kimi_adapter');
const { hasApprovedOverride } = require('./approve_override_v1');

const ROOT = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.join(ROOT, 'agents', 'contracts');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

// ── Contract loader ─────────────────────────────────────────────────────────
function loadContract(agentName) {
    const filePath = path.join(CONTRACTS_DIR, `${agentName}.contract.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`CONTRACT_NOT_FOUND: no contract file for agent "${agentName}" at ${filePath}`);
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        throw new Error(`CONTRACT_PARSE_ERROR: could not parse contract for "${agentName}": ${err.message}`);
    }
}

const { validateAgainstContract } = require('./contract_validate_v1');

// ── State computation ─────────────────────────────────────────────────────────
function computeDispatchState(routeOutput, options) {
    const route = routeOutput.route || {};

    if (route.gate_decision === 'blocked') {
        return {
            state: 'BLOCKED',
            reason: `Gate decision was "blocked". block_reason: ${route.block_reason || 'unspecified'}.`,
            next_step: 'revise_request',
        };
    }

    if (route.governance_required === true && options.override_governance !== true) {
        return {
            state: 'GATED',
            reason: 'Governance review required. Dispatch is held pending operator approval.',
            next_step: 'request_approval',
        };
    }

    return {
        state: 'DISPATCHED',
        reason: `Cleared for dispatch to agent "${routeOutput.route.primary_agent}".`,
        next_step: 'dispatch',
    };
}

// ── Main export ───────────────────────────────────────────────────────────────
function dispatch(routeOutput, structuredInput, options) {
    options = options || {};
    structuredInput = structuredInput || {};

    if (!routeOutput || typeof routeOutput !== 'object') {
        return {
            dispatch_version: 'v1',
            state: 'ERROR',
            agent: null,
            reason: 'routeOutput is required and must be an object.',
            next_step: 'revise_request',
            meta: {},
        };
    }

    const { state: rawState, reason: rawReason, next_step: rawNextStep } = computeDispatchState(routeOutput, options);

    // ── Override enforcement ───────────────────────────────────────────────────
    // override_governance=true is only honoured if a real approval record exists.
    // BLOCKED is never overrideable (router hard stop).
    let state = rawState;
    let reason = rawReason;
    let next_step = rawNextStep;
    let overrideDenied = false;

    if (options.override_governance === true && rawState !== 'BLOCKED') {
        const sessionIdForCheck = structuredInput.session_id || routeOutput.session_id || '';
        const intentForCheck = routeOutput.intent || routeOutput.route?.intent || '';
        const approved = hasApprovedOverride({ session_id: sessionIdForCheck, intent: intentForCheck });
        if (!approved) {
            // No approval record — force GATED regardless of override flag
            state = 'GATED';
            reason = 'override_governance=true but no approved override record found in ledger. Request approval first.';
            next_step = 'request_approval';
            overrideDenied = true;
        }
        // If approved === true: leave computed state as-is (DISPATCHED)
    }

    // ── Founder Mode auto-allow ───────────────────────────────────────────────
    // Reduces friction for draft-only SALES/MARKETING work.
    // Hard rules:
    //   - Only applies when state is GATED (governance_required from router).
    //   - Only for SALES_INTERNAL or MARKETING_INTERNAL intent.
    //   - ONLY when external_comms is the SOLE risk flag (all others must be falsy).
    //   - Deployment, architecture, security, policy, client_data, data_export are
    //     NEVER bypassed — those remain hard blocks.
    let founderModeActive = false;
    const FOUNDER_BYPASS_INTENTS = ['SALES_INTERNAL', 'MARKETING_INTERNAL'];
    const HARD_BLOCK_FLAGS = ['deployment', 'architecture_change', 'security',
        'policy', 'client_data', 'data_export'];

    if (
        options.founder_mode === true &&
        state === 'GATED' &&
        FOUNDER_BYPASS_INTENTS.includes(routeOutput.intent) &&
        routeOutput.route?.governance_required === true
    ) {
        // Check risk_flags: external_comms must be the ONLY truthy flag
        const rf = structuredInput.risk_flags || {};
        const hasExternalComms = rf.external_comms === true;
        const hasHardBlock = HARD_BLOCK_FLAGS.some(f => rf[f] === true);
        // All other risk_flags must be falsy (exclude external_comms from check)
        const otherTruthyFlags = Object.keys(rf)
            .filter(k => k !== 'external_comms' && rf[k] === true);

        if (hasExternalComms && !hasHardBlock && otherTruthyFlags.length === 0) {
            // Auto-allow: promote GATED → DISPATCHED for this draft-only run
            state = 'DISPATCHED';
            reason = `Founder Mode: auto-allowed draft-only ${routeOutput.intent} (only external_comms flag present).`;
            next_step = 'dispatch';
            founderModeActive = true;
        }
    }

    const primaryAgent = (state === 'DISPATCHED')
        ? (routeOutput.route?.primary_agent || null)
        : null;

    // Build result object first — ledger write references it
    const result = {
        dispatch_version: 'v1',
        state,
        agent: primaryAgent,
        intent: routeOutput.intent || null,
        session_id: routeOutput.session_id || null,
        reason,
        next_step,
        meta: {
            gate_decision: routeOutput.route?.gate_decision || null,
            gate_flags: routeOutput.route?.gate_flags || [],
            requires_governance_review: routeOutput.route?.governance_required || false,
            override_governance: options.override_governance || false,
            override_denied: overrideDenied,
            founder_mode: options.founder_mode === true,
            draft_only: founderModeActive,
            governance_bypassed: founderModeActive ? 'draft_only' : null,
            // Contract metadata attached when DISPATCHED; null otherwise
            contract: (() => {
                if (state !== 'DISPATCHED' || !primaryAgent) return null;
                try {
                    const c = loadContract(primaryAgent);
                    return { agent: c.agent, version: c.version, required_fields: c.required_fields };
                } catch (err) {
                    return { load_error: err.message };
                }
            })(),
            ledger_error: null,   // populated only on write failure
        },
    };

    // ── Ledger + LLM branch ──────────────────────────────────────────────────────
    const sessionId = structuredInput.session_id || routeOutput.session_id || 'boot_session';
    const now = new Date().toISOString();
    const actionId = 'dispatch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    const STATUS_MAP = { DISPATCHED: 'ok', GATED: 'gated', BLOCKED: 'blocked' };
    let actionStatus = STATUS_MAP[state] || 'unknown';
    let actionReason = `intent=${result.intent}; state=${result.state}; gate=${result.meta.gate_decision}`;

    try {
        const db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = OFF');   // session may or may not pre-exist

        const insertAction = db.prepare(`
            INSERT INTO actions
              (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
            VALUES
              (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
        `);

        if (state === 'DISPATCHED' && primaryAgent) {
            // ── Call Kimi, validate, optionally repair, write artifact ─────────
            const contract = loadContract(primaryAgent);

            // ── Hardened first-pass system prompt ──────────────────────────────
            const FORBIDDEN_TOKENS = [
                ...(contract.forbidden_outputs || [
                    'deploy', 'public_publish', 'endpoint', 'send_email',
                    'publish_post', 'webhook', 'vps', 'server',
                ]),
                // Draft-only additional guards (active for all runs; critical for founder bypass)
                ...(founderModeActive
                    ? ['sending', 'publish', 'posting', 'deploy', 'webhook', 'endpoint']
                    : []),
            ];
            // Deduplicate
            const FORBIDDEN_TOKENS_UNIQUE = [...new Set(FORBIDDEN_TOKENS)];
            const FORBIDDEN_LABEL = FORBIDDEN_TOKENS_UNIQUE.join(', ');


            const EXAMPLE_OUTPUT = JSON.stringify({
                agent: primaryAgent,
                version: contract.version || 'v1.0',
                intent: routeOutput.intent || 'PLAN_WORK',
                summary: 'Brief description of what was done and why (max 300 chars).',
                outputs: [
                    {
                        type: 'plan',
                        title: 'Example Output Title',
                        content: 'Detailed content of the output item.',
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
                        title: 'Example next action',
                        details: 'What should happen next and why.',
                        owner_agent: primaryAgent,
                    },
                ],
            }, null, 2);

            // ── Draft-Only Directive (Founder Mode) ───────────────────────────
            // Shared constant — injected into BOTH first-pass and repair prompts
            // when this is a founder-mode draft-only bypass run.
            const DRAFT_ONLY_DIRECTIVE = founderModeActive ? [
                '=== DRAFT-ONLY DIRECTIVE ===',
                '- Produce drafts only. Do NOT instruct sending, publishing, posting, deploying, or execution.',
                '- Do NOT use these words anywhere: send, sending, publish, publishing, post, posting,',
                '  deploy, deploying, webhook, endpoint, VPS, server.',
                '- Outputs must be internal drafts only (e.g., email draft text, sequence draft, or copy draft).',
                '- If the request implies outreach, you still produce the draft content only.',
                '=== END DRAFT-ONLY DIRECTIVE ===',
                '',
            ] : [];

            const systemPrompt = [
                `You are ${primaryAgent}.`,
                '',
                ...DRAFT_ONLY_DIRECTIVE,
                '=== OUTPUT RULES (MANDATORY) ===',
                '1. Output MUST be a single raw JSON object. No markdown, no code fences, no commentary.',
                '2. Required top-level keys: agent, version, intent, summary, outputs, ledger_writes.',
                '3. outputs: non-empty array; each item MUST have keys: type, title, content.',
                '4. ledger_writes: non-empty array; each item MUST have keys: table, type.',
                '5. next_actions (optional): array; each item MUST have keys: title, details, owner_agent.',
                `6. FORBIDDEN — do not include any of these tokens anywhere (case-insensitive): ${FORBIDDEN_LABEL}.`,
                '7. summary must be 1–300 characters.',
                '',
                '=== CONTRACT ===',
                JSON.stringify(contract),
                '',
                '=== EXAMPLE VALID OUTPUT ===',
                EXAMPLE_OUTPUT,
            ].join('\n');
            const userPrompt = JSON.stringify({
                user_goal: structuredInput.user_goal || null,
                intent: routeOutput.intent || null,
                route: routeOutput.route || {},
                context: structuredInput.context || {},
                constraints: structuredInput.constraints || {},
            });

            // ── First Kimi call ────────────────────────────────────────────────
            let agentOutput = null;
            let firstRaw = null;
            let firstParseErr = null;
            let firstValidation = null;

            result.meta.repair_attempted = false;
            result.meta.repair_succeeded = false;

            try {
                firstRaw = callKimi({ system: systemPrompt, user: userPrompt, agent: primaryAgent, intent: routeOutput.intent });
                agentOutput = JSON.parse(firstRaw);
            } catch (kimiErr) {
                firstParseErr = kimiErr.message;
            }

            // Validate first output (only if parse succeeded)
            if (agentOutput !== null) {
                firstValidation = validateAgainstContract(contract, agentOutput);
                if (firstValidation.ok) {
                    firstValidation = null;   // sentinel: no repair needed
                }
            }

            // ── Repair attempt (max 1) ─────────────────────────────────────────
            const needsRepair = (firstParseErr !== null) || (firstValidation !== null);

            if (needsRepair) {
                result.meta.repair_attempted = true;

                const repairErrors = firstParseErr
                    ? [{ code: 'JSON_PARSE_ERROR', path: 'root', msg: firstParseErr }]
                    : (firstValidation ? firstValidation.errors : []);

                const repairSystem = [
                    // Draft-Only Directive (prepend if founder mode active)
                    ...DRAFT_ONLY_DIRECTIVE,
                    ...(founderModeActive ? [
                        '- Your previous output violated draft-only rules or contract. Remove forbidden words and conform exactly.',
                        '',
                    ] : []),
                    'Return a single raw JSON object ONLY. No markdown, no code fences, no commentary.',
                    'Your previous output failed contract validation. Fix ALL listed errors.',
                    'IMPORTANT RULES:',
                    '  - If your previous output included any forbidden token (deploy, public, endpoint,',
                    '    send_email, publish_post, webhook, vps, server): remove it entirely.',
                    '  - ledger_writes MUST be an array of objects, each with keys "table" and "type".',
                    '    Not strings. Not null. Example: [{"table":"artifacts","type":"plan"}]',
                    '  - outputs MUST be an array of objects, each with keys: type, title, content.',
                    '  - summary must be 1-300 characters total.',
                    '  - Required top-level keys: agent, version, intent, summary, outputs, ledger_writes.',
                    'Here is the full contract to conform to:',
                    JSON.stringify(contract),
                ].join('\n');

                const repairUser = JSON.stringify({
                    instruction: 'You must return a corrected JSON object that passes all contract rules.',
                    previous_output: firstRaw || '(unparseable)',
                    validation_errors: repairErrors,
                });

                let repairedOutput = null;
                let repairParseErr = null;
                let repairValidation = null;

                try {
                    const repairRaw = callKimi({
                        system: repairSystem,
                        user: repairUser,
                        agent: primaryAgent,
                        intent: routeOutput.intent,
                        max_tokens: 1024,
                    });
                    repairedOutput = JSON.parse(repairRaw);
                } catch (repErr) {
                    repairParseErr = repErr.message;
                }

                if (repairedOutput !== null) {
                    repairValidation = validateAgainstContract(contract, repairedOutput);
                }

                if (repairedOutput !== null && repairValidation && repairValidation.ok) {
                    // Repair succeeded — promote to agentOutput
                    agentOutput = repairedOutput;
                    result.meta.repair_succeeded = true;
                } else {
                    // Repair also failed — REJECTED, no writes
                    const finalErrors = repairParseErr
                        ? [{ code: 'JSON_PARSE_ERROR', path: 'root', msg: repairParseErr }]
                        : (repairValidation ? repairValidation.errors : repairErrors);

                    result.meta.repair_errors = finalErrors;
                    result.meta.validation_errors = repairErrors;

                    actionStatus = 'failed';
                    actionReason = 'CONTRACT_VALIDATION_FAILED (repair exhausted): ' +
                        finalErrors.map(e => e.msg || e).join('; ');
                    result.state = 'REJECTED';
                    result.next_step = 'revise_request';
                    result.reason = actionReason;

                    insertAction.run({
                        id: actionId, session_id: sessionId, ts: now,
                        actor: 'cos', type: 'dispatch',
                        input_ref: null, output_ref: null,
                        status: actionStatus, reason: actionReason,
                        meta_json: JSON.stringify({
                            agent: primaryAgent, run_id: options.run_id || null,
                            repair_attempted: true, repair_succeeded: false,
                        }),
                    });
                    db.close();
                    return result;
                }
            }

            // ── Validation passed (first or repaired) — write artifact + task ─
            const firstOutput = (agentOutput.outputs || [])[0] || {};
            const artifactContent = JSON.stringify(firstOutput);
            const artifactId = 'artifact_' + Date.now();
            db.prepare(`
                INSERT INTO artifacts
                  (id, session_id, ts, type, title, content, content_sha256, classification, tags_json, meta_json)
                VALUES
                  (@id, @session_id, @ts, @type, @title, @content, @content_sha256, @classification, @tags_json, @meta_json)
            `).run({
                id: artifactId,
                session_id: sessionId,
                ts: now,
                type: firstOutput.type || 'plan',
                title: firstOutput.title || 'Untitled',
                content: artifactContent,
                content_sha256: require('crypto').createHash('sha256').update(artifactContent, 'utf8').digest('hex'),
                classification: structuredInput.classification || 'internal',
                tags_json: JSON.stringify(['stub', 'dispatch']),
                meta_json: JSON.stringify({ agent: primaryAgent, contract_version: contract.version, run_id: options.run_id || null }),
            });

            result.meta.artifact_id = artifactId;
            result.meta.contract_validated = true;

            // ── next_actions → tasks ───────────────────────────────────────────
            const nextActions = Array.isArray(agentOutput.next_actions) ? agentOutput.next_actions : [];
            if (nextActions.length > 0) {
                const first = nextActions[0];
                const taskId = 'task_' + Date.now();
                db.prepare(`
                    INSERT INTO tasks
                      (id, session_id, created_at, due_at, owner_agent,
                       status, title, details, dependencies_json, meta_json)
                    VALUES
                      (@id, @session_id, @created_at, @due_at, @owner_agent,
                       @status, @title, @details, @dependencies_json, @meta_json)
                `).run({
                    id: taskId,
                    session_id: sessionId,
                    created_at: now,
                    due_at: null,
                    owner_agent: first.owner_agent || primaryAgent,
                    status: 'todo',
                    title: first.title || 'Untitled task',
                    details: first.details || null,
                    dependencies_json: '[]',
                    meta_json: JSON.stringify({
                        run_id: options.run_id || null,
                        agent: primaryAgent,
                        source: 'stub',
                    }),
                });
                result.meta.task_id = taskId;
            }
        }

        // Action row — written for all states (status already set above for REJECTED)
        insertAction.run({
            id: actionId,
            session_id: sessionId,
            ts: now,
            actor: 'cos',
            type: 'dispatch',
            input_ref: null,
            output_ref: null,
            status: actionStatus,
            reason: actionReason,
            meta_json: JSON.stringify({ agent: result.agent, next_step: result.next_step, run_id: options.run_id || null }),
        });

        db.close();
    } catch (err) {
        // Never throw — surface the error in meta only
        result.meta.ledger_error = err.message;
    }

    return result;
}

module.exports = { dispatch };
