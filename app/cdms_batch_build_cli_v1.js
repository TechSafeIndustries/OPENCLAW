/**
 * app/cdms_batch_build_cli_v1.js
 * 
 * CLI Wrapper for CDMS Batch Builder.
 */

const { buildBatch, saveBatches } = require('./cdms_batch_build_v1');
const path = require('path');

async function main() {
    const args = process.argv.slice(2);
    const options = {
        mode: 'MIGRATE',
        sourceDrive: '1. Corporate',
        targetDrive: 'TSI-01 DocControl.GOOGLE',
        maxBatchSize: 10
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode') {
            options.mode = args[++i].toUpperCase();
        } else if (args[i] === '--source-drive') {
            options.sourceDrive = args[++i];
        } else if (args[i] === '--target-drive') {
            options.targetDrive = args[++i];
        } else if (args[i] === '--max-batch-size') {
            options.maxBatchSize = parseInt(args[++i], 10);
        }
    }

    try {
        console.log(`=== CDMS Batch Builder ===`);
        console.log(`Mode        : ${options.mode}`);
        if (options.mode === 'MIGRATE') {
            console.log(`Source      : ${options.sourceDrive}`);
        }
        console.log(`Target      : ${options.targetDrive}`);
        console.log(`Limit       : ${options.maxBatchSize}`);
        console.log(`--------------------------`);

        const { batchId, batches } = buildBatch(options);

        if (batches.length === 0) {
            console.warn('No eligible files found to batch.');
            process.exit(0);
        }

        const savedPaths = saveBatches(batchId, batches, options.mode);

        console.log(`SUCCESS: Created ${batches.length} batch(es).`);
        savedPaths.forEach(p => console.log(`  - ${path.basename(p)}`));

        console.log(`\nRecommended next command:`);
        console.log(`npm run workflow:cdms-execute -- --batch ${path.basename(savedPaths[0], '.csv')} --dry-run --owner cos`);
    } catch (err) {
        console.error(`FATAL ERROR: ${err.message}`);
        process.exit(1);
    }
}

main();
