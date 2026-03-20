/**
 * test/cdms_batch_build_smoke.js
 * 
 * Smoke test for CDMS Batch Builder logic.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const EXPORTS_DIR = path.join(ROOT, 'stack', 'drive_exports');
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

async function run() {
    console.log('--- START CDMS BATCH BUILD SMOKE TEST ---');

    // 1. Setup Environment
    console.log('1. Setting up temp directories...');
    if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

    const driveName = "Smoke_Test_Drive";
    const safeDrive = driveName.replace(/[^a-zA-Z0-9]/g, '_');

    // Create a mock inventory CSV
    const csvPath = path.join(EXPORTS_DIR, `${safeDrive}_inventory_smoke.csv`);
    const csvHeader = 'RunId,DriveName,RootAbsPath,RelPath,FileName,Extension,SizeBytes,LastWriteTimeIso,IsDirectory,DocId,Url';
    const csvRows = [
        `smoke_run,${driveName},C:/tmp/root,\,file1.txt,.txt,10,2026-03-01T20:00:00Z,false,,`,
        `smoke_run,${driveName},C:/tmp/root,\Policies\Security_And_Access_Control\,security.pdf,.pdf,20,2026-03-01T20:00:00Z,false,,`
    ];
    fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n') + '\n', 'utf8');

    // 2. Test Stale Export Rejection
    console.log('2. Testing stale export rejection...');
    const summaryPath = path.join(EXPORTS_DIR, `${safeDrive}_inventory_smoke.summary.json`);
    const staleSummary = {
        RunId: "smoke_run",
        DriveName: driveName,
        CsvPath: csvPath,
        Timestamp: "20260301_000000"
    };
    fs.writeFileSync(summaryPath, JSON.stringify(staleSummary, null, 2), 'utf8');

    // Manually set mtime to be old
    const oldTime = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago
    fs.utimesSync(summaryPath, oldTime, oldTime);

    try {
        execSync(`node scripts/cdms_batch_build_v1.js --source-drive "${driveName}" --mode MIGRATE`, { stdio: 'pipe' });
        throw new Error('Batch builder should have failed due to stale export!');
    } catch (err) {
        if (err.message.includes('No fresh inventory found')) {
            console.log('   PASS: Stale export correctly rejected.');
        } else {
            throw err;
        }
    }

    // 3. Test Fresh Export Processing
    console.log('3. Testing fresh export processing...');
    const now = new Date();
    fs.utimesSync(summaryPath, now, now); // Make it fresh

    const buildOut = execSync(`node scripts/cdms_batch_build_v1.js --source-drive "${driveName}" --mode MIGRATE --max-batch 1`).toString();

    if (!buildOut.includes('SUCCESS: Wrote 2 batches')) {
        throw new Error('Batch builder failed to create expected number of batches (max-batch 1).');
    }
    console.log('   PASS: Fresh export processed into batches.');

    // 4. Verify Routing Logic
    console.log('4. Verifying routing logic (Policies map)...');
    const batchFiles = fs.readdirSync(BATCH_DIR).filter(f => f.includes(safeDrive) && f.includes('_seq02'));
    if (batchFiles.length === 0) throw new Error('Sequence 02 batch not found.');

    const batchContent = fs.readFileSync(path.join(BATCH_DIR, batchFiles[0]), 'utf8');
    if (!batchContent.includes('Policies/Security_And_Access_Control')) {
        throw new Error('Routing map failed: security.pdf not routed to Policies folder.');
    }
    console.log('   PASS: Routing map applied correctly.');

    // 5. Test Corrupted Summary Logic (Regression)
    console.log('5. Testing corrupted summary resolution (Regression)...');
    const badSummaryPath = path.join(EXPORTS_DIR, `${safeDrive}_inventory_corrupt.summary.json`);
    fs.writeFileSync(badSummaryPath, '{ ', 'utf8'); // Truncated JSON

    // Ensure at least one good summary is still fresh
    fs.utimesSync(summaryPath, new Date(), new Date());

    const corruptOut = execSync(`node scripts/cdms_batch_build_v1.js --source-drive "${driveName}" --mode MIGRATE`, { stdio: 'pipe' }).toString();

    if (!corruptOut.includes('WARN_BAD_EXPORT_SUMMARY')) {
        throw new Error('Batch builder did not log warning for corrupted summary!');
    }
    if (!corruptOut.includes('SUCCESS: Wrote')) {
        throw new Error('Batch builder failed to continue after corrupted summary!');
    }
    console.log('   PASS: Corrupted summary skipped without crash.');

    // Cleanup bad file
    if (fs.existsSync(badSummaryPath)) fs.unlinkSync(badSummaryPath);

    // 6. Test Absolute Allowlist Matching (Regression)
    console.log('6. Testing absolute allowlist matching for local staging (Regression)...');
    const localTmp = path.join(ROOT, 'stack', 'cdms_tmp');
    const mockBatchName = 'Batch_Regression_Allowlist.csv';
    const mockBatchPath = path.join(BATCH_DIR, mockBatchName);
    const headers = 'BatchId,SourceDrive,CurrentPath,CurrentName,CurrentType,ProposedTSIPath,ProposedName,RenameReason,Confidence,Decision,CanonicalSecurityLocation';
    const row = `regression_test,,${localTmp},file.txt,File,stack/cdms_tmp/target,file_target.txt,Regression_Test,High,EXECUTE,Internal`;
    fs.writeFileSync(mockBatchPath, [headers, row].join('\n') + '\n', 'utf8');

    // Approve it (required by Gate 4)
    execSync(`node scripts/cdms_human_review.js --batch ${mockBatchName} --decision approve --reason "Regression testing allowlist match" --owner smoke-tester`);

    // Run dry-run execution
    const regExecOut = execSync(`node scripts/cdms_execute.js --batch ${mockBatchName} --owner smoke-tester`, {
        env: { ...process.env, CDMS_ALLOW_LOCAL_TMP: '1' }
    }).toString();

    if (regExecOut.includes('violate allowlistRoots')) {
        throw new Error('Gate 3 (Allowlist) failed for absolute staging path regression!');
    }
    console.log('   PASS: Absolute allowlist matching for local staging verified.');

    console.log('\n--- ALL CDMS BATCH BUILD SMOKE TESTS PASSED ---');
}

run().catch(err => {
    console.error(`\nSMOKE TEST FAILED: ${err.message}`);
    process.exit(1);
});
