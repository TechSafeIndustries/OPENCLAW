'use strict';

/**
 * scripts/cdms_batch_diagnose.js
 * 
 * Internal diagnostic tool for CDMS batches.
 * Validates existence, path length, and allowlist for rows.
 * No PowerShell dependency.
 */

const fs = require('fs');
const path = require('path');
const { resolveDestAbs } = require('../app/resolve_dest_path_v1');

const ROOT = process.cwd();
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const POLICY_PATH = path.join(ROOT, 'policy', 'cdms_write_rule_v1.json');

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
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(l => {
        const cols = splitCsvLine(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
        return obj;
    });
    return { headers, rows };
}

function normKey(k) {
    if (k == null) return '';
    return String(k).replace(/^\ufeff/, '').trim().toLowerCase();
}

function getField(row, name) {
    if (!row) return '';
    const n = normKey(name);
    const keys = Object.keys(row);
    const map = {};
    keys.forEach(k => { map[normKey(k)] = k; });
    const actualKey = map[n];
    let val = actualKey ? row[actualKey] : '';
    if (val == null) return '';
    val = String(val).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).trim();
    return val;
}

function resolveDiagnosticPaths(row, index, allowRoots) {
    const g = (k) => getField(row, k);
    const cPath = g('CurrentPath');
    const cName = g('CurrentName');
    const pTSI = g('ProposedTSIPath') || g('ProposedTSI01Path');
    const pName = g('ProposedName');
    const sDrive = g('SourceDrive');

    if (cName && pName && cPath && pTSI) {
        let base = sDrive;
        if (base === 'CurrentPath') base = ROOT;
        if (!base) {
            const normPath = cPath.replace(/\\/g, '/').toLowerCase();
            for (const root of allowRoots) {
                if (normPath.startsWith(root.toLowerCase().replace(/\\/g, '/'))) {
                    base = root;
                    break;
                }
            }
        }
        if (!base) base = ROOT; // Fallback

        return {
            srcAbs: path.join(cPath, cName),
            dstAbs: resolveDestAbs(base, pTSI, pName)
        };
    }
    return { srcAbs: cPath, dstAbs: pTSI };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.batch) {
        console.error('Usage: node scripts/cdms_batch_diagnose.js --batch <filename>');
        process.exit(1);
    }

    const batchFile = args.batch.endsWith('.csv') ? args.batch : args.batch + '.csv';
    const batchPath = path.isAbsolute(batchFile) ? batchFile : path.join(BATCH_DIR, batchFile);

    if (!fs.existsSync(batchPath)) {
        console.error(`Batch not found: ${batchPath}`);
        process.exit(1);
    }

    let policy;
    try {
        policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    } catch (e) {
        policy = { allowlistRoots: [] };
    }
    const allowRoots = policy.allowlistRoots || [];

    const { rows } = parseCsv(fs.readFileSync(batchPath, 'utf8'));
    const results = [];

    rows.forEach((row, i) => {
        const { srcAbs, dstAbs } = resolveDiagnosticPaths(row, i + 1, allowRoots);
        let classification = 'POTENTIAL_EXECUTE';
        let details = '';

        if (!fs.existsSync(srcAbs)) {
            classification = 'SKIPPED_MISSING_SOURCE';
        } else if (fs.lstatSync(srcAbs).isDirectory()) {
            classification = 'SKIPPED_SOURCE_IS_DIRECTORY';
        } else if (fs.existsSync(dstAbs)) {
            classification = 'FAIL_DESTINATION_EXISTS';
        }

        const isAllowlisted = allowRoots.some(root =>
            srcAbs.toLowerCase().startsWith(root.toLowerCase().replace(/[\\/]$/, '')) &&
            dstAbs.toLowerCase().startsWith(root.toLowerCase().replace(/[\\/]$/, ''))
        );

        if (!isAllowlisted) {
            classification = 'FAIL_ALLOWLIST_VIOLATION';
        }

        results.push({
            rowIndex: i + 1,
            classification,
            srcAbs,
            dstAbs,
            currentRow: row
        });
    });

    const problematic = results
        .filter(r => r.classification !== 'POTENTIAL_EXECUTE')
        .slice(0, 20);

    const output = {
        batch: path.basename(batchPath),
        totalRows: rows.length,
        summary: results.reduce((acc, r) => {
            acc[r.classification] = (acc[r.classification] || 0) + 1;
            return acc;
        }, {}),
        problematicRows: problematic
    };

    console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
