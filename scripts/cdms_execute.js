'use strict';

/**
 * OpenClaw — CDMS Execute (dry-run gate)
 * ----------------------------------------
 * Runs all hard gates before any Drive write is attempted.
 * Default mode: DRY-RUN (safe, no Drive calls).
 * --live flag: exits with LIVE_NOT_IMPLEMENTED (not yet built).
 *
 * Usage:
 *   node scripts/cdms_execute.js --batch <path_or_id> --owner <name> [--live]
 *
 * Gates:
 *   1. Batch exists under stack/cdms_batches/
 *   2. CSV parses and row count <= policy.maxBatchSize
 *   3. Every ProposedTSI01Path starts with policy.allowlistRoots[0]
 *   4. Ledger has an APPROVED cdms_human_review decision for this batch_ref
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');
const POLICY_PATH = path.join(ROOT, 'policy', 'cdms_write_v1.json');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const RECEIPT_DIR = path.join(ROOT, 'stack', 'cdms_receipts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}
function sha256(s) {
    return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2);
            if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                out[key] = argv[i + 1]; i++;
            } else {
                out[key] = true;
            }
        }
    }
    return out;
}

function splitCsvLine(line) {
    const cols = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQ = !inQ; }
        } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
        else { cur += ch; }
    }
    cols.push(cur);
    return cols;
}

function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(l => {
        const cols = splitCsvLine(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
        return obj;
    });
    return { headers, rows };
}

function resolveBatchPath(batchArg) {
    if (path.isAbsolute(batchArg) && fs.existsSync(batchArg)) return batchArg;
    const direct = path.join(BATCH_DIR, batchArg);
    if (fs.existsSync(direct)) return direct;
    const entries = fs.existsSync(BATCH_DIR) ? fs.readdirSync(BATCH_DIR) : [];
    const match = entries.find(f =>
        f.includes(batchArg) && f.endsWith('.csv') && f.startsWith('MoveBatch_')
    );
    return match ? path.join(BATCH_DIR, match) : null;
}

function fail(msg, code = 1) {
    console.error('\nFAIL: ' + msg);
    process.exit(code);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = parseArgs(process.argv.slice(2));

    // ── --live short-circuit ──────────────────────────────────────────────────
    if (args.live) {
        console.error('LIVE_NOT_IMPLEMENTED');
        console.error('Live Drive execution is not yet built.');
        console.error('Re-run without --live to produce a dry-run receipt and run sheet.');
        process.exit(2);
    }

    // ── Required args ─────────────────────────────────────────────────────────
    if (!args.batch) fail('--batch is required (batch_id or filename)');
    if (!args.owner) fail('--owner is required');

    const owner = args.owner;

    // ── Load policy ───────────────────────────────────────────────────────────
    console.log('\n=== CDMS Execute — DRY-RUN ===');
    let policy;
    try {
        policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    } catch (err) {
        fail('Cannot load policy: ' + err.message);
    }
    const allowlistRoot = policy.allowlistRoots[0];
    const maxBatchSize = policy.maxBatchSize;
    console.log(`Policy loaded: allowlistRoot="${allowlistRoot}", maxBatchSize=${maxBatchSize}`);

    // ── Gate 1: batch exists ──────────────────────────────────────────────────
    const batchPath = resolveBatchPath(args.batch);
    if (!batchPath) {
        console.error(`\nAvailable batches in ${BATCH_DIR}:`);
        if (fs.existsSync(BATCH_DIR)) {
            fs.readdirSync(BATCH_DIR)
                .filter(f => f.startsWith('MoveBatch_') && f.endsWith('.csv'))
                .forEach(f => console.error('  ' + f));
        }
        fail(`Batch not found: ${args.batch}`);
    }
    const batchRef = path.basename(batchPath, '.csv');
    console.log(`\n[GATE 1] Batch exists    : PASS  (${batchRef})`);

    // ── Gate 2: CSV parses + row count ────────────────────────────────────────
    let rows;
    try {
        const text = fs.readFileSync(batchPath, 'utf8');
        ({ rows } = parseCsv(text));
    } catch (err) {
        fail('CSV parse error: ' + err.message);
    }
    if (rows.length === 0) fail('Batch is empty (0 data rows).');
    if (rows.length > maxBatchSize) {
        fail(`Batch has ${rows.length} rows, exceeds maxBatchSize=${maxBatchSize}. Split the batch.`);
    }
    console.log(`[GATE 2] Row count       : PASS  (${rows.length} rows, max=${maxBatchSize})`);

    // ── Gate 3: allowlist check on every row ──────────────────────────────────
    // Normalise both sides to forward-slash before comparing (MoveMap uses backslash)
    const normRoot = allowlistRoot.replace(/\\/g, '/');
    const violators = rows.filter(r => {
        const normPath = (r.ProposedTSI01Path || '').replace(/\\/g, '/');
        return !normPath.startsWith(normRoot);
    });
    if (violators.length > 0) {
        console.error('\nAllowlist violations:');
        violators.forEach(r => console.error(`  "${r.ProposedTSI01Path}"`));
        fail(`${violators.length} row(s) violate allowlistRoots. Abort.`);
    }
    console.log(`[GATE 3] Allowlist       : PASS  (all ${rows.length} rows → "${allowlistRoot}...")`);

    // ── Gate 4: ledger approval ───────────────────────────────────────────────
    let db;
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    } catch (err) {
        fail('Cannot open ledger: ' + err.message);
    }

    const approval = db.prepare(`
        SELECT id, approved_by, ts
        FROM decisions
        WHERE decision_type = 'approve'
          AND subject = ?
        ORDER BY ts DESC
        LIMIT 1
    `).get('CDMS batch: ' + batchRef);

    if (!approval) {
        db.close();
        fail(
            `No APPROVED decision found in ledger for batch "${batchRef}".\n` +
            `  Run first: npm run workflow:cdms-human-review -- --batch ${batchRef} --decision approve --reason "..." --owner ${owner}`
        );
    }
    console.log(`[GATE 4] Ledger approval : PASS  (approved_by="${approval.approved_by}" at ${approval.ts})`);
    console.log('\nGATES_PASSED — all 4 gates passed. Mode: DRY-RUN');

    // ── Write receipt ─────────────────────────────────────────────────────────
    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });

    const ts = nowStamp();
    const receiptPath = path.join(RECEIPT_DIR, `Receipt_${ts}_DRYRUN.json`);
    const receipt = {
        mode: 'DRYRUN',
        batch_ref: batchRef,
        batch_path: batchPath,
        owner,
        ts: nowIso(),
        gates_passed: true,
        gates: {
            batch_exists: true,
            row_count: rows.length,
            max_batch_size: maxBatchSize,
            allowlist_ok: true,
            allowlist_root: allowlistRoot,
            approval_id: approval.id,
            approved_by: approval.approved_by,
            approval_ts: approval.ts,
        },
        planned_operations: rows.map(r => ({
            source_drive: r.SourceDrive,
            current_name: r.CurrentName,
            current_path: r.CurrentPath,
            proposed_path: r.ProposedTSI01Path,
            proposed_name: r.ProposedName,
            rename_reason: r.RenameReason,
            confidence: r.Confidence,
            action: 'MOVE',
        })),
        note: 'DRY-RUN only. No Drive calls made. Re-run with --live once live execute is implemented.',
    };

    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`\nReceipt written: ${receiptPath}`);

    // ── Ledger entry ──────────────────────────────────────────────────────────
    const now = nowIso();
    const sessionId = 'cdms_execute_' + uuid();
    const actionId = uuid();
    const metaJson = JSON.stringify({
        batch_ref: batchRef,
        batch_path: batchPath,
        row_count: rows.length,
        mode: 'DRYRUN',
        receipt_path: receiptPath,
        type: 'cdms_execute',
    });

    try {
        db.transaction(() => {
            db.prepare(`
                INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
                VALUES (?, ?, NULL, ?, 'on_demand', 'open', ?)
                ON CONFLICT(id) DO NOTHING
            `).run(sessionId, now, owner, 'CDMS execute dry-run — ' + batchRef);

            db.prepare(`
                INSERT INTO actions
                  (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
                VALUES (?, ?, ?, ?, 'cdms_execute', ?, NULL, 'DRYRUN', ?, ?)
            `).run(actionId, sessionId, now, owner, batchRef,
                `dry-run; gates passed; rows=${rows.length}`, metaJson);
        })();
        console.log(`Ledger entry written: action id=${actionId} status=DRYRUN`);
    } catch (err) {
        console.warn('WARN: Ledger write failed (non-fatal in dry-run):', err.message);
    }

    db.close();

    // ── Final summary ─────────────────────────────────────────────────────────
    console.log('\n=== DRY-RUN COMPLETE ===');
    console.log(`  Batch    : ${batchRef}`);
    console.log(`  Rows     : ${rows.length}`);
    console.log(`  Receipt  : ${receiptPath}`);
    console.log(`  Next     : npm run workflow:cdms-verify -- --batch ${batchRef} --owner ${owner}`);
    console.log('  (Or wait for live execute to be implemented before running verify.)');
    process.exit(0);
}

main();
