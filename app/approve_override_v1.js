/**
 * OpenClaw — Governance Approval Override v1
 * --------------------------------------------
 * Provides two functions:
 *
 *   approveOverride({ session_id, intent, approved_by, rationale })
 *     -> { ok: true, decision_id } | { ok: false, error: string }
 *
 *   hasApprovedOverride({ session_id, intent })
 *     -> boolean
 *
 * Approvals are logged as permanent records in the decisions + actions tables.
 * The dispatcher reads hasApprovedOverride() before honouring override_governance=true.
 *
 * Deps: better-sqlite3, Node core only.
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'openclaw_ledger.db');

// ── approveOverride ───────────────────────────────────────────────────────────
/**
 * Writes a governance approval record to decisions + actions tables.
 *
 * @param {string} session_id   - Session this approval applies to
 * @param {string} intent       - Controlled intent being approved (e.g. SALES_INTERNAL)
 * @param {string} approved_by  - Operator identifier (required)
 * @param {string} rationale    - Reason for approval (required)
 * @returns {{ ok: true, decision_id: string } | { ok: false, error: string }}
 */
function approveOverride({ session_id, intent, approved_by, rationale, run_id } = {}) {
    // Guard: all fields required
    const missing = [];
    if (!session_id) missing.push('session_id');
    if (!intent) missing.push('intent');
    if (!approved_by) missing.push('approved_by');
    if (!rationale) missing.push('rationale');
    if (missing.length > 0) {
        return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
    }

    const now = new Date().toISOString();
    const decisionId = 'decision_' + Date.now();
    const actionId = 'action_' + (Date.now() + 1);   // +1 to avoid collision in same ms

    try {
        const db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = OFF');   // session pre-existence not enforced at this layer

        db.transaction(() => {
            // ── decisions row ────────────────────────────────────────────────
            db.prepare(`
                INSERT INTO decisions
                  (id, session_id, ts, decision_type, subject,
                   options_json, selected_option, rationale, approved_by, meta_json)
                VALUES
                  (@id, @session_id, @ts, @decision_type, @subject,
                   @options_json, @selected_option, @rationale, @approved_by, @meta_json)
            `).run({
                id: decisionId,
                session_id,
                ts: now,
                decision_type: 'approve',
                subject: 'Override governance gate',
                options_json: JSON.stringify({ intent }),
                selected_option: 'override_approved',
                rationale,
                approved_by,
                meta_json: JSON.stringify({ run_id: run_id || null }),
            });

            // ── actions row ──────────────────────────────────────────────────
            db.prepare(`
                INSERT INTO actions
                  (id, session_id, ts, actor, type, input_ref, output_ref,
                   status, reason, meta_json)
                VALUES
                  (@id, @session_id, @ts, @actor, @type, @input_ref, @output_ref,
                   @status, @reason, @meta_json)
            `).run({
                id: actionId,
                session_id,
                ts: now,
                actor: 'governance',
                type: 'approve_override',
                input_ref: null,
                output_ref: null,
                status: 'ok',
                reason: `intent=${intent}`,
                meta_json: JSON.stringify({ decision_id: decisionId, approved_by, run_id: run_id || null }),
            });
        })();

        db.close();
        return { ok: true, decision_id: decisionId };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// ── hasApprovedOverride ───────────────────────────────────────────────────────
/**
 * Checks whether an approved override exists in decisions for the given
 * session_id + intent combination.
 *
 * @param {string} session_id
 * @param {string} intent
 * @returns {boolean}
 */
function hasApprovedOverride({ session_id, intent } = {}) {
    if (!session_id || !intent) return false;

    try {
        const db = new Database(DB_PATH, { readonly: true });

        // Match: session_id + selected_option="override_approved"
        //        + options_json contains the intent string
        const rows = db.prepare(`
            SELECT id FROM decisions
            WHERE  session_id      = @session_id
              AND  selected_option = 'override_approved'
              AND  options_json    LIKE @intent_pattern
            LIMIT 1
        `).all({
            session_id,
            intent_pattern: `%"${intent}"%`,
        });

        db.close();
        return rows.length > 0;
    } catch (_err) {
        // If DB is unavailable, fail closed (deny override)
        return false;
    }
}

module.exports = { approveOverride, hasApprovedOverride };
