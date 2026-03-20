/**
 * test/cdms_smoke_test.js
 * 
 * E2E Smoke test for CDMS Migration Pipeline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'stack', 'cdms_tmp');
const SRC_DIR = path.join(TMP_DIR, 'source');
const TGT_DIR = path.join(TMP_DIR, 'target');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');

function clearDir(dir) {
    if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(f => {
            const p = path.join(dir, f);
            if (fs.lstatSync(p).isDirectory()) clearDir(p);
            else fs.unlinkSync(p);
        });
    } else {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeBatch(filename, rows) {
    const headers = 'BatchId,SourceDrive,CurrentPath,CurrentName,CurrentType,ProposedTSI01Path,ProposedName,RenameReason,Confidence';
    const content = [headers, ...rows].join('\n') + '\n';
    fs.writeFileSync(path.join(BATCH_DIR, filename), content, 'utf8');
}

async function run() {
    console.log('--- START CDMS PIPELINE SMOKE TEST ---');

    // 0. Pre-check Ledger
    console.log('0. Verifying ledger...');
    execSync('npm run verify:ledger', { stdio: 'inherit' });

    // 1. Setup Environment
    console.log('1. Setting up temp directories...');
    clearDir(SRC_DIR);
    clearDir(TGT_DIR);
    if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

    const f1 = path.join(SRC_DIR, 'file1.txt');
    const f2 = path.join(SRC_DIR, 'file2.txt');
    const f4 = path.join(SRC_DIR, 'file4.txt');
    fs.writeFileSync(f1, 'content 1');
    fs.writeFileSync(f2, 'content 2');
    fs.writeFileSync(f4, 'content 4');

    // 2. Dry-Run Test
    console.log('2. Running Dry-Run test...');
    const batchDry = 'Batch_Smoke_Dry.csv';
    writeBatch(batchDry, [
        `smoke_dry,CurrentPath,${SRC_DIR},file1.txt,File,stack/cdms_tmp/target,file1.txt,Smoke dry,High`
    ]);

    // Approve it first
    execSync(`node scripts/cdms_human_review.js --batch ${batchDry} --decision approve --reason "Smoke Dry" --owner smoke-tester`, { stdio: 'inherit' });

    const dryOut = execSync(`node scripts/cdms_execute.js --batch ${batchDry} --dry-run --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();
    if (fs.existsSync(path.join(TGT_DIR, 'file1.txt'))) throw new Error('Dry-run moved file!');
    console.log('   PASS: Dry-run did not change filesystem.');

    // 3. Execute Move Test
    console.log('3. Running Execute Move test...');
    const batchExec = 'Batch_Smoke_Exec.csv';
    writeBatch(batchExec, [
        `smoke_exec,,${SRC_DIR},file1.txt,File,stack/cdms_tmp/target,file1_moved.txt,Smoke exec,High`
    ]);
    execSync(`node scripts/cdms_human_review.js --batch ${batchExec} --decision approve --reason "Smoke Exec" --owner smoke-tester`);
    execSync(`node scripts/cdms_execute.js --batch ${batchExec} --execute --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    });

    if (!fs.existsSync(path.join(TGT_DIR, 'file1_moved.txt'))) throw new Error('Execute failed to move file!');
    console.log('   PASS: File moved correctly.');

    // 4. Missing Source Row Skip Test
    console.log('4. Running Missing Source Skip test...');
    const batchSkip = 'Batch_Smoke_Skip.csv';
    // Row 1: Missing
    // Row 2: Valid (file2.txt)
    writeBatch(batchSkip, [
        `smoke_skip,,${SRC_DIR},missing.txt,File,stack/cdms_tmp/target,missing.txt,Smoke skip,High`,
        `smoke_skip,,${SRC_DIR},file2.txt,File,stack/cdms_tmp/target,file2_moved.txt,Smoke skip,High`
    ]);
    execSync(`node scripts/cdms_human_review.js --batch ${batchSkip} --decision approve --reason "Smoke Skip" --owner smoke-tester`);
    const skipOut = execSync(`node scripts/cdms_execute.js --batch ${batchSkip} --execute --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();

    if (!skipOut.includes('SKIPPED_MISSING_SOURCE')) throw new Error('Missing source not skipped!');
    if (!fs.existsSync(path.join(TGT_DIR, 'file2_moved.txt'))) throw new Error('Subsequent row failed after skip!');
    console.log('   PASS: Missing source skipped and batch continued.');

    // 5. Overwrite Stop-Loss Test
    console.log('5. Running Overwrite Stop-Loss test...');
    const batchStop = 'Batch_Smoke_Stop.csv';
    // file1_moved already exists in target
    writeBatch(batchStop, [
        `smoke_stop,,${SRC_DIR},file4.txt,File,stack/cdms_tmp/target,file1_moved.txt,Smoke stop,High`, // This will fail (overwrite)
        `smoke_stop,,${SRC_DIR},file4.txt,File,stack/cdms_tmp/target,file4_moved.txt,Smoke stop,High`  // This should be skipped
    ]);
    execSync(`node scripts/cdms_human_review.js --batch ${batchStop} --decision approve --reason "Smoke Stop" --owner smoke-tester`);

    try {
        execSync(`node scripts/cdms_execute.js --batch ${batchStop} --execute --owner smoke-tester`, {
            env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
        });
    } catch (err) {
        const out = err.stdout.toString();
        if (!out.includes('Destination already exists (no overwrite)')) throw new Error('Wrong stop-loss error!');
        if (!out.includes('STOP-LOSS: Aborting')) throw new Error('Stop-loss not triggered!');

        // Check runsheet if possible, or just output
        if (fs.existsSync(path.join(TGT_DIR, 'file4_moved.txt'))) throw new Error('Stop-loss failed to abort remaining rows!');
        console.log('   PASS: Overwrite triggered Stop-Loss and aborted batch.');
    }

    console.log('\n--- ALL CDMS SMOKE TESTS PASSED ---');
}

run().catch(err => {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    process.exit(1);
});
