'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RECEIPT_DIR = path.join(ROOT, 'stack', 'cdms_receipts');

function aggregateMetrics() {
    if (!fs.existsSync(RECEIPT_DIR)) {
        console.error('Receipt directory not found');
        process.exit(1);
    }

    const files = fs.readdirSync(RECEIPT_DIR).filter(f => f.startsWith('Receipt_') && f.endsWith('_EXECUTE.json'));

    const stats = {
        high: { total: 0, ok: 0, skipped: 0, fail: 0 },
        med: { total: 0, ok: 0, skipped: 0, fail: 0 },
        low: { total: 0, ok: 0, skipped: 0, fail: 0 },
        total_ok: 0,
        total_files_processed: 0
    };

    files.forEach(file => {
        const content = JSON.parse(fs.readFileSync(path.join(RECEIPT_DIR, file), 'utf8'));
        const batch = (content.batch || '').toLowerCase();

        let target = null;
        if (batch.includes('_high_')) target = stats.high;
        else if (batch.includes('_med_')) target = stats.med;
        else if (batch.includes('_low_')) target = stats.low;

        if (target) {
            (content.results || []).forEach(r => {
                target.total++;
                stats.total_files_processed++;
                if (r.status === 'OK') {
                    target.ok++;
                    stats.total_ok++;
                } else if (r.status.startsWith('SKIPPED')) {
                    target.skipped++;
                } else {
                    target.fail++;
                }
            });
        }
    });

    console.log('=== Portfolio Migration Success Metrics ===');
    console.log(`High-Confidence Wave : ${stats.high.ok} OK / ${stats.high.total} Total`);
    console.log(`Medium-Confidence Wave: ${stats.med.ok} OK / ${stats.med.total} Total`);
    console.log(`Low-Confidence Wave   : ${stats.low.ok} OK / ${stats.low.total} Total`);
    console.log('-----------------------------------------');
    console.log(`Total Verified Moves  : ${stats.total_ok}`);
    console.log(`Total Assets Handled  : ${stats.total_files_processed}`);
    console.log('=========================================');
}

aggregateMetrics();
