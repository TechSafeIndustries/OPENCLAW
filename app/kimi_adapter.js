/**
 * OpenClaw — Kimi Adapter v1
 * ----------------------------
 * Single interface between the dispatcher and the Moonshot AI (Kimi) LLM.
 * callKimi() is SYNCHRONOUS — dispatcher calls it with a plain function call.
 *
 * MODES (set via KIMI_MODE env var):
 *
 *   KIMI_MODE=stub
 *     Returns a deterministic good JSON string conforming to the cos contract.
 *     No network calls. Safe for pipeline smoke-testing.
 *
 *   KIMI_MODE=bad_stub
 *     Returns a deliberately invalid JSON string that fails contract validation.
 *     Used for REJECTED-path testing.
 *
 *   KIMI_MODE=real  (or unset)
 *     Makes a real synchronous HTTPS call to the Moonshot AI API.
 *     Requires env vars:
 *       MOONSHOT_API_KEY  (primary)   — or KIMI_API_KEY (fallback)
 *       KIMI_BASE_URL     (optional)  — default: https://api.moonshot.ai/v1
 *       KIMI_MODEL        (optional)  — default: kimi-k2.5-instant
 *
 * Usage:
 *   const { callKimi } = require('./kimi_adapter');
 *   const raw = callKimi({ system, user, agent, intent });  // returns JSON string
 *   const output = JSON.parse(raw);
 *
 * Deps: Node core only (https, http, url, child_process).
 */

'use strict';

const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');
const path = require('path');

// ── Stub response factory ─────────────────────────────────────────────────────
// Returns a JSON string that satisfies every field in required_fields for the
// cos contract: agent, version, intent, summary, outputs, ledger_writes.
function buildStubResponse({ agent, user, intent }) {
    const goalSnippet = (typeof user === 'string')
        ? user.slice(0, 120).replace(/\n/g, ' ')
        : '[no user goal provided]';

    return JSON.stringify({
        agent,
        version: 'v1.0',
        intent: intent || 'PLAN_WORK',
        summary: `[STUB] ${agent} received: "${goalSnippet}". No real LLM call made.`,
        outputs: [
            {
                type: 'plan',
                title: 'Stub Plan',
                content: `Stub output from agent "${agent}" for intent "${intent || 'PLAN_WORK'}". Replace with real Kimi response when adapter is live.`,
            },
        ],
        ledger_writes: [
            {
                table: 'artifacts',
                type: 'plan',
                note: 'stub — not written to DB until dispatcher writes artifacts',
            },
        ],
        next_actions: [
            {
                title: `Stub task from ${agent} for ${intent || 'PLAN_WORK'}`,
                details: 'Created by Kimi stub for v1 pipeline test. Replace with real agent output.',
                owner_agent: agent,
            },
        ],
        _stub: true,
    });
}

// ── Bad-stub response factory ─────────────────────────────────────────────────
// Returns a JSON string that FAILS contract validation:
//   - summary > 300 chars (SUMMARY_LENGTH)
//   - ledger_writes omitted (MISSING_REQUIRED_FIELD)
//   - outputs[0] missing "title" (OUTPUTS_ITEM_MISSING_FIELD)
function buildBadStubResponse({ agent, intent }) {
    return JSON.stringify({
        agent,
        version: 'v1.0',
        intent: intent || 'PLAN_WORK',
        summary: 'X'.repeat(350),               // deliberately too long
        outputs: [
            {
                type: 'plan',
                // title intentionally omitted
                content: 'Bad stub output — missing title field.',
            },
        ],
        // ledger_writes intentionally omitted
        _bad_stub: true,
    });
}

// ── Synchronous HTTPS helper ──────────────────────────────────────────────────
// Makes a blocking HTTPS POST using Node's child_process.execFileSync to run
// a tiny inline Node script, capturing stdout. This keeps callKimi() sync
// while using the installed openai SDK — no new npm deps required.
//
// Why not https.request directly? https.request is async-only in Node. The
// dispatcher is sync (better-sqlite3 transactions, synchronous contract checks).
// Shelling out to a child process is the cleanest zero-refactor approach.
//
// The child script is written inline to avoid a temp file race.
function callKimiReal({ system, user, apiKey, baseURL, model, timeout, max_tokens }) {
    // max_tokens is optional — only injected into create() call when provided
    const maxTokLine = (max_tokens != null)
        ? `        max_tokens:  ${JSON.stringify(max_tokens)},`
        : '';

    const childScript = `
'use strict';
const { OpenAI } = require('openai');
const client = new OpenAI({
    apiKey:  ${JSON.stringify(apiKey)},
    baseURL: ${JSON.stringify(baseURL)},
    timeout: ${JSON.stringify(timeout)},
});
async function run() {
    const completion = await client.chat.completions.create({
        model:       ${JSON.stringify(model)},
        temperature: 0,
${maxTokLine}
        messages: [
            { role: 'system', content: ${JSON.stringify(system)} },
            { role: 'user',   content: ${JSON.stringify(user)}   },
        ],
    });
    const content = completion.choices[0].message.content;
    process.stdout.write(content);
}
run().catch(err => {
    process.stderr.write('KIMI_API_CALL_FAILED: ' + err.message);
    process.exit(1);
});
`;

    let stdout;
    try {
        stdout = execFileSync(process.execPath, ['-e', childScript], {
            timeout: timeout + 5000,   // extra 5s for process overhead
            encoding: 'utf8',
        });
    } catch (err) {
        // execFileSync throws on non-zero exit — stderr in err.stderr
        const errMsg = (err.stderr || '').toString().trim() || err.message;
        throw new Error(errMsg || 'KIMI_API_CALL_FAILED: unknown error');
    }

    return stdout;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * callKimi({ system, user, agent, intent, max_tokens })
 *
 * @param {string}  system     - System prompt
 * @param {string}  user       - User message
 * @param {string}  agent      - Agent name (used in stub response)
 * @param {string}  intent     - Resolved intent
 * @param {number}  [max_tokens] - Optional token cap for the completion
 * @returns {string}           - Raw JSON string (caller must JSON.parse)
 * @throws  {Error}            - KIMI_API_KEY_MISSING | KIMI_API_CALL_FAILED | KIMI_NOT_CONFIGURED
 */
function callKimi({ system, user, agent, intent, max_tokens } = {}) {
    const mode = process.env.KIMI_MODE || 'real';

    // ── Stub modes ─────────────────────────────────────────────────────────────
    if (mode === 'stub') {
        return buildStubResponse({ agent: agent || 'unknown', user, intent });
    }

    if (mode === 'bad_stub') {
        return buildBadStubResponse({ agent: agent || 'unknown', intent });
    }

    // ── Real mode ──────────────────────────────────────────────────────────────
    if (mode === 'real') {
        const apiKey = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '';
        if (!apiKey) {
            throw new Error(
                'KIMI_API_KEY_MISSING: set MOONSHOT_API_KEY (or KIMI_API_KEY) in environment. ' +
                'For local testing use KIMI_MODE=stub.'
            );
        }

        const baseURL = process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1';
        const model = process.env.KIMI_MODEL || 'kimi-k2.5-instant';
        const timeout = parseInt(process.env.KIMI_TIMEOUT_MS || '30000', 10);

        return callKimiReal({ system, user, apiKey, baseURL, model, timeout, max_tokens });
    }

    // Unknown KIMI_MODE value
    throw new Error(
        `KIMI_NOT_CONFIGURED: unrecognised KIMI_MODE="${mode}". ` +
        'Valid values: "stub", "bad_stub", "real" (or unset for real).'
    );
}

module.exports = { callKimi };
