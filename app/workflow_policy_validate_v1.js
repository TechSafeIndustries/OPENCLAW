/**
 * OpenClaw — Workflow: Policy Validate v1
 * ----------------------------------------
 * Deep-validates policy/autonomy_v1.json.
 * Read-only. No DB access. No writes.
 *
 * Reuses:
 *   - app/utils/policy_loader_v1.js  (load + basic key/type checks)
 *   - app/router_v1.js               (locked intent enum — single source of truth)
 *
 * Usage:
 *   node app/workflow_policy_validate_v1.js
 *   npm run workflow:policy-validate
 *
 * Checks performed:
 *   [C1]  JSON parses cleanly
 *   [C2]  All required keys present
 *   [C3]  Array keys are non-empty arrays
 *   [C4]  All strings in arrays are non-empty strings (no blank entries)
 *   [C5]  forbidden_phrases — all entries are trimmed, lowercase (warn if not)
 *   [C6]  artifact_retry_once_ms — integer, in range [250, 5000]
 *   [C7]  Intent values in all intent arrays belong to the locked enum from router_v1.js
 *   [C8]  No intent appears in more than one intent category (overlap check)
 *   [C9]  version is a non-empty string
 *   [C10] stop_loss_triggers values belong to the known stop-loss trigger set
 *
 * Output (ok:true):
 *   { ok:true, version, policy_path, checks:{...}, warnings:[...] }
 *
 * Output (ok:false, exit 1):
 *   { ok:false, error:"POLICY_VALIDATION_FAILED", version|null, policy_path, details:{...}, warnings:[...] }
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { loadPolicy, REQUIRED_KEYS } = require('./utils/policy_loader_v1');

const ROOT = path.resolve(__dirname, '..');

// ── Locked intent enum — read from router_v1.js INTENT_RULES at runtime ───────
// NEVER duplicate the list here. Parse the source file and extract intent values.
// This ensures validate always reflects the actual locked enum.
function readLockedIntents() {
    const routerPath = path.join(ROOT, 'app', 'router_v1.js');
    let src;
    try {
        src = fs.readFileSync(routerPath, 'utf8');
    } catch (err) {
        return { ok: false, error: `Cannot read router_v1.js: ${err.message}` };
    }

    // Extract all  intent: 'XYZ'  values from INTENT_RULES and the fallback
    // Pattern covers both single and double quotes
    const matches = [...src.matchAll(/intent:\s*['"]([A-Z_]+)['"]/g)];
    if (matches.length === 0) {
        return { ok: false, error: 'Could not extract intent enum from router_v1.js (no matches)' };
    }

    const intents = [...new Set(matches.map(m => m[1]))];
    return { ok: true, intents };
}

// ── Known stop-loss trigger set (from dispatch_v1.js / classifyStopLoss) ──────
const KNOWN_STOP_LOSS_TRIGGERS = ['REJECTED', 'BLOCKED', 'GATED', 'REPAIR_FAILED'];

// ── Validation runner ─────────────────────────────────────────────────────────
function validatePolicy() {
    const checks = {};
    const warnings = [];
    const errors = {};

    // ── Phase 1: Load (C1 + C2 + basic type checks from loader) ─────────────
    const loaded = loadPolicy();

    if (!loaded.ok) {
        // Map error codes for readability
        let checkCode;
        if (loaded.error === 'POLICY_FILE_NOT_FOUND') checkCode = 'C1_JSON_PARSE';
        else if (loaded.error === 'POLICY_FILE_READ_ERROR') checkCode = 'C1_JSON_PARSE';
        else if (loaded.error === 'POLICY_FILE_PARSE_ERROR') checkCode = 'C1_JSON_PARSE';
        else if (loaded.error === 'POLICY_MISSING_REQUIRED_KEYS') checkCode = 'C2_REQUIRED_KEYS';
        else if (loaded.error === 'POLICY_TYPE_ERROR') checkCode = 'C3_ARRAY_TYPES';
        else checkCode = 'C1_JSON_PARSE';

        return {
            ok: false,
            error: 'POLICY_VALIDATION_FAILED',
            version: null,
            policy_path: loaded.path ? path.relative(ROOT, loaded.path) : 'policy/autonomy_v1.json',
            details: { [checkCode]: { pass: false, error: loaded.error, detail: loaded.detail } },
            warnings,
        };
    }

    const policy = loaded.policy;
    const relPath = path.relative(ROOT, loaded.path);

    checks.C1_JSON_PARSE = { pass: true };
    checks.C2_REQUIRED_KEYS = { pass: true, keys: REQUIRED_KEYS };
    checks.C3_ARRAY_TYPES = { pass: true };

    // ── C9: version is non-empty string ──────────────────────────────────────
    if (typeof policy.version !== 'string' || policy.version.trim() === '') {
        errors.C9_VERSION = { pass: false, error: 'version must be a non-empty string', got: policy.version };
    } else {
        checks.C9_VERSION = { pass: true, version: policy.version };
    }

    // ── C3 extended: intent arrays non-empty ─────────────────────────────────
    const INTENT_ARRAYS = ['tier1_allowed_intents', 'tier2_founder_allowed_intents', 'force_hitl_intents'];
    const emptyArrays = INTENT_ARRAYS.filter(k => policy[k].length === 0);
    if (emptyArrays.length > 0) {
        errors.C3_EMPTY_INTENT_ARRAYS = {
            pass: false,
            error: 'Intent arrays must not be empty',
            empty_keys: emptyArrays,
        };
    } else {
        checks.C3_ARRAY_TYPES.intent_arrays_non_empty = true;
    }

    // ── C4: no blank/non-string entries in any string array ──────────────────
    const STRING_ARRAYS = [
        'tier1_allowed_intents', 'tier2_founder_allowed_intents',
        'force_hitl_intents', 'forbidden_phrases', 'stop_loss_triggers',
    ];
    const blankEntries = {};
    for (const key of STRING_ARRAYS) {
        const bad = policy[key].filter(v => typeof v !== 'string' || v.trim() === '');
        if (bad.length > 0) {
            blankEntries[key] = bad;
        }
    }
    if (Object.keys(blankEntries).length > 0) {
        errors.C4_BLANK_ENTRIES = { pass: false, error: 'Arrays contain non-string or blank entries', fields: blankEntries };
    } else {
        checks.C4_NO_BLANK_ENTRIES = { pass: true };
    }

    // ── C5: forbidden_phrases — should be trimmed + lowercase ─────────────────
    const phrasesNotTrimmed = policy.forbidden_phrases.filter(
        p => typeof p === 'string' && p !== p.trim()
    );
    const phrasesNotLower = policy.forbidden_phrases.filter(
        p => typeof p === 'string' && p.trim() !== p.trim().toLowerCase()
    );
    const C5_issues = [];
    if (phrasesNotTrimmed.length > 0) C5_issues.push(`not trimmed: ${JSON.stringify(phrasesNotTrimmed)}`);
    if (phrasesNotLower.length > 0) C5_issues.push(`not lowercase: ${JSON.stringify(phrasesNotLower)}`);

    if (C5_issues.length > 0) {
        // Warn (not fail) — these still work logically but are style issues
        warnings.push({
            code: 'C5_PHRASE_CASING',
            message: 'forbidden_phrases should be trimmed and lowercase for clarity',
            details: C5_issues,
        });
        checks.C5_PHRASE_FORMAT = { pass: true, warn: true, issues: C5_issues };
    } else {
        checks.C5_PHRASE_FORMAT = { pass: true, phrases: policy.forbidden_phrases.length };
    }

    // ── C6: artifact_retry_once_ms — integer in [250, 5000] ──────────────────
    const retry = policy.artifact_retry_once_ms;
    const retryIsInt = Number.isInteger(retry);
    const retryInRange = retry >= 250 && retry <= 5000;
    if (!retryIsInt || !retryInRange) {
        errors.C6_RETRY_MS = {
            pass: false,
            error: `artifact_retry_once_ms must be an integer in [250, 5000]`,
            got: retry,
            is_integer: retryIsInt,
            in_range: retryInRange,
        };
    } else {
        checks.C6_RETRY_MS = { pass: true, value: retry };
    }

    // ── C7: intent values belong to locked enum ───────────────────────────────
    const intentEnumResult = readLockedIntents();
    if (!intentEnumResult.ok) {
        warnings.push({
            code: 'C7_ENUM_READ_FAIL',
            message: `Could not read locked intent enum from router_v1.js — skipping intent validation`,
            detail: intentEnumResult.error,
        });
        checks.C7_INTENT_ENUM = { pass: true, skipped: true, reason: intentEnumResult.error };
    } else {
        const LOCKED_ENUM = intentEnumResult.intents;
        const intentViolations = {};
        for (const key of INTENT_ARRAYS) {
            const bad = (policy[key] || []).filter(i => !LOCKED_ENUM.includes(i));
            if (bad.length > 0) intentViolations[key] = bad;
        }
        if (Object.keys(intentViolations).length > 0) {
            errors.C7_INTENT_ENUM = {
                pass: false,
                error: 'Intent values not in locked enum from router_v1.js',
                locked_enum: LOCKED_ENUM,
                violations: intentViolations,
            };
        } else {
            checks.C7_INTENT_ENUM = {
                pass: true,
                locked_enum: LOCKED_ENUM,
                all_intents_valid: true,
            };
        }
    }

    // ── C8: no intent appears in more than one category ───────────────────────
    const allIntentEntries = [];
    for (const key of INTENT_ARRAYS) {
        for (const intent of (policy[key] || [])) {
            allIntentEntries.push({ intent, key });
        }
    }
    const overlapMap = {};
    for (const { intent, key } of allIntentEntries) {
        if (!overlapMap[intent]) overlapMap[intent] = [];
        overlapMap[intent].push(key);
    }
    const overlaps = Object.entries(overlapMap)
        .filter(([, keys]) => keys.length > 1)
        .map(([intent, keys]) => ({ intent, appears_in: keys }));

    if (overlaps.length > 0) {
        errors.C8_INTENT_OVERLAP = {
            pass: false,
            error: 'Same intent appears in multiple categories',
            overlaps,
        };
    } else {
        checks.C8_NO_INTENT_OVERLAP = { pass: true };
    }

    // ── C10: stop_loss_triggers belong to known set ───────────────────────────
    const unknownTriggers = policy.stop_loss_triggers.filter(t => !KNOWN_STOP_LOSS_TRIGGERS.includes(t));
    if (unknownTriggers.length > 0) {
        warnings.push({
            code: 'C10_UNKNOWN_TRIGGERS',
            message: 'stop_loss_triggers contains values not in the known set',
            known: KNOWN_STOP_LOSS_TRIGGERS,
            unknown: unknownTriggers,
        });
        checks.C10_STOP_LOSS_TRIGGERS = { pass: true, warn: true, unknown: unknownTriggers };
    } else {
        checks.C10_STOP_LOSS_TRIGGERS = { pass: true, triggers: policy.stop_loss_triggers };
    }

    // ── Final result ──────────────────────────────────────────────────────────
    const hasErrors = Object.keys(errors).length > 0;

    if (hasErrors) {
        return {
            ok: false,
            error: 'POLICY_VALIDATION_FAILED',
            version: typeof policy.version === 'string' ? policy.version : null,
            policy_path: relPath,
            details: Object.assign({}, checks, errors),
            warnings,
        };
    }

    return {
        ok: true,
        version: policy.version,
        policy_path: relPath,
        checks,
        warnings,
    };
}

// ── Run ───────────────────────────────────────────────────────────────────────
const result = validatePolicy();
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.ok ? 0 : 1);
