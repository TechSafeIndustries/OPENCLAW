/**
 * scripts/workflow_cdms_migrate_prep.js
 * 
 * Automates the preparation phase of the CDMS migration pipeline.
 * Steps:
 * 1. Check DriveFS mount.
 * 2. Verify ledger.
 * 3. Export all drives.
 * 4. Build migration batch.
 * 5. Run dry-run execution.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function fail(msg) {
    console.error(`\nFAIL: ${msg}`);
    process.exit(1);
}

const args = process.argv.slice(2);
const options = {
    mode: 'MIGRATE',
    'source-drive': '1. Corporate',
    'target-drive': 'TSI-01 DocControl.GOOGLE',
    owner: 'cos'
};

for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
        const key = args[i].slice(2);
        options[key] = args[++i];
    }
}

if (!options.owner) fail('--owner is required');
if (options.mode === 'MIGRATE' && !options['source-drive']) fail('--source-drive is required for MIGRATE mode');
if (!options['target-drive']) fail('--target-drive is required');

async function main() {
    console.log(`=== CDMS Migrate Prep — ${options.mode} ===`);
    console.log(`Owner: ${options.owner}`);
    console.log(`Target: ${options['target-drive']}`);
    if (options.mode === 'MIGRATE') console.log(`Source: ${options['source-drive']}`);

    // 1. Check DriveFS mount
    console.log('\n[1/5] Checking G:\\Shared drives mount...');
    try {
        execSync('powershell -Command "if (-not (Test-Path \'G:\\Shared drives\')) { exit 1 }"');
        console.log('      OK: G:\\Shared drives found.');
    } catch (err) {
        fail('DriveFS (G:\\Shared drives) is NOT mounted. Please mount and try again.');
    }

    // 2. Verify Ledger
    console.log('\n[2/5] Verifying Ledger...');
    try {
        execSync('npm run verify:ledger', { stdio: 'inherit' });
    } catch (err) {
        fail('Ledger verification failed.');
    }

    // 3. Export all drives
    console.log('\n[3/5] Exporting all drives...');
    try {
        execSync('npm run drive:export-all', { stdio: 'inherit' });
    } catch (err) {
        fail('Drive export failed.');
    }

    // 4. Build Batch
    console.log('\n[4/5] Building Batch...');
    let buildOut;
    try {
        const buildCmd = `node app/cdms_batch_build_cli_v1.js --mode ${options.mode} --source-drive "${options['source-drive']}" --target-drive "${options['target-drive']}" --max-batch-size 10`;
        console.log(`      Running: ${buildCmd}`);
        buildOut = execSync(buildCmd).toString();
        console.log(buildOut);
    } catch (err) {
        fail('Batch build failed.');
    }

    // Detect newest batch files
    const batchLines = buildOut.split('\n').filter(l => l.includes('  - '));
    if (batchLines.length === 0) fail('No batch files were produced.');

    const batchFiles = batchLines.map(l => l.replace('  - ', '').trim());
    console.log(`      Detected ${batchFiles.length} batch(es).`);

    // 5. Dry-Run Execution
    console.log('\n[5/5] Running Dry-Run for all batches...');
    for (const f of batchFiles) {
        try {
            const dryCmd = `node scripts/cdms_execute.js --batch "${f}" --dry-run --owner ${options.owner}`;
            console.log(`      Running: ${dryCmd}`);
            execSync(dryCmd, { stdio: 'inherit' });
        } catch (err) {
            fail(`Dry-run execution failed for ${f}.`);
        }
    }

    // Conclusion
    console.log('\n' + '='.repeat(60));
    console.log('PREPARATION COMPLETE');
    console.log('='.repeat(60));
    console.log('\nTo proceed, a human must approve the batch(es):');
    batchFiles.forEach(f => {
        const batchRef = f.replace('.csv', '');
        console.log(`\nnpm run workflow:cdms-human-review -- --batch ${batchRef} --decision approve --reason "Bulk migration via prep workflow" --owner ${options.owner}`);
    });

    console.log('\nThen, execute the latest approved batch:');
    console.log(`npm run workflow:cdms-migrate-execute -- --owner ${options.owner}`);
    console.log('\nLogs and runsheets can be found in: stack/cdms_receipts/');
}

main().catch(err => fail(err.message));
