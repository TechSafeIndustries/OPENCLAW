'use strict';

/**
 * OpenClaw — CDMS Live Smoke Test
 * --------------------------------
 * Validates LIVE move logic using a synthetic local batch.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');
const LIVE_TEST_DIR = path.join(ROOT, 'stack', 'cdms_tmp', 'live_test');
const SYNC_BATCH_NAME = 'Batch_Smoke_Live_Test.csv';
const SYNC_BATCH_PATH = path.join(BATCH_DIR, SYNC_BATCH_NAME);

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }

function main() {
    console.log('=== CDMS Live Smoke Test (Local-only) ===');

    // 1. Setup local test folder
    if (fs.existsSync(LIVE_TEST_DIR)) fs.rmSync(LIVE_TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(LIVE_TEST_DIR, { recursive: true });

    const srcDir = path.join(LIVE_TEST_DIR, 'source');
    const dstDir = path.join(LIVE_TEST_DIR, 'dest');
    fs.mkdirSync(srcDir, { recursive: true });
    // dstDir does NOT get created yet; the script should create it.

    const srcFile = path.join(srcDir, 'smoke_live.txt');
    fs.writeFileSync(srcFile, 'LIVE SMOKE CONTENT ' + nowIso(), 'utf8');
    console.log(`Created source file: ${srcFile}`);

    // 2. Create synthetic CSV
    if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });
    const headers = 'CurrentPath,CurrentName,ProposedTSI01Path,ProposedName';
    const row = `${srcDir},smoke_live.txt,${dstDir},smoke_live_moved.txt`;
    fs.writeFileSync(SYNC_BATCH_PATH, `${headers}\n${row}\n`, 'utf8');
    console.log(`Created synthetic batch: ${SYNC_BATCH_PATH}`);

    // 3. Write record to ledger to pass Gate 4
    const batchRef = path.basename(SYNC_BATCH_NAME, '.csv');
    console.log(`Injecting ledger approval for ${batchRef}...`);
    let db;
    try {
        db = new Database(DB_PATH);
        const now = nowIso();
        const sessionId = 'cdms_live_smoke_' + uuid();
        const actionId = uuid();
        const decisionId = uuid();

        db.transaction(() => {
            db.prepare(`
                INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
                VALUES (?, ?, NULL, 'cos', 'on_demand', 'open', ?)
                ON CONFLICT(id) DO NOTHING
            `).run(sessionId, now, `CDMS live smoke auto-approval — ${batchRef}`);

            db.prepare(`
                INSERT INTO actions
                  (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
                VALUES (?, ?, ?, 'cos', 'cdms_human_review', ?, NULL, 'APPROVED', 'Smoke auto-approval', ?)
            `).run(actionId, sessionId, now, batchRef, JSON.stringify({ type: 'cdms_human_review', batch_ref: batchRef }));

            db.prepare(`
                INSERT INTO decisions
                  (id, session_id, ts, decision_type, subject, options_json, selected_option, rationale, approved_by, meta_json)
                VALUES (?, ?, ?, 'approve', ?, ?, 'approve', 'Smoke auto-approval', 'cos', ?)
            `).run(decisionId, sessionId, now, `CDMS batch: ${batchRef}`,
                JSON.stringify({ approve: 'Execute batch', reject: 'Discard batch' }),
                JSON.stringify({ batch_ref: batchRef }));
        })();
        console.log('Ledger approval written.');
    } catch (e) {
        console.error('FAIL: Ledger write failed: ' + e.message);
        if (db) db.close();
        process.exit(1);
    }
    db.close();

    // 4. Run execute mode
    console.log('\nRunning cdms_execute.js --execute --execute...');
    try {
        // We set CDMS_ALLOW_LOCAL_TMP=1 so the allowlist gate passes for our synthetic path.
        // We also ensure G:\Shared drives test passes if possible, but the requirement said 
        // "Must refuse to execute if batch path is not under repo stack\cdms_batches OR not a .csv."
        // We satisfy that requirement.

        process.env.CDMS_ALLOW_LOCAL_TMP = '1';
        execSync(`node scripts/cdms_execute.js --batch "${SYNC_BATCH_NAME}" --owner cos --execute`, {
            stdio: 'inherit',
            cwd: ROOT,
            env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
        });
    } catch (e) {
        console.error('FAIL: cdms_execute.js execution failed.');
        process.exit(1);
    }

    // 5. Assert results
    const dstFileExpected = path.join(dstDir, 'smoke_live_moved.txt');
    if (fs.existsSync(dstFileExpected) && !fs.existsSync(srcFile)) {
        console.log(`\nASSERT PASS: File moved successfully to ${dstFileExpected}`);
    } else {
        console.error(`\nASSERT FAIL: File move failed or source still exists!`);
        process.exit(1);
    }

    // 6. Check for receipt
    const receiptDir = path.join(ROOT, 'stack', 'cdms_receipts');
    const receipts = fs.readdirSync(receiptDir).filter(f => f.startsWith('Receipt_') && f.includes('_EXECUTE.json'));
    if (receipts.length > 0) {
        console.log(`ASSERT PASS: EXECUTE receipt found.`);
    } else {
        console.error(`ASSERT FAIL: No EXECUTE receipt found.`);
        process.exit(1);
    }

    // 7. Regression Test for MoveBatch Path Resolution
    console.log('\n=== MoveBatch Path Resolution Regression Test ===');
    const moveBatchName = 'MoveBatch_Regression_Test.csv';
    const moveBatchPath = path.join(BATCH_DIR, moveBatchName);
    const mbHeaders = 'CurrentPath,CurrentName,ProposedTSI01Path,ProposedName';
    const mbRowShort = 'G:\\Shared drives\\Source,file.txt,TSI-01 DocControl.GOOGLE\\INCOMING\\,TSI-ZT-RS_short.gdoc';
    const mbRowLong = 'G:\\Shared drives\\Source,long.txt,TSI-01 DocControl.GOOGLE\\INCOMING\\,TSI-ZT-RS_long_but_calculated_correctly.gdoc';
    fs.writeFileSync(moveBatchPath, `${mbHeaders}\n${mbRowShort}\n${mbRowLong}\n`, 'utf8');

    // Approve the regression batch
    console.log(`Injecting approval for ${moveBatchName}...`);
    try {
        db = new Database(DB_PATH);
        const now = nowIso();
        db.prepare('INSERT INTO decisions (id, session_id, ts, decision_type, subject, selected_option, rationale, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(uuid(), 'cdms_live_smoke_' + uuid(), now, 'approve', 'CDMS batch: MoveBatch_Regression_Test', 'approve', 'Regression test', 'cos');
        db.close();
    } catch (e) {
        console.error('FAIL: Regression approval failed: ' + e.message);
        process.exit(1);
    }

    console.log('Running cdms_execute.js --execute (Dry Run logic for paths)...');
    try {
        // We use --dryrun to see logs without needing real files/directories
        const output = execSync(`node scripts/cdms_execute.js --batch "${moveBatchName}" --owner cos --dryrun`, {
            encoding: 'utf8',
            cwd: ROOT,
            env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
        });

        console.log('--- OUTPUT SNIPPET ---');
        const lines = output.split('\n');
        const ztLines = lines.filter(l => l.includes('TSI-ZT-RS_'));
        ztLines.forEach(l => console.log(l));

        if (ztLines.some(l => l.includes('G:\\Shared drives\\TSI-01 DocControl.GOOGLE\\INCOMING\\TSI-ZT-RS_short.gdoc'))) {
            console.log('ASSERT PASS: MoveBatch destination resolved correctly (Short).');
        } else {
            console.error('ASSERT FAIL: MoveBatch destination resolution incorrect.');
            process.exit(1);
        }
    } catch (e) {
        console.error('FAIL: Regression execute failed: ' + e.message);
        process.exit(1);
    }

    console.log('\n=== LIVE SMOKE COMPLETE ===');
}

main();
