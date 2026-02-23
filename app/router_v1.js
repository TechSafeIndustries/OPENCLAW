/**
 * OpenClaw — Deterministic Router v1
 * ------------------------------------
 * Implements routeRequest(input) -> structured JSON output.
 * Spec: docs/ROUTER_SPEC_V1.md (LOCKED).
 *
 * Rules:
 *  - No LLM. Pure rule evaluation.
 *  - No frameworks. Node core + better-sqlite3 only.
 *  - Structured JSON outputs only.
 *  - All ledger writes in a single transaction.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

// ── Controlled intent keyword rules (ordered, first match wins) ───────────────
// Implements Section 3 of ROUTER_SPEC_V1.md exactly.
const INTENT_RULES = [
    {
        intent: 'GOVERNANCE_REVIEW',
        primary_agent: 'governance',
        keywords: ['risk', 'block', 'approve', 'deny', 'compliance', 'policy',
            'control', 'audit', 'gate', 'review risk'],
    },
    {
        intent: 'PLAN_WORK',
        primary_agent: 'cos',
        keywords: ['plan', 'route', 'task', 'schedule', 'brief', 'assign',
            'orchestrate', 'prioritise', 'prioritize'],
    },
    {
        intent: 'SALES_INTERNAL',
        primary_agent: 'sales',
        keywords: ['sale', 'pipeline', 'qualify', 'prospect', 'script', 'deal',
            'revenue', 'close', 'outreach plan'],
    },
    {
        intent: 'MARKETING_INTERNAL',
        primary_agent: 'marketing_pr',
        keywords: ['market', 'position', 'brand', 'pr', 'content plan', 'messaging',
            'campaign', 'audience', 'publish plan'],
    },
    {
        intent: 'PRODUCT_OFFER',
        primary_agent: 'product_offer',
        keywords: ['product', 'offer', 'scope', 'price', 'package', 'roadmap',
            'feature', 'requirement', 'spec'],
    },
    {
        intent: 'OPS_INTERNAL',
        primary_agent: 'ops',
        keywords: ['sop', 'checklist', 'process', 'procedure', 'ops', 'execute',
            'run', 'deploy plan', 'workflow'],
    },
    // Rule 7: unclassified fallback — handled in code below (no keywords needed)
];

// Gate block keywords (Section 4)
const GATE_BLOCK_KEYWORDS = [
    'public api', 'saas', 'vps', 'scale out', 'redis', 'bigquery',
    'publish to', 'send email', 'send sms', 'post to',
];

// Gate flag keywords (Section 4)
const GATE_FLAG_KEYWORDS = [
    'external', 'client data', 'security', 'credential', 'key', 'token',
    'export', 'architecture change',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function nowIso() {
    return new Date().toISOString();
}

function uuid() {
    return crypto.randomUUID();
}

// ── Input validation (Section 2 of ROUTER_SPEC_V1.md) ────────────────────────
function validateInput(input) {
    const errors = [];

    if (!input || typeof input !== 'object') {
        return [{ field: 'root', msg: 'Input must be a JSON object' }];
    }

    const req = ['request_id', 'session_id', 'ts', 'initiator', 'user_goal'];
    for (const f of req) {
        if (!input[f] || typeof input[f] !== 'string' || input[f].trim() === '') {
            errors.push({ field: f, msg: `${f} is required and must be a non-empty string` });
        }
    }

    if (input.user_goal && input.user_goal.length > 2000) {
        errors.push({ field: 'user_goal', msg: 'user_goal must be ≤ 2000 characters' });
    }

    if (input.initiator && !['user', 'system'].includes(input.initiator)) {
        errors.push({ field: 'initiator', msg: 'initiator must be "user" or "system"' });
    }

    const c = input.constraints;
    if (!c || typeof c !== 'object') {
        errors.push({ field: 'constraints', msg: 'constraints must be an object' });
    } else {
        if (c.no_public_exposure !== true)
            errors.push({ field: 'constraints.no_public_exposure', msg: 'must be true' });
        if (c.structured_outputs_only !== true)
            errors.push({ field: 'constraints.structured_outputs_only', msg: 'must be true' });
        if (c.on_demand_only !== true)
            errors.push({ field: 'constraints.on_demand_only', msg: 'must be true' });
    }

    if (input.context !== undefined && (typeof input.context !== 'object' || Array.isArray(input.context))) {
        errors.push({ field: 'context', msg: 'context must be an object if provided' });
    }

    return errors;
}

// ── Deterministic intent classifier (Section 3) ───────────────────────────────
function classifyIntent(userGoal) {
    const lower = userGoal.toLowerCase();
    for (const rule of INTENT_RULES) {
        for (const kw of rule.keywords) {
            if (lower.includes(kw)) {
                return { intent: rule.intent, primary_agent_hint: rule.primary_agent, defaulted: false };
            }
        }
    }
    // Rule 7: unclassified → GOVERNANCE_REVIEW
    return { intent: 'GOVERNANCE_REVIEW', primary_agent_hint: 'governance', defaulted: true };
}

// ── Governance gate (Section 4) ───────────────────────────────────────────────
// risk_flags: optional object from caller — { architecture_change, deployment, external_comms, ... }
function evaluateGate(intent, userGoal, risk_flags) {
    const lower = userGoal.toLowerCase();
    const rf = risk_flags || {};
    const gate_flags = [];

    // ── Explicit risk_flag — blocked tier (architecture_change / deployment) ──
    // These are hard stops: router writes ledger but does NOT dispatch.
    if (rf.architecture_change || rf.deployment) {
        const reasons = [];
        if (rf.architecture_change) reasons.push('architecture_change');
        if (rf.deployment) reasons.push('deployment');
        return {
            decision: 'blocked',
            gate_flags: reasons.map(r => `risk_flag=${r}`),
            governance_required: true,
            block_reason: reasons.join('/') + ' flagged',
        };
    }

    // ── Keyword block check (Section 4 — deny path) ──────────────────────────
    for (const kw of GATE_BLOCK_KEYWORDS) {
        if (lower.includes(kw)) {
            // "internal" qualifier exempts it
            const idx = lower.indexOf(kw);
            const surrounding = lower.substring(Math.max(0, idx - 20), idx + kw.length + 20);
            if (!surrounding.includes('internal')) {
                return { decision: 'deny', gate_flags: [`blocked_keyword="${kw}"`], governance_required: false };
            }
        }
    }

    // ── Flag check (approve_with_flag tier) ──────────────────────────────────
    if (intent === 'GOVERNANCE_REVIEW') {
        gate_flags.push('intent=GOVERNANCE_REVIEW');
    }
    // risk_flag.external_comms → flag
    if (rf.external_comms) {
        gate_flags.push('risk_flag=external_comms');
    }
    for (const kw of GATE_FLAG_KEYWORDS) {
        if (lower.includes(kw)) {
            gate_flags.push(`flag_keyword="${kw}"`);
        }
    }

    const governance_required = gate_flags.length > 0;
    const decision = governance_required ? 'approve_with_flag' : 'approve';
    return { decision, gate_flags, governance_required };
}

// ── Main export ───────────────────────────────────────────────────────────────
function routeRequest(input) {
    // 1) Validate input
    const validationErrors = validateInput(input);
    if (validationErrors.length > 0) {
        return { error: { code: 'VALIDATION_FAILED', details: validationErrors } };
    }

    // 2) Open DB
    let db;
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    } catch (err) {
        return { error: { code: 'DB_OPEN_FAILED', details: [{ msg: err.message }] } };
    }

    try {
        // 3) Classify intent
        const { intent, defaulted } = classifyIntent(input.user_goal);
        const notes = defaulted ? ['unclassified_default=true'] : [];

        // 4) Governance gate — pass risk_flags from input if present
        const gate = evaluateGate(intent, input.user_goal, input.risk_flags || {});

        // ── DENY path: hard keyword block, no ledger write ────────────────────
        if (gate.decision === 'deny') {
            db.close();
            return {
                error: {
                    code: 'GOVERNANCE_GATE_DENIED',
                    gate_flags: gate.gate_flags,
                    details: [{ msg: 'Request blocked by governance gate.' }],
                },
            };
        }

        // ── BLOCKED path: risk_flag hard stop — write ledger, do NOT dispatch ─
        if (gate.decision === 'blocked') {
            const now = nowIso();
            const sessionId = input.session_id;
            const msgInId = uuid();
            const msgOutId = uuid();
            const actionId = uuid();
            const decisionId = uuid();

            // Ensure session exists
            const existingSessionB = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
            if (!existingSessionB) {
                db.prepare(`
                    INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
                    VALUES (?, ?, NULL, ?, 'on_demand', 'open', 'router session')
                `).run(sessionId, now, input.initiator);
            }

            const blockedOutput = {
                router_output_version: 'v1',
                request_id: input.request_id,
                session_id: sessionId,
                ts_routed: now,
                intent,
                route: {
                    intent,
                    primary_agent: null,
                    secondary_agents: ['governance'],
                    governance_required: true,
                    gate_decision: 'blocked',
                    block_reason: gate.block_reason,
                    constraints_applied: [],
                    ...(notes.length > 0 ? { notes } : {}),
                },
                gate_decision: 'blocked',
                gate_flags: gate.gate_flags,
                requires_governance_review: true,
                plan: {
                    steps: [{
                        step: 1,
                        action: 'governance_check',
                        agent: 'governance',
                        description: 'Request blocked — governance must review before any dispatch.',
                    }],
                },
                original_request: {
                    user_goal: input.user_goal,
                    constraints: input.constraints,
                    context: input.context || {},
                },
                ledger_writes: [],
            };

            const inputContent = JSON.stringify(input);
            const blockedContent = JSON.stringify(blockedOutput);
            const blockReason = `intent=${intent}; gate=blocked; ${gate.block_reason}`;

            const runId = input.meta?.run_id || input.run_id || null;
            const insertMsgB = db.prepare(`INSERT INTO messages (id,session_id,ts,role,agent_name,content,content_sha256,meta_json) VALUES (@id,@session_id,@ts,@role,@agent_name,@content,@content_sha256,@meta_json)`);
            const insertActB = db.prepare(`INSERT INTO actions (id,session_id,ts,actor,type,input_ref,output_ref,status,reason,meta_json) VALUES (@id,@session_id,@ts,@actor,@type,@input_ref,@output_ref,@status,@reason,@meta_json)`);
            const insertDecB = db.prepare(`INSERT INTO decisions (id,session_id,ts,decision_type,subject,options_json,selected_option,rationale,approved_by,meta_json) VALUES (@id,@session_id,@ts,@decision_type,@subject,@options_json,@selected_option,@rationale,@approved_by,@meta_json)`);

            db.transaction(() => {
                insertMsgB.run({ id: msgInId, session_id: sessionId, ts: now, role: 'user', agent_name: null, content: inputContent, content_sha256: sha256(inputContent), meta_json: JSON.stringify({ type: 'router_input', run_id: runId }) });
                insertActB.run({ id: actionId, session_id: sessionId, ts: now, actor: 'cos', type: 'route', input_ref: msgInId, output_ref: msgOutId, status: 'blocked', reason: blockReason, meta_json: JSON.stringify({ run_id: runId }) });
                insertMsgB.run({ id: msgOutId, session_id: sessionId, ts: now, role: 'system', agent_name: 'cos', content: blockedContent, content_sha256: sha256(blockedContent), meta_json: JSON.stringify({ type: 'router_output', run_id: runId }) });
                insertDecB.run({ id: decisionId, session_id: sessionId, ts: now, decision_type: 'defer', subject: 'Governance review required — blocked', options_json: JSON.stringify({ intent, block_reason: gate.block_reason, risk_flags: input.risk_flags || {} }), selected_option: null, rationale: `Auto-gate: ${gate.block_reason}`, approved_by: null, meta_json: JSON.stringify({ run_id: runId }) });
            })();

            blockedOutput.ledger_writes = [
                { table: 'messages', id: msgInId, role: 'user', type: 'router_input' },
                { table: 'actions', id: actionId, actor: 'cos', type: 'route', status: 'blocked' },
                { table: 'messages', id: msgOutId, role: 'system', type: 'router_output' },
                { table: 'decisions', id: decisionId, decision_type: 'defer', rationale: `Auto-gate: ${gate.block_reason}` },
            ];

            db.close();
            return blockedOutput;
        }

        // 5) Lookup routing rule from DB
        const ruleRow = db.prepare(
            'SELECT * FROM routing_rules WHERE intent = ?'
        ).get(intent);

        if (!ruleRow) {
            db.close();
            return { error: { code: 'ROUTING_RULE_MISSING', details: [{ msg: `No routing rule for intent: ${intent}` }] } };
        }

        const primaryAgent = ruleRow.primary_agent;
        let secondaryAgents = JSON.parse(ruleRow.secondary_agents_json || '[]');
        const dbGovRequired = ruleRow.requires_governance_review === 1;
        const constraintsApplied = JSON.parse(ruleRow.constraints_json || '[]');

        // Merge gate governance_required with DB flag
        const governance_required = gate.governance_required || dbGovRequired;

        // If governance required and governance not already secondary, add it
        if (governance_required && !secondaryAgents.includes('governance')) {
            secondaryAgents = ['governance', ...secondaryAgents.filter(a => a !== 'governance')];
        }

        const now = nowIso();

        // 6) Session handling — create if not exists
        const existingSession = db.prepare('SELECT id FROM sessions WHERE id = ?').get(input.session_id);
        if (!existingSession) {
            db.prepare(`
        INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
        VALUES (?, ?, NULL, ?, 'on_demand', 'open', 'router session')
      `).run(input.session_id, now, input.initiator);
        }

        // 7) Build output (Section 5 of ROUTER_SPEC_V1.md)
        const planSteps = [];
        if (governance_required) {
            planSteps.push({
                step: 1,
                action: 'governance_check',
                agent: 'governance',
                description: 'Route flagged — governance agent must review before dispatch.',
            });
        }
        planSteps.push({
            step: planSteps.length + 1,
            action: 'dispatch',
            agent: primaryAgent,
            description: `Dispatch to ${primaryAgent} for intent ${intent}.`,
        });

        const requestId = input.request_id;
        const sessionId = input.session_id;
        const runId = input.meta?.run_id || input.run_id || null;
        const routerOutput = {
            router_output_version: 'v1',
            request_id: requestId,
            session_id: sessionId,
            ts_routed: now,
            intent,
            route: {
                intent,
                primary_agent: primaryAgent,
                secondary_agents: secondaryAgents,
                governance_required,
                constraints_applied: constraintsApplied,
                ...(notes.length > 0 ? { notes } : {}),
            },
            gate_decision: gate.decision,
            gate_flags: gate.gate_flags,
            requires_governance_review: governance_required,
            plan: { steps: planSteps },
            original_request: {
                user_goal: input.user_goal,
                constraints: input.constraints,
                context: input.context || {},
            },
            ledger_writes: [],
        };

        // 8) Ledger writes — single transaction
        const inputContent = JSON.stringify(input);
        const outputContent = JSON.stringify(routerOutput);
        const msgInId = uuid();
        const msgOutId = uuid();
        const actionId = uuid();
        const decisionId = governance_required ? uuid() : null;

        const actionStatus = 'ok';
        const actionReason = `intent=${intent}; governance_required=${governance_required}; gate=${gate.decision}`;

        const insertMsg = db.prepare(`
      INSERT INTO messages
        (id, session_id, ts, role, agent_name, content, content_sha256, meta_json)
      VALUES
        (@id, @session_id, @ts, @role, @agent_name, @content, @content_sha256, @meta_json)
    `);

        const insertAction = db.prepare(`
      INSERT INTO actions
        (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
      VALUES
        (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref, @status, @reason, @meta_json)
    `);

        const insertDecision = db.prepare(`
      INSERT INTO decisions
        (id, session_id, ts, decision_type, subject, options_json, selected_option, rationale, approved_by, meta_json)
      VALUES
        (@id, @session_id, @ts, @decision_type, @subject, @options_json, @selected_option, @rationale, @approved_by, @meta_json)
    `);

        const ledgerTx = db.transaction(() => {
            // Message: router input
            insertMsg.run({
                id: msgInId,
                session_id: sessionId,
                ts: now,
                role: 'user',
                agent_name: null,
                content: inputContent,
                content_sha256: sha256(inputContent),
                meta_json: JSON.stringify({ type: 'router_input', run_id: runId }),
            });

            // Action: route
            insertAction.run({
                id: actionId,
                session_id: sessionId,
                ts: now,
                actor: 'cos',
                type: 'route',
                input_ref: msgInId,
                output_ref: msgOutId,
                status: actionStatus,
                reason: actionReason,
                meta_json: JSON.stringify({ run_id: runId }),
            });

            // Message: router output
            insertMsg.run({
                id: msgOutId,
                session_id: sessionId,
                ts: now,
                role: 'system',
                agent_name: 'cos',
                content: outputContent,
                content_sha256: sha256(outputContent),
                meta_json: JSON.stringify({ type: 'router_output', run_id: runId }),
            });

            // Decision: if governance required
            if (governance_required && decisionId) {
                insertDecision.run({
                    id: decisionId,
                    session_id: sessionId,
                    ts: now,
                    decision_type: 'defer',
                    subject: 'Governance review required',
                    options_json: JSON.stringify({ intent, primary_agent: primaryAgent, constraints: constraintsApplied }),
                    selected_option: null,
                    rationale: 'Auto-gate',
                    approved_by: null,
                    meta_json: JSON.stringify({ run_id: runId }),
                });
            }
        });

        ledgerTx();

        // 9) Finalise output with ledger_writes summary
        routerOutput.ledger_writes = [
            { table: 'messages', id: msgInId, role: 'user', type: 'router_input' },
            { table: 'actions', id: actionId, actor: 'cos', type: 'route' },
            { table: 'messages', id: msgOutId, role: 'system', type: 'router_output' },
            ...(governance_required && decisionId
                ? [{ table: 'decisions', id: decisionId, decision_type: 'defer' }]
                : []),
        ];

        // Re-stringify output now ledger_writes is populated (output content in DB doesn't include these, that's fine)
        db.close();
        return routerOutput;

    } catch (err) {
        try { db.close(); } catch (_) { }
        return { error: { code: 'ROUTER_ERROR', details: [{ msg: err.message }] } };
    }
}

module.exports = { routeRequest };
