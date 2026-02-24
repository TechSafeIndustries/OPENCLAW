'use strict';

/**
 * OpenClaw — CDMS Human Review CLI
 * ----------------------------------
 * Records a human approve/reject decision for a CDMS batch in the ledger.
 * No Drive writes occur here. This is purely an audit/gate record.
 *
 * Usage:
 *   node scripts/cdms_human_review.js \
 *     --batch <batch_id_or_filename> \
 *     --decision approve|reject \
 *     --reason "..." \
 *     --owner cos
 *
 * Ledger writes (single transaction):
 *   sessions  — ensures a cdms_review session exists
 *   actions   — type="cdms_human_review", status=APPROVED|REJECTED
 *   decisions — decision_type=approve|reject, subject=batch_ref, approved_by=owner
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }

function sha256(s) {
    return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Parse CLI args as a flat key→value map. Boolean flags get value true. */
function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2);
            if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                out[key] = argv[i + 1];
                i++;
            } else {
                out[key] = true;
            }
        }
    }
    return out;
}

/** Split a single CSV line respecting double-quoted fields. */
function splitCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQ = !inQ; }
        } else if (ch === ',' && !inQ) {
            cols.push(cur); cur = '';
        } else { cur += ch; }
    }
    cols.push(cur);
    return cols;
}

/** Read first N data rows from a CSV file, return { headers, rows }. */
function peekCsv(filePath, n) {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1, 1 + n).map(l => {
        const cols = splitCsvLine(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
        return obj;
    });
    return { headers, rows };
}

/** Resolve a batch_id or filename to an absolute path under BATCH_DIR. */
function resolveBatchPath(batchArg) {
    // If it's already an absolute path and exists, use it directly
    if (path.isAbsolute(batchArg) && fs.existsSync(batchArg)) return batchArg;

    // Try as a filename directly
    const direct = path.join(BATCH_DIR, batchArg);
    if (fs.existsSync(direct)) return direct;

    // Try as a batch_id prefix match (e.g. "high_2026-02-24_18-48-47")
    const entries = fs.existsSync(BATCH_DIR) ? fs.readdirSync(BATCH_DIR) : [];
    const match = entries.find(f =>
        f.includes(batchArg) && f.endsWith('.csv') && f.startsWith('MoveBatch_')
    );
    if (match) return path.join(BATCH_DIR, match);

    return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = parseArgs(process.argv.slice(2));

    // ── Required args ─────────────────────────────────────────────────────────
    const errors = [];
    if (!args.batch) errors.push('--batch is required (batch_id or filename)');
    if (!args.decision) errors.push('--decision is required (approve|reject)');
    if (!args.reason) errors.push('--reason is required');
    if (!args.owner) errors.push('--owner is required');

    if (errors.length) {
        console.error('VALIDATION ERRORS:');
        errors.forEach(e => console.error('  ' + e));
        console.error('\nUsage:');
        console.error('  node scripts/cdms_human_review.js --batch <id> --decision approve|reject --reason "..." --owner <name>');
        process.exit(1);
    }

    // ── Validate decision enum ────────────────────────────────────────────────
    const decision = args.decision.toLowerCase();
    if (!['approve', 'reject'].includes(decision)) {
        console.error(`FAIL: --decision must be "approve" or "reject", got "${args.decision}"`);
        process.exit(1);
    }

    // ── Resolve batch path ────────────────────────────────────────────────────
    const batchPath = resolveBatchPath(args.batch);
    if (!batchPath) {
        console.error(`FAIL: Batch not found under ${BATCH_DIR}`);
        console.error(`      Searched for: ${args.batch}`);
        console.error(`      Available batches:`);
        if (fs.existsSync(BATCH_DIR)) {
            fs.readdirSync(BATCH_DIR)
                .filter(f => f.startsWith('MoveBatch_') && f.endsWith('.csv'))
                .forEach(f => console.error(`        ${f}`));
        }
        process.exit(1);
    }

    const batchRef = path.basename(batchPath, '.csv');
    const owner = args.owner;
    const reason = args.reason;
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';

    // ── Peek first 5 rows for summary ─────────────────────────────────────────
    let rowCount = 0;
    let preview = [];
    try {
        const { rows, headers } = peekCsv(batchPath, 5);
        preview = rows;
        // Count all data rows
        const text = fs.readFileSync(batchPath, 'utf8');
        rowCount = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean).length - 1;
    } catch (err) {
        console.error(`FAIL: Could not read batch file: ${err.message}`);
        process.exit(1);
    }

    // ── Display summary to operator ───────────────────────────────────────────
    console.log(`\n=== CDMS Human Review ===`);
    console.log(`Batch      : ${batchRef}`);
    console.log(`Path       : ${batchPath}`);
    console.log(`Total rows : ${rowCount}`);
    console.log(`Decision   : ${status}`);
    console.log(`Owner      : ${owner}`);
    console.log(`Reason     : ${reason}`);
    console.log(`\nFirst ${preview.length} row(s):`);
    preview.forEach((r, i) => {
        const from = r.CurrentName || r.CurrentPath || '(unknown)';
        const to = r.ProposedTSI01Path || '(unknown)';
        console.log(`  [${i + 1}] ${from}  →  ${to}`);
    });

    // ── Open ledger ───────────────────────────────────────────────────────────
    let db;
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    } catch (err) {
        console.error(`FAIL: Cannot open ledger at ${DB_PATH}: ${err.message}`);
        process.exit(1);
    }

    const now = nowIso();
    const sessionId = args['session-id'] || ('cdms_review_' + uuid());
    const runId = args['run-id'] || ('cdms_run_' + uuid());
    const actionId = uuid();
    const decisionId = uuid();

    // ── Ensure session exists ─────────────────────────────────────────────────
    const ensureSession = db.prepare(`
        INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
        VALUES (@id, @started_at, NULL, @initiator, @mode, @status, @summary)
        ON CONFLICT(id) DO NOTHING
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

    const metaJson = JSON.stringify({
        run_id: runId,
        batch_ref: batchRef,
        batch_path: batchPath,
        row_count: rowCount,
        type: 'cdms_human_review',
    });

    try {
        db.transaction(() => {
            // Ensure session
            ensureSession.run({
                id: sessionId,
                started_at: now,
                initiator: owner,
                mode: 'on_demand',
                status: 'open',
                summary: `CDMS human review — ${batchRef}`,
            });

            // Action row — the gate event
            insertAction.run({
                id: actionId,
                session_id: sessionId,
                ts: now,
                actor: owner,
                type: 'cdms_human_review',
                input_ref: batchRef,
                output_ref: null,
                status: status,
                reason: reason,
                meta_json: metaJson,
            });

            // Decision row — the approval record checked by execute
            insertDecision.run({
                id: decisionId,
                session_id: sessionId,
                ts: now,
                decision_type: decision,   // 'approve' or 'reject'
                subject: `CDMS batch: ${batchRef}`,
                options_json: JSON.stringify({ approve: 'Execute batch', reject: 'Discard batch' }),
                selected_option: decision,
                rationale: reason,
                approved_by: owner,
                meta_json: metaJson,
            });
        })();
    } catch (err) {
        db.close();
        console.error(`FAIL: Ledger write failed: ${err.message}`);
        process.exit(1);
    }

    db.close();

    // ── Output ────────────────────────────────────────────────────────────────
    const nextCmd = decision === 'approve'
        ? `npm run workflow:cdms-execute -- --batch ${batchRef} --owner ${owner}`
        : `npm run workflow:cdms-plan-high`;

    const result = {
        ok: true,
        status,
        batch_ref: batchRef,
        row_count: rowCount,
        decision,
        owner,
        reason,
        ledger_writes: [
            { table: 'sessions', id: sessionId, type: 'cdms_review_session' },
            { table: 'actions', id: actionId, type: 'cdms_human_review', status },
            { table: 'decisions', id: decisionId, type: decision },
        ],
        recommended_next_command: nextCmd,
    };

    console.log('\n=== Ledger Written ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

main();
