/**
 * scripts/workflow_cdms_migrate_execute.js
 * 
 * Executes the latest approved CDMS migration batch.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

function fail(msg) {
    console.error(`\nFAIL: ${msg}`);
    process.exit(1);
}

const args = process.argv.slice(2);
const options = {
    batch: null,
    owner: 'cos'
};

for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
        const key = args[i].slice(2);
        options[key] = args[++i];
    }
}

if (!options.owner) fail('--owner is required');

async function main() {
    let batchToExecute = options.batch;

    if (!batchToExecute) {
        console.log('Finding latest approved batch in ledger...');
        if (!fs.existsSync(DB_PATH)) fail('Ledger database not found.');

        const db = new Database(DB_PATH);
        const latestApproved = db.prepare(`
            SELECT subject_ref FROM decisions 
            WHERE subject_type = 'batch' 
              AND decision = 'approve'
            ORDER BY ts DESC LIMIT 1
        `).get();

        if (!latestApproved) {
            fail('No approved batches found in the ledger. Run "workflow:cdms-migrate-prep" first.');
        }
        batchToExecute = latestApproved.subject_ref;
        console.log(`Found latest approved: ${batchToExecute}`);
    }

    console.log(`\n=== CDMS Migrate Execute ===`);
    console.log(`Batch: ${batchToExecute}`);
    console.log(`Owner: ${options.owner}`);

    try {
        const execCmd = `node scripts/cdms_execute.js --batch "${batchToExecute}" --execute --owner ${options.owner}`;
        console.log(`Running: ${execCmd}`);
        execSync(execCmd, { stdio: 'inherit' });
    } catch (err) {
        fail('Batch execution failed.');
    }

    console.log('\nEXECUTION COMPLETE.');
    console.log('Check stack/cdms_receipts/ for full results.');
}

main().catch(err => fail(err.message));
