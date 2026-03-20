'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

console.log('=== CDMS Bugfix Smoke Tests ===\n');

function run(cmd) {
    console.log(`> ${cmd}`);
    try {
        const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString();
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: e.stdout?.toString() || '', err: e.stderr?.toString() || e.message };
    }
}

// 1. Test execute with --batch (boolean) in DRYRUN
// Should auto-pick latest batch
console.log('Test 1: cdms_execute.js --batch (missing value, dryrun)');
const res1 = run('node scripts/cdms_execute.js --batch --owner cos --dryrun');
if (res1.ok && res1.out.includes('Auto-selected latest batch')) {
    console.log('PASS: Successfully auto-selected latest batch.\n');
} else {
    console.log('FAIL: Did not auto-select latest batch or failed.');
    console.log(res1.out);
    console.log(res1.err);
}

// 2. Test execute with --batch (missing value, NOT dryrun)
// Should hard fail
console.log('Test 2: cdms_execute.js --batch (missing value, execute)');
const res2 = run('node scripts/cdms_execute.js --batch --owner cos --execute');
if (!res2.ok && res2.err.includes('Batch path missing. Use --batch <fullpath-or-filename.csv>')) {
    console.log('PASS: Correctly failed with missing batch error.\n');
} else {
    console.log('FAIL: Did not fail correctly.');
    console.log(res2.out);
    console.log(res2.err);
}

// 3. Test human-review with --batch (boolean, dryrun)
console.log('Test 3: cdms_human_review.js --batch (missing value, dryrun)');
const res3 = run('node scripts/cdms_human_review.js --batch --decision approve --reason smoke --owner cos --dryrun');
if (res3.ok && res3.out.includes('Auto-selected latest batch')) {
    console.log('PASS: Successfully auto-selected latest batch.\n');
} else {
    console.log('FAIL: Did not auto-select latest batch or failed.');
}

// 4. Test resolution of partial filename
console.log('Test 4: Partial filename resolution');
// Find a real batch file to use as target
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const batchFiles = fs.readdirSync(BATCH_DIR).filter(f => f.endsWith('.csv'));
if (batchFiles.length > 0) {
    const target = batchFiles[0];
    const partial = path.basename(target, '.csv');
    console.log(`Testing with partial: ${partial}`);
    const res4 = run(`node scripts/cdms_execute.js --batch ${partial} --owner cos --dryrun`);
    if (res4.out.includes(`PASS  (${partial})`) || res4.out.includes(`PASS  (${path.basename(target, '.csv')})`)) {
        console.log('PASS: Partial filename resolved correctly.\n');
    } else {
        console.log('FAIL: Partial filename resolution failed.');
        console.log(res4.out);
    }
} else {
    console.log('SKIP: No batch files available for Test 4.\n');
}

console.log('=== Bugfix Smoke Tests Complete ===');
