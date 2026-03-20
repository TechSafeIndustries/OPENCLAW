'use strict';

/**
 * scripts/cdms_batch_build_v1.js
 * 
 * Deterministic CDMS project-level batch builder (Mode 1 / High-Control).
 * Generates migration and cleanup batches from FRESH inventory exports.
 * 
 * Rules:
 * - Freshness: Refuses to run if latest export summary is > 15m old.
 * - Source of Truth: Consumes DriveExport_*.csv files.
 * - Deterministic Routing: Uses stack/mappings/doccontrol_route_map_v1.json.
 * - Governance: Logs to stack/cdms_receipts and SQLite ledger.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = process.cwd();
const EXPORTS_DIR = path.join(ROOT, 'stack', 'drive_exports');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const RECEIPT_DIR = path.join(ROOT, 'stack', 'cdms_receipts');
const POLICY_PATH = path.join(ROOT, 'policy', 'cdms_write_rule_v1.json');
const MAP_PATH = path.join(ROOT, 'stack', 'mappings', 'doccontrol_route_map_v1.json');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');

// Schema for result columns
const BATCH_HEADERS = [
    'BatchId',
    'SourceDrive',
    'CurrentPath',
    'CurrentName',
    'CurrentType',
    'ProposedTSI01Path',
    'ProposedName',
    'RenameReason',
    'Confidence',
    'Decision',
    'CanonicalSecurityLocation'
];

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19); }

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

function escCsv(v) {
    const s = v == null ? '' : String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const mode = (args.mode || 'MIGRATE').toUpperCase();
    const sourceDrive = args['source-drive'] || '1. Corporate';
    const targetDrive = args['target-root'] || 'TSI-01 DocControl.GOOGLE';
    const owner = args.owner || 'cos';
    const maxBatchSize = parseInt(args['max-batch'], 10) || 10;
    const freshMinutes = parseInt(args['fresh-minutes'], 10) || 15;
    const sessionId = args.session || 'cdms_batch_build_' + uuid();

    console.log(`\n=== CDMS Batch Builder — Mode: ${mode} ===`);
    console.log(`Source Drive   : ${sourceDrive}`);
    console.log(`Target Drive   : ${targetDrive}`);
    // ── Pre-Check & Validate Policy JSON ──────────────────────────────────
    let policy;
    try {
        const policyText = fs.readFileSync(POLICY_PATH, 'utf8');
        policy = JSON.parse(policyText);
    } catch (err) {
        console.error(`BAD_JSON ${POLICY_PATH} ${err.message}`);
        process.exit(2);
    }

    if (!fs.existsSync('G:\\Shared drives')) {
        console.error('FATAL: DriveFS (G:\\Shared drives) not found. Mounting required.');
        process.exit(1);
    }

    // ── Find Fresh Export ──────────────────────────────────────────────────
    const latestExport = findLatestExport(sourceDrive, freshMinutes);
    if (!latestExport) {
        console.error(`FATAL: No fresh inventory found for drive "${sourceDrive}" (within last ${freshMinutes}m).`);
        console.error(`Run export first: npm run drive:export -- --drive "${sourceDrive}"`);
        process.exit(1);
    }
    console.log(`Using Export   : ${latestExport.CsvPath} (${latestExport.AgeMinutes}m old)`);

    // ── Load Mapping Table ──────────────────────────────────────────────────
    let mappingTable;
    try {
        mappingTable = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    } catch (err) {
        console.error('FATAL: Cannot load mapping table:', err.message);
        process.exit(1);
    }


    // ── Parse Export ────────────────────────────────────────────────────────
    console.log('Parsing inventory CSV...');
    const inventory = parseCsv(fs.readFileSync(latestExport.CsvPath, 'utf8'));
    if (inventory.rows.length === 0) {
        console.error('FATAL: Export inventory is empty.');
        process.exitCode = 1; return;
    }
    console.log(`Found ${inventory.rows.length} rows.`);

    // ── Batch Building ──────────────────────────────────────────────────────
    const batchData = [];
    const buildTs = nowStamp();
    const batchRefBase = `Batch_${mode}_${sourceDrive.replace(/[^a-zA-Z0-9]/g, '_')}_${buildTs}`;

    const warnings = [];
    inventory.rows.forEach((row, i) => {
        const isDir = row.IsDirectory === 'true';

        const relPath = row.RelPath || '';
        const fileName = row.FileName || '';
        const fullRel = path.join(relPath, fileName);

        // Deterministic Routing
        let targetRel = mappingTable.default.targetPath;
        let security = mappingTable.default.security || 'Internal';
        let hitl = false;

        const matchedMap = mappingTable.mappings
            .filter(m => new RegExp(m.pattern.replace(/\\/g, '\\\\'), 'i').test(fullRel))
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];

        if (matchedMap) {
            targetRel = matchedMap.targetPath;
            if (matchedMap.security) security = matchedMap.security;
            if (matchedMap.hitlRequired) hitl = true;
        } else {
            // Default 99_INBOX routing includes source drive name for unclassified
            targetRel = path.join(targetRel, sourceDrive);
        }

        const proposedName = fileName; // No rename for now
        const proposedTSIPath = path.join(targetDrive, targetRel);

        // Validation PRE-CHECK
        let decision = 'EXECUTE';
        let skipReason = '';
        const srcAbs = path.join(row.RootAbsPath, relPath, fileName);

        if (isDir) {
            decision = 'SKIP_PRECHECK';
            skipReason = 'Source is a directory';
        } else if (!fs.existsSync(srcAbs)) {
            decision = 'SKIP_PRECHECK';
            skipReason = 'Source missing during build';
        }

        batchData.push({
            BatchId: '', // To be filled per sequence
            SourceDrive: sourceDrive,
            CurrentPath: row.RootAbsPath,
            CurrentName: fullRel,
            CurrentType: isDir ? 'dir' : 'File',
            ProposedTSI01Path: proposedTSIPath,
            ProposedName: proposedName,
            RenameReason: mode === 'CLEANUP' ? 'Cleanup: Normalization' : `Migrate: ${sourceDrive} to DocControl`,
            Confidence: 'High',
            Decision: decision,
            CanonicalSecurityLocation: security,
            _meta: { hitl }
        });
    });

    if (batchData.length === 0) {
        console.warn('No eligible files found to batch.');
        process.exit(0);
    }

    // ── Split and Write Batches ─────────────────────────────────────────────
    if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

    const writtenBatches = [];
    for (let i = 0; i < batchData.length; i += maxBatchSize) {
        const seq = Math.floor(i / maxBatchSize) + 1;
        const seqStr = seq.toString().padStart(2, '0');
        const batchId = `${batchRefBase}_seq${seqStr}`;
        const batchFilename = `${batchId}.csv`;
        const outPath = path.join(BATCH_DIR, batchFilename);

        const currentBatch = batchData.slice(i, i + maxBatchSize);
        const csvLines = [
            BATCH_HEADERS.join(','),
            ...currentBatch.map(r => {
                r.BatchId = batchId;
                return BATCH_HEADERS.map(h => escCsv(r[h])).join(',');
            })
        ];

        fs.writeFileSync(outPath, csvLines.join('\n') + '\n', 'utf8');
        writtenBatches.push({ id: batchId, file: batchFilename, path: outPath, rowCount: currentBatch.length });
    }

    console.log(`\nSUCCESS: Wrote ${writtenBatches.length} batches to ${BATCH_DIR}`);

    // ── Receipt & Ledger ────────────────────────────────────────────────────
    const receiptPath = path.join(RECEIPT_DIR, `Receipt_${buildTs}_BATCH_BUILD.json`);
    const runsheetPath = path.join(RECEIPT_DIR, `RunSheet_${buildTs}_status-BATCH_BUILD.csv`);

    const receipt = {
        timestamp: buildTs,
        run_mode: mode,
        export_used: latestExport.CsvPath,
        export_timestamp: latestExport.Timestamp,
        source_drive: sourceDrive,
        target_drive: targetDrive,
        total_rows_found: batchData.length,
        batch_count: writtenBatches.length,
        max_batch_size: maxBatchSize,
        batches: writtenBatches,
        policy_version: 'v1',
        allowlist_roots: policy.allowlistRoots || []
    };

    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');

    const runsheetLines = [
        'BatchId,SourceFile,TargetRelPath,Decision,Reason',
        ...batchData.map(r => `${r.BatchId},${escCsv(r.CurrentName)},${escCsv(r.ProposedTSI01Path)},${r.Decision},${r.Decision === 'SKIP_PRECHECK' ? 'Missing source' : ''}`)
    ];
    fs.writeFileSync(runsheetPath, runsheetLines.join('\n') + '\n', 'utf8');

    console.log(`Receipt written  : ${receiptPath}`);
    console.log(`Runsheet written : ${runsheetPath}`);

    // SQLite Ledger
    let db;
    try {
        db = new Database(DB_PATH);
        const now = nowIso();
        const actionId = uuid();

        db.transaction(() => {
            // Action log
            db.prepare(`
                INSERT OR IGNORE INTO actions (id, session_id, ts, actor, type, input_ref, status, reason, meta_json)
                VALUES (?, ?, ?, ?, 'cdms_batch_build', ?, 'ok', ?, ?)
            `).run(actionId, sessionId, now, owner, latestExport.RunId || 'manual',
                `Built ${writtenBatches.length} batches from export ${path.basename(latestExport.CsvPath)}`,
                JSON.stringify({
                    batches: writtenBatches.length,
                    rows: batchData.length,
                    exportFile: latestExport.CsvPath,
                    mode: mode
                }));

            // Artifacts log for each batch
            writtenBatches.forEach(b => {
                db.prepare(`
                    INSERT OR IGNORE INTO artifacts (id, session_id, run_id, type, name, path, content_ref, tags_json)
                    VALUES (?, ?, ?, 'cdms_batch_csv', ?, ?, NULL, '["cdms","batch"]')
                `).run(uuid(), sessionId, b.id, b.file, b.path, '[]');
            });
        })();
        console.log(`Ledger Updated   : ${writtenBatches.length + 1} rows inserted.`);
    } catch (err) {
        console.warn('WARN: Ledger update failed:', err.message);
    } finally {
        if (db) db.close();
    }

    console.log('\n=== BATCH BUILD COMPLETE ===');
    console.log(`Sample Execute: npm run workflow:cdms-execute -- --batch ${writtenBatches[0].id} --owner cos`);
}

function findLatestExport(driveName, freshMinutes) {
    if (!fs.existsSync(EXPORTS_DIR)) return null;
    const safeDrive = driveName.replace(/[^a-zA-Z0-9]/g, '_');
    const summaries = fs.readdirSync(EXPORTS_DIR)
        .filter(f => f.startsWith(safeDrive + '_inventory_') && f.endsWith('.summary.json'))
        .map(f => {
            const full = path.join(EXPORTS_DIR, f);
            try {
                let text = fs.readFileSync(full, 'utf8');
                // Strip UTF-8 BOM if present
                if (text.charCodeAt(0) === 0xFEFF) {
                    text = text.slice(1);
                }
                const data = JSON.parse(text);
                const stat = fs.statSync(full);
                data.AgeMinutes = (Date.now() - stat.mtimeMs) / 60000;
                data.$summaryPath = full;
                return data;
            } catch (err) {
                console.warn("WARN_BAD_EXPORT_SUMMARY", full, err.message);
                return null;
            }
        })
        .filter(Boolean)
        .filter(s => s.AgeMinutes <= freshMinutes)
        .sort((a, b) => a.AgeMinutes - b.AgeMinutes);

    return summaries[0] || null;
}

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

main();
