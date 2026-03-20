/**
 * scripts/cdms_smoke_test.js
 * 
 * E2E Smoke test for CDMS Migration Pipeline.
 * 
 * Rule B: Using resolveDestAbs helper for expected path validation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveDestAbs } = require('../app/resolve_dest_path_v1');

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

    // 0. Verifying ledger...
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
    // Here we pass a path that already includes stack/cdms_tmp to test the duplication fix
    const pTSI_with_root = 'stack/cdms_tmp/target';
    writeBatch(batchDry, [
        `smoke_dry,CurrentPath,${SRC_DIR},file1.txt,File,${pTSI_with_root},file1.txt,Smoke dry,High`
    ]);

    // Approve it
    execSync(`node scripts/cdms_human_review.js --batch ${batchDry} --decision approve --reason "Smoke Dry" --owner smoke-tester`, { stdio: 'inherit' });

    const dryOut = execSync(`node scripts/cdms_execute.js --batch ${batchDry} --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();

    // Validate expected destination via helper (Rule B)
    const expectedDst = resolveDestAbs(TMP_DIR, pTSI_with_root, 'file1.txt');
    console.log(`   Validation: Expected destination resolved to: ${expectedDst}`);

    // Check for duplication in expectedDst (Assertion)
    const rootBase = path.basename(TMP_DIR);
    const doubleBase = path.join(rootBase, rootBase).toLowerCase();
    if (expectedDst.toLowerCase().includes(doubleBase)) {
        throw new Error(`FAIL: Resolve helper failed to prevent duplication in smoke test! Resolved=${expectedDst}`);
    }

    if (fs.existsSync(expectedDst)) throw new Error('Dry-run moved file!');
    console.log('   PASS: Dry-run did not change filesystem and path resolved correctly.');

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

    const execDst = resolveDestAbs(TMP_DIR, 'stack/cdms_tmp/target', 'file1_moved.txt');
    if (!fs.existsSync(execDst)) throw new Error(`Execute failed to move file to ${execDst}`);
    console.log('   PASS: File moved correctly to resolved path.');

    // 4. Missing Source Row Skip Test
    console.log('4. Running Missing Source Skip test...');
    const batchSkip = 'Batch_Smoke_Skip.csv';
    writeBatch(batchSkip, [
        `smoke_skip,,${SRC_DIR},missing.txt,File,stack/cdms_tmp/target,missing.txt,Smoke skip,High`,
        `smoke_skip,,${SRC_DIR},file2.txt,File,stack/cdms_tmp/target,file2_moved.txt,Smoke skip,High`
    ]);
    execSync(`node scripts/cdms_human_review.js --batch ${batchSkip} --decision approve --reason "Smoke Skip" --owner smoke-tester`);
    const skipOut = execSync(`node scripts/cdms_execute.js --batch ${batchSkip} --execute --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();

    if (!skipOut.includes('SKIPPED_MISSING_SOURCE')) throw new Error('Missing source not skipped!');
    const f2Moved = resolveDestAbs(TMP_DIR, 'stack/cdms_tmp/target', 'file2_moved.txt');
    if (!fs.existsSync(f2Moved)) throw new Error('Subsequent row failed after skip!');
    console.log('   PASS: Missing source skipped and batch continued.');

    // 4.5 Directory Source Skip Test
    console.log('4.5 Running Directory Source Skip test...');
    const dirSource = path.join(SRC_DIR, 'subfolder');
    if (!fs.existsSync(dirSource)) fs.mkdirSync(dirSource, { recursive: true });

    const batchDirSkip = 'Batch_Smoke_DirSkip.csv';
    writeBatch(batchDirSkip, [
        `smoke_dir_skip,,${SRC_DIR},subfolder,Folder,stack/cdms_tmp/target,subfolder_target,Smoke dir skip,High`
    ]);
    execSync(`node scripts/cdms_human_review.js --batch ${batchDirSkip} --decision approve --reason "Smoke Dir Skip" --owner smoke-tester`);
    const dirSkipOut = execSync(`node scripts/cdms_execute.js --batch ${batchDirSkip} --execute --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();

    if (!dirSkipOut.includes('SKIPPED_SOURCE_IS_DIRECTORY')) throw new Error('Directory source not skipped!');
    console.log('   PASS: Directory source skipped correctly.');

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

        const f4Moved = resolveDestAbs(TMP_DIR, 'stack/cdms_tmp/target', 'file4_moved.txt');
        if (fs.existsSync(f4Moved)) throw new Error('Stop-loss failed to abort remaining rows!');
        console.log('   PASS: Overwrite triggered Stop-Loss and aborted batch.');
    }

    console.log('\n--- ALL CDMS SMOKE TESTS PASSED ---');
}

run().catch(err => {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    process.exit(1);
});
