'use strict';

/**
 * OpenClaw — CDMS Verify (DriveFS MVP)
 * ------------------------------------
 * Verifies a moved batch by checking the local filesystem (Drive for Desktop).
 * 
 * PASS: Target exists AND Source does NOT exist.
 * FAIL: Otherwise (e.g. source still exists, target missing, etc).
 * 
 * Usage:
 *   node scripts/cdms_verify_drivefs.js --batch <path> --owner <string>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const RECEIPT_DIR = path.join(ROOT, 'stack', 'cdms_receipts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
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
    const headers = splitCsvLine(lines[0]).map(h => h.trim());
    const rows = lines.slice(1).map(l => {
        const cols = splitCsvLine(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
        return obj;
    });
    return { headers, rows };
}

function mapPath(p) {
    if (!p) return '';
    let norm = p.replace(/\//g, '\\');
    const tsiPrefix = 'TSI-01 DocControl.GOOGLE';
    if (norm.startsWith(tsiPrefix)) {
        return 'G:\\Shared drives\\' + norm;
    }
    return norm;
}

function fail(msg, code = 1) {
    console.error('\nFAIL: ' + msg);
    process.exit(code);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.batch) fail('--batch is required');
    if (!args.owner) fail('--owner is required');

    const owner = args.owner;
    let batchPath = args.batch;
    if (!path.isAbsolute(batchPath)) {
        const direct = path.join(BATCH_DIR, batchPath);
        if (fs.existsSync(direct)) {
            batchPath = direct;
        } else if (fs.existsSync(path.join(ROOT, batchPath))) {
            batchPath = path.join(ROOT, batchPath);
        }
    }

    if (!fs.existsSync(batchPath)) fail(`Batch not found: ${batchPath}`);

    const batchRef = path.basename(batchPath);
    console.log(`\n=== CDMS Verify (DriveFS) ===`);
    console.log(`Batch: ${batchRef}`);
    console.log(`Owner: ${owner}`);

    const text = fs.readFileSync(batchPath, 'utf8');
    const { rows } = parseCsv(text);
    if (rows.length === 0) fail('Batch is empty.');

    const items = [];
    let passCount = 0;
    let failCount = 0;

    rows.forEach((row, idx) => {
        // Flexible header matching
        const curPathRaw = row.CurrentPath || row.currentPath || '';
        const curName = row.CurrentName || row.currentName || '';
        const propPathRaw = row.ProposedPath || row.ProposedTSI01Path || row.proposedPath || '';
        const propName = row.ProposedName || row.proposedName || curName;

        const sourcePath = mapPath(curPathRaw);
        const targetPath = mapPath(propPathRaw);

        const sourceFullPath = path.join(sourcePath, curName);
        const targetFullPath = path.join(targetPath, propName);

        let sExists = false;
        let tExists = false;
        try { sExists = fs.existsSync(sourceFullPath); } catch (e) { }
        try { tExists = fs.existsSync(targetFullPath); } catch (e) { }

        let status = 'FAIL';
        let reason = '';

        if (tExists && !sExists) {
            status = 'PASS';
            passCount++;
        } else {
            failCount++;
            if (sExists && tExists) reason = 'Both exist (source move failed or copy made)';
            else if (!sExists && !tExists) reason = 'Neither exist (file lost or paths wrong)';
            else if (sExists && !tExists) reason = 'Source exists, Target missing (move not started)';
            else if (!tExists) reason = 'Target missing';
        }

        items.push({
            row_index: idx + 1,
            sourceFullPath,
            targetFullPath,
            source_exists: sExists,
            target_exists: tExists,
            status,
            reason
        });
    });

    const statusOverall = failCount === 0 ? 'PASS' : 'FAIL';
    const ts = nowStamp();
    const receiptPath = path.join(RECEIPT_DIR, `Receipt_${ts}_VERIFY_DRIVEFS.json`);

    const receipt = {
        batch_ref: batchRef,
        owner,
        method: 'drivefs',
        ts: nowIso(),
        summary: {
            total: rows.length,
            pass: passCount,
            fail: failCount,
            status: statusOverall
        },
        items,
        note: 'DriveFS may lag sync; rerun verify if FAIL and move already completed.'
    };

    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`\nReceipt written: ${receiptPath}`);
    console.log(`Summary: ${statusOverall} (${passCount} PASS, ${failCount} FAIL)`);

    // ── Ledger entry ──────────────────────────────────────────────────────────
    let db;
    try {
        db = new Database(DB_PATH);
        const sessionId = 'cdms_verify_' + uuid();
        const actionId = uuid();
        const now = nowIso();

        db.transaction(() => {
            db.prepare(`
                INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
                VALUES (?, ?, ?, ?, 'on_demand', 'closed', ?)
            `).run(sessionId, now, now, owner, `CDMS verify drivefs — ${batchRef}`);

            db.prepare(`
                INSERT INTO actions
                  (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
                VALUES (?, ?, ?, ?, 'cdms_verify', ?, ?, ?, ?, ?)
            `).run(
                actionId, sessionId, now, owner,
                batchRef, receiptPath, statusOverall,
                `${passCount} pass, ${failCount} fail`,
                JSON.stringify({
                    method: 'drivefs',
                    receipt_ref: receiptPath,
                    items_summary: { pass: passCount, fail: failCount }
                })
            );
        })();
        console.log(`Ledger entry written: action id=${actionId}`);
    } catch (err) {
        console.warn('WARN: Ledger write failed:', err.message);
    } finally {
        if (db) db.close();
    }

    process.exit(statusOverall === 'PASS' ? 0 : 0); // Always exit 0 to allow wrapper to finish normally
}

main();
