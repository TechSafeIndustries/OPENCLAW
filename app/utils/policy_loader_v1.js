/**
 * OpenClaw — Autonomy Policy Loader v1
 * ----------------------------------------
 * Loads and validates policy/autonomy_v1.json.
 * Returns a deterministic error object on any failure — never throws.
 *
 * Usage:
 *   const { loadPolicy, policyGateCheck } = require('./utils/policy_loader_v1');
 *
 *   const policy = loadPolicy();
 *   if (!policy.ok) { handle(policy.error); }
 *
 *   const gate = policyGateCheck(policy, { intent: 'PRODUCT_OFFER', text: 'send email...' });
 *   if (gate.gated) { ... gate.reason ... }
 *
 * loadPolicy() output:
 *   Success: { ok: true, policy: <parsed object>, path: <abs path> }
 *   Failure: { ok: false, error: 'ERROR_CODE', detail: '...' }
 *
 * policyGateCheck(policy, { intent, text }) output:
 *   { gated: false }                                          — allow
 *   { gated: true, reason: '...', matched_phrase: '...' }    — block (forbidden phrase)
 *   { gated: true, reason: '...', intent: '...' }            — block (hitl intent or unknown)
 *
 * Required policy keys (validation):
 *   version, tier1_allowed_intents, tier2_founder_allowed_intents,
 *   force_hitl_intents, forbidden_phrases, stop_loss_triggers, artifact_retry_once_ms
 */

'use strict';

const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.resolve(__dirname, '..', '..', 'policy', 'autonomy_v1.json');

const REQUIRED_KEYS = [
    'version',
    'tier1_allowed_intents',
    'tier2_founder_allowed_intents',
    'force_hitl_intents',
    'forbidden_phrases',
    'stop_loss_triggers',
    'artifact_retry_once_ms',
];

// ── loadPolicy ────────────────────────────────────────────────────────────────
// Returns { ok: true, policy, path } OR { ok: false, error, detail }
function loadPolicy(overridePath) {
    const targetPath = overridePath || POLICY_PATH;

    if (!fs.existsSync(targetPath)) {
        return {
            ok: false,
            error: 'POLICY_FILE_NOT_FOUND',
            detail: `Expected policy file at: ${targetPath}`,
            path: targetPath,
        };
    }

    let raw;
    try {
        raw = fs.readFileSync(targetPath, 'utf8');
    } catch (err) {
        return {
            ok: false,
            error: 'POLICY_FILE_READ_ERROR',
            detail: err.message,
            path: targetPath,
        };
    }

    let policy;
    try {
        policy = JSON.parse(raw);
    } catch (err) {
        return {
            ok: false,
            error: 'POLICY_FILE_PARSE_ERROR',
            detail: `JSON parse failed: ${err.message}`,
            path: targetPath,
        };
    }

    // Validate required keys
    const missing = REQUIRED_KEYS.filter(k => !(k in policy));
    if (missing.length > 0) {
        return {
            ok: false,
            error: 'POLICY_MISSING_REQUIRED_KEYS',
            detail: `Missing keys: ${missing.join(', ')}`,
            path: targetPath,
            found_keys: Object.keys(policy),
        };
    }

    // Validate types for critical arrays
    const arrayKeys = ['tier1_allowed_intents', 'tier2_founder_allowed_intents', 'force_hitl_intents', 'forbidden_phrases', 'stop_loss_triggers'];
    const typeErrors = [];
    for (const k of arrayKeys) {
        if (!Array.isArray(policy[k])) {
            typeErrors.push(`${k} must be an array (got ${typeof policy[k]})`);
        }
    }
    if (typeof policy.artifact_retry_once_ms !== 'number' || policy.artifact_retry_once_ms < 0) {
        typeErrors.push('artifact_retry_once_ms must be a non-negative number');
    }
    if (typeErrors.length > 0) {
        return {
            ok: false,
            error: 'POLICY_TYPE_ERROR',
            detail: typeErrors.join('; '),
            path: targetPath,
        };
    }

    return { ok: true, policy, path: targetPath };
}

// ── policyGateCheck ───────────────────────────────────────────────────────────
// Checks a candidate task/request against the loaded policy.
// Returns { gated: false } or { gated: true, reason, matched_phrase?, intent? }
//
// Parameters:
//   policyResult   — output of loadPolicy() (must have ok:true)
//   opts.intent    — task intent string (may be null/undefined)
//   opts.text      — task text to scan for forbidden phrases (title + details, joined)
//
function policyGateCheck(policyResult, opts) {
    if (!policyResult || policyResult.ok !== true) {
        // Policy load failed → fail-safe: gate everything
        return {
            gated: true,
            reason: 'POLICY_LOAD_FAILED: cannot evaluate policy, defaulting to HITL',
            policy_error: policyResult ? policyResult.error : 'null result',
        };
    }

    const policy = policyResult.policy;
    const intent = (opts && opts.intent) ? String(opts.intent).trim().toUpperCase() : null;
    const rawText = (opts && opts.text) ? String(opts.text) : '';
    const lowerText = rawText.toLowerCase();

    // ── 1. Forbidden phrase scan (highest priority — overrides intent allow) ──
    const phrases = policy.forbidden_phrases || [];
    for (const phrase of phrases) {
        if (lowerText.includes(phrase.toLowerCase())) {
            return {
                gated: true,
                reason: `FORBIDDEN_PHRASE: task text contains "${phrase}" — auto-execution not permitted`,
                matched_phrase: phrase,
                intent: intent || '(unknown)',
            };
        }
    }

    // ── 2. Intent evaluation ──────────────────────────────────────────────────
    if (!intent) {
        return {
            gated: true,
            reason: 'UNKNOWN_INTENT: task has no classifiable intent — defaulting to HITL (policy: unknown → HITL)',
            intent: null,
        };
    }

    // Force-HITL intents
    if (policy.force_hitl_intents.includes(intent)) {
        return {
            gated: true,
            reason: `FORCE_HITL_INTENT: intent "${intent}" is in force_hitl_intents — human review required`,
            intent,
        };
    }

    // Tier 2 intents — triage does not auto-execute these (Founder Mode only)
    if (policy.tier2_founder_allowed_intents.includes(intent)) {
        return {
            gated: true,
            reason: `TIER2_INTENT: intent "${intent}" requires Founder Mode — triage cannot auto-execute, use workflow:founder-*-draft`,
            intent,
        };
    }

    // Tier 1 intents — allowed for auto-execution
    if (policy.tier1_allowed_intents.includes(intent)) {
        return { gated: false };
    }

    // Default: any intent NOT explicitly allowed → HITL
    return {
        gated: true,
        reason: `INTENT_NOT_IN_ALLOWLIST: intent "${intent}" is not in tier1_allowed_intents — defaulting to HITL`,
        intent,
    };
}

module.exports = { loadPolicy, policyGateCheck, POLICY_PATH, REQUIRED_KEYS };
