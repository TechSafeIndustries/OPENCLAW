'use strict';

/**
 * OpenClaw — CDMS Agent v1 (scan + plan only)
 * --------------------------------------------
 * action=scan  : snapshots the consolidated index into cdms_batches/.
 * action=plan  : reads MoveMap, filters Confidence=High, writes a batch CSV.
 *
 * No Drive writes. No DB. No router integration (yet).
 *
 * Usage (CLI):
 *   node agents/cdms_agent_v1.js --action scan
 *   node agents/cdms_agent_v1.js --action plan --wave high
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STACK_DIR = path.join(ROOT, 'stack');
const BATCH_DIR = path.join(STACK_DIR, 'cdms_batches');
const INDEX_PATH = path.join(STACK_DIR, 'DocControl_Audit_Index.csv');
const MAP_PATH = path.join(STACK_DIR, 'DocControl_Audit_MoveMap.csv');

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Parse a CSV string into an array of objects (handles double-quoted fields). */
function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = splitCsvLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
        rows.push(row);
    }
    return rows;
}

/** Split a single CSV line respecting double-quoted fields. */
function splitCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQ = !inQ; }
        } else if (ch === ',' && !inQ) {
            cols.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

/** Escape a value for CSV output. */
function escCsv(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/** Convert an array of objects to CSV text (includes header row). */
function toCsv(rows, headers) {
    if (rows.length === 0) return headers.join(',') + '\n';
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => escCsv(row[h])).join(','));
    }
    return lines.join('\n') + '\n';
}

// ── Action: scan ──────────────────────────────────────────────────────────────

function actionScan() {
    if (!fs.existsSync(INDEX_PATH)) {
        return {
            ok: false,
            action: 'scan',
            summary: `Index not found at ${INDEX_PATH}. Run: node scripts/_build_audit_index.ps1 first.`,
            artifacts: [],
        };
    }

    ensureDir(BATCH_DIR);

    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const rows = parseCsv(content);
    const snapPath = path.join(BATCH_DIR, `index_snapshot_${nowStamp()}.csv`);

    fs.copyFileSync(INDEX_PATH, snapPath);

    return {
        ok: true,
        action: 'scan',
        summary: `Index snapshot written. ${rows.length} rows captured.`,
        artifacts: [
            { type: 'index_snapshot', path: snapPath, row_count: rows.length },
        ],
        recommended_next_command: 'npm run workflow:cdms-plan -- --wave high',
    };
}

// ── Action: plan ──────────────────────────────────────────────────────────────

function actionPlan(wave) {
    const waveArg = (wave || 'high').toLowerCase();

    if (!fs.existsSync(MAP_PATH)) {
        return {
            ok: false,
            action: 'plan',
            summary: `MoveMap not found at ${MAP_PATH}. Run: node scripts/_build_audit_movemap.ps1 first.`,
            artifacts: [],
        };
    }

    ensureDir(BATCH_DIR);

    // Confidence filter map
    const confidenceFilter = {
        'high': (r) => r.Confidence === 'High',
        'med': (r) => r.Confidence === 'Med',
        'low': (r) => r.Confidence === 'Low',
        'all': () => true,
    };
    const filterFn = confidenceFilter[waveArg];
    if (!filterFn) {
        return {
            ok: false,
            action: 'plan',
            summary: `Unknown wave "${waveArg}". Use: high | med | low | all`,
            artifacts: [],
        };
    }

    const content = fs.readFileSync(MAP_PATH, 'utf8');
    const allRows = parseCsv(content);
    const batch = allRows.filter(filterFn);

    if (batch.length === 0) {
        return {
            ok: true,
            action: 'plan',
            summary: `No rows with Confidence=${waveArg} found in MoveMap. Batch not written.`,
            artifacts: [],
            recommended_next_command: null,
        };
    }

    const ts = nowStamp();
    const batchId = `${waveArg}_${ts}`;
    const batchPath = path.join(BATCH_DIR, `MoveBatch_${waveArg}_${ts}.csv`);

    // Output columns: add BatchId for traceability
    const HEADERS = [
        'BatchId', 'SourceDrive', 'CurrentPath', 'CurrentName', 'CurrentType',
        'ProposedTSI01Path', 'ProposedName', 'RenameReason', 'Confidence',
    ];
    const outputRows = batch.map(r => ({ BatchId: batchId, ...r }));
    fs.writeFileSync(batchPath, toCsv(outputRows, HEADERS), 'utf8');

    return {
        ok: true,
        action: 'plan',
        wave: waveArg,
        batch_id: batchId,
        summary: `Batch planned. Wave=${waveArg}, rows=${batch.length}, batch_id=${batchId}`,
        artifacts: [
            { type: 'move_batch', path: batchPath, row_count: batch.length },
        ],
        recommended_next_command:
            `npm run workflow:cdms-human-review -- ${batchId} --decision approve --reason "..." --owner cos`,
    };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

function run({ action, wave }) {
    switch ((action || '').toLowerCase()) {
        case 'scan': return actionScan();
        case 'plan': return actionPlan(wave);
        default:
            return {
                ok: false,
                summary: `Unknown action "${action}". Supported: scan | plan`,
                artifacts: [],
            };
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { run };

// ── CLI entrypoint ─────────────────────────────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);
    const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'CDMS Agent v1 — Scan + Plan',
            '',
            'Usage:',
            '  node agents/cdms_agent_v1.js --action <scan|plan> [--wave <high|med|low|all>]',
            '',
            'Actions:',
            '  scan   Snapshot the consolidated index into stack/cdms_batches/',
            '  plan   Filter MoveMap by --wave and write a batch CSV',
            '',
            'npm aliases:',
            '  npm run workflow:cdms-scan',
            '  npm run workflow:cdms-plan-high',
            '  npm run workflow:cdms-plan-med',
            '  npm run workflow:cdms-plan-low',
        ].join('\n'));
        process.exit(0);
    }

    const action = get('--action');
    const wave = get('--wave') || 'high';

    if (!action) {
        console.error('Usage: node agents/cdms_agent_v1.js --action <scan|plan> [--wave <high|med|low|all>]');
        process.exit(1);
    }

    const result = run({ action, wave });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
}
