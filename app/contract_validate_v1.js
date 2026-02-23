/**
 * OpenClaw — Contract Validator v1
 * ----------------------------------
 * Strict output validation against a loaded agent contract.
 *
 * Usage:
 *   const { validateAgainstContract } = require('./contract_validate_v1');
 *   const result = validateAgainstContract(contract, output);
 *   // result: { ok: true } | { ok: false, errors: [{ code, path, msg }] }
 *
 * Rules (in order):
 *   A) required_fields — all must be present as top-level keys
 *   B) forbidden_outputs — token scan over JSON.stringify(output).toLowerCase()
 *   C) field types + length limits (hard rules on known fields)
 *   D) outputs[] item shape
 *   E) next_actions[] item shape
 *   F) ledger_writes[] item shape
 *
 * Deps: Node core only.
 */

'use strict';

// ── Valid intents ─────────────────────────────────────────────────────────────
const VALID_INTENTS = new Set([
    'GOVERNANCE_REVIEW',
    'PLAN_WORK',
    'SALES_INTERNAL',
    'MARKETING_INTERNAL',
    'PRODUCT_OFFER',
    'OPS_INTERNAL',
]);

const VALID_LEDGER_TABLES = new Set([
    'sessions', 'messages', 'actions', 'decisions',
    'tasks', 'artifacts', 'agents', 'routing_rules',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function err(code, path, msg) {
    return { code, path, msg };
}

function isStr(v) { return typeof v === 'string'; }
function isArr(v) { return Array.isArray(v); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function strLen(v, min, max, path, code, errors) {
    if (!isStr(v)) {
        errors.push(err(code, path, `expected string, got ${typeof v}`));
        return false;
    }
    if (v.length < min || v.length > max) {
        errors.push(err(code, path, `string length ${v.length} out of range [${min}..${max}]`));
        return false;
    }
    return true;
}
function arrLen(v, max, path, code, errors) {
    if (!isArr(v)) {
        errors.push(err(code, path, `expected array, got ${typeof v}`));
        return false;
    }
    if (v.length > max) {
        errors.push(err(code, path, `array length ${v.length} exceeds max ${max}`));
        return false;
    }
    return true;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * @param {object} contract - Loaded contract JSON
 * @param {object} output   - Parsed agent output
 * @returns {{ ok: true } | { ok: false, errors: Array<{code,path,msg}> }}
 */
function validateAgainstContract(contract, output) {
    const errors = [];

    // ── A) required_fields ────────────────────────────────────────────────────
    const required = contract.required_fields || [];
    for (const field of required) {
        if (!(field in output)) {
            errors.push(err('MISSING_REQUIRED_FIELD', field, `required field "${field}" is absent`));
        }
    }

    // ── B) forbidden_outputs token scan ───────────────────────────────────────
    const forbidden = contract.forbidden_outputs || [];
    let outputStr;
    try {
        outputStr = JSON.stringify(output).toLowerCase();
    } catch (_) {
        outputStr = '';
    }
    for (const token of forbidden) {
        if (outputStr.includes(token.toLowerCase())) {
            errors.push(err('FORBIDDEN_OUTPUT_TOKEN', 'output', `forbidden token found: "${token}"`));
        }
    }

    // ── C) known field types + limits ─────────────────────────────────────────
    // output.agent — string, must equal contract.agent
    if ('agent' in output) {
        if (!isStr(output.agent)) {
            errors.push(err('INVALID_TYPE', 'agent', 'must be a string'));
        } else if (contract.agent && output.agent !== contract.agent) {
            errors.push(err('AGENT_MISMATCH', 'agent', `expected "${contract.agent}", got "${output.agent}"`));
        }
    }

    // output.version — string, must equal contract.version
    if ('version' in output) {
        if (!isStr(output.version)) {
            errors.push(err('INVALID_TYPE', 'version', 'must be a string'));
        } else if (contract.version && output.version !== contract.version) {
            errors.push(err('VERSION_MISMATCH', 'version', `expected "${contract.version}", got "${output.version}"`));
        }
    }

    // output.intent — string, from VALID_INTENTS
    if ('intent' in output) {
        if (!isStr(output.intent)) {
            errors.push(err('INVALID_TYPE', 'intent', 'must be a string'));
        } else if (!VALID_INTENTS.has(output.intent)) {
            errors.push(err('INVALID_INTENT', 'intent',
                `"${output.intent}" is not a recognised intent. Valid: ${[...VALID_INTENTS].join(', ')}`));
        }
    }

    // output.summary — string 1..300
    if ('summary' in output) {
        strLen(output.summary, 1, 300, 'summary', 'SUMMARY_LENGTH', errors);
    }

    // output.outputs — array 0..10
    if ('outputs' in output) {
        arrLen(output.outputs, 10, 'outputs', 'OUTPUTS_ARRAY', errors);
    }

    // output.ledger_writes — array 0..20
    if ('ledger_writes' in output) {
        arrLen(output.ledger_writes, 20, 'ledger_writes', 'LEDGER_WRITES_ARRAY', errors);
    }

    // Optional arrays — length guard only
    for (const optKey of ['next_actions', 'risks', 'assumptions', 'requests_to_user']) {
        if (optKey in output && output[optKey] !== undefined && output[optKey] !== null) {
            arrLen(output[optKey], 20, optKey, `${optKey.toUpperCase()}_ARRAY`, errors);
        }
    }

    // ── D) outputs[] item shape ───────────────────────────────────────────────
    if (isArr(output.outputs)) {
        output.outputs.forEach((item, i) => {
            const base = `outputs[${i}]`;
            if (!isObj(item)) {
                errors.push(err('OUTPUTS_ITEM_NOT_OBJECT', base, 'each outputs item must be an object'));
                return;
            }
            // type: string 1..40
            if (!('type' in item)) {
                errors.push(err('OUTPUTS_ITEM_MISSING_FIELD', `${base}.type`, 'field "type" is required'));
            } else {
                strLen(item.type, 1, 40, `${base}.type`, 'OUTPUTS_ITEM_TYPE_LENGTH', errors);
            }
            // title: string 1..120
            if (!('title' in item)) {
                errors.push(err('OUTPUTS_ITEM_MISSING_FIELD', `${base}.title`, 'field "title" is required'));
            } else {
                strLen(item.title, 1, 120, `${base}.title`, 'OUTPUTS_ITEM_TITLE_LENGTH', errors);
            }
            // content: string OR object (object → JSON.stringify <= 4000)
            if (!('content' in item)) {
                errors.push(err('OUTPUTS_ITEM_MISSING_FIELD', `${base}.content`, 'field "content" is required'));
            } else if (isStr(item.content)) {
                // string content — no length limit specified, accept as-is
            } else if (isObj(item.content)) {
                const contentStr = JSON.stringify(item.content);
                if (contentStr.length > 4000) {
                    errors.push(err('OUTPUTS_ITEM_CONTENT_TOO_LARGE', `${base}.content`,
                        `object content JSON length ${contentStr.length} exceeds 4000`));
                }
            } else {
                errors.push(err('OUTPUTS_ITEM_CONTENT_TYPE', `${base}.content`,
                    'content must be a string or object'));
            }
        });
    }

    // ── E) next_actions[] item shape ──────────────────────────────────────────
    if (isArr(output.next_actions)) {
        output.next_actions.forEach((item, i) => {
            const base = `next_actions[${i}]`;
            if (!isObj(item)) {
                errors.push(err('NEXT_ACTIONS_ITEM_NOT_OBJECT', base, 'each next_actions item must be an object'));
                return;
            }
            // title: string 1..120 (required)
            if (!('title' in item)) {
                errors.push(err('NEXT_ACTIONS_ITEM_MISSING_FIELD', `${base}.title`, 'field "title" is required'));
            } else {
                strLen(item.title, 1, 120, `${base}.title`, 'NEXT_ACTIONS_TITLE_LENGTH', errors);
            }
            // details: string 0..1000 (optional)
            if ('details' in item && item.details !== null) {
                strLen(item.details, 0, 1000, `${base}.details`, 'NEXT_ACTIONS_DETAILS_LENGTH', errors);
            }
            // owner_agent: string 1..40 (required)
            if (!('owner_agent' in item)) {
                errors.push(err('NEXT_ACTIONS_ITEM_MISSING_FIELD', `${base}.owner_agent`, 'field "owner_agent" is required'));
            } else {
                strLen(item.owner_agent, 1, 40, `${base}.owner_agent`, 'NEXT_ACTIONS_OWNER_LENGTH', errors);
            }
        });
    }

    // ── F) ledger_writes[] item shape ─────────────────────────────────────────
    if (isArr(output.ledger_writes)) {
        output.ledger_writes.forEach((item, i) => {
            const base = `ledger_writes[${i}]`;
            if (!isObj(item)) {
                errors.push(err('LEDGER_WRITES_ITEM_NOT_OBJECT', base, 'each ledger_writes item must be an object'));
                return;
            }
            // table: string, must be a known table
            if (!('table' in item)) {
                errors.push(err('LEDGER_WRITES_ITEM_MISSING_FIELD', `${base}.table`, 'field "table" is required'));
            } else if (!isStr(item.table) || !VALID_LEDGER_TABLES.has(item.table)) {
                errors.push(err('LEDGER_WRITES_INVALID_TABLE', `${base}.table`,
                    `"${item.table}" is not a valid ledger table. Valid: ${[...VALID_LEDGER_TABLES].join(', ')}`));
            }
            // type: string 1..40
            if (!('type' in item)) {
                errors.push(err('LEDGER_WRITES_ITEM_MISSING_FIELD', `${base}.type`, 'field "type" is required'));
            } else {
                strLen(item.type, 1, 40, `${base}.type`, 'LEDGER_WRITES_TYPE_LENGTH', errors);
            }
        });
    }

    return errors.length === 0
        ? { ok: true }
        : { ok: false, errors };
}

module.exports = { validateAgainstContract };
