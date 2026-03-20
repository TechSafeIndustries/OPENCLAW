'use strict';

/**
 * OpenClaw — Scout Agent v1 (Media Discovery)
 * --------------------------------------------
 * Scans the DocControl Audit Index for high-value media assets.
 * 
 * Objectives:
 * 1. Filter files > 1MB with media extensions (.mp4, .mov, .m4a, .png, .pdf).
 * 2. Pair media with narrative documents (.gdoc, .pdf) in the same folder.
 * 3. Log findings as identified assets with platform suitability scores.
 * 4. Maintain provenance by linking to migration batches.
 *
 * Usage:
 *   node agents/scout_agent_v1.js --action scan --batch low_2026-03-03_06-29-04
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const STACK_DIR = path.join(ROOT, 'stack');
const INDEX_PATH = path.join(STACK_DIR, 'DocControl_Audit_Index.csv');
const SCOUT_OUTPUT_DIR = path.join(STACK_DIR, 'scout_findings');

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = splitCsvLine(line);
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
        rows.push(row);
    }
    return rows;
}

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

// ── Discovery Logic ──────────────────────────────────────────────────────────

const MEDIA_EXTENSIONS = ['.mp4', '.mov', '.m4a', '.png', '.pdf'];
const DOC_EXTENSIONS = ['.gdoc', '.docx', '.pdf', '.gsheet'];
const SIZE_THRESHOLD = 1000000; // 1MB

function scoreAsset(row) {
    const name = (row.Name || row.FullName || '').toLowerCase();
    const ext = (row.Extension || '').toLowerCase();
    const size = parseInt(row.Length || '0', 10);

    let tiktok = 0;
    let linkedin = 0;
    let youtube = 0;

    if (ext === '.mp4' || ext === '.mov') {
        tiktok = 80;
        youtube = 90;
        linkedin = 70;
        if (name.includes('engine') || name.includes('demo')) youtube += 10;
    } else if (ext === '.m4a') {
        tiktok = 60; // For voiceovers
        linkedin = 40;
    } else if (ext === '.png' || ext === '.jpg') {
        linkedin = 80;
        tiktok = 20;
    }

    if (size > 10000000) youtube += 5; // Preference for larger high-res vids on YT

    return { tiktok, linkedin, youtube };
}

function actionScan(batchRef = 'ALL') {
    if (!fs.existsSync(INDEX_PATH)) {
        return { ok: false, summary: 'Audit index missing' };
    }

    ensureDir(SCOUT_OUTPUT_DIR);

    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const allRows = parseCsv(content);

    // Group all rows by parent directory for pairing
    const folderMap = {};
    allRows.forEach(r => {
        const fullPath = r.FullName || '';
        const dir = path.dirname(fullPath);
        if (!folderMap[dir]) folderMap[dir] = { media: [], docs: [], all: [] };
        folderMap[dir].all.push(r);

        const ext = (r.Extension || '').toLowerCase();
        const size = parseInt(r.Length || '0', 10);

        if (MEDIA_EXTENSIONS.includes(ext) && size >= SIZE_THRESHOLD) {
            folderMap[dir].media.push(r);
        } else if (DOC_EXTENSIONS.includes(ext)) {
            folderMap[dir].docs.push(r);
        }
    });

    const identified = [];

    // Prioritize SAI-COM folder if requested or just find everything
    Object.keys(folderMap).forEach(dir => {
        const { media, docs } = folderMap[dir];
        if (media.length === 0) return;

        media.forEach(m => {
            const scores = scoreAsset(m);
            identified.push({
                asset_name: m.Name,
                path: m.FullName,
                extension: m.Extension,
                size: m.Length,
                scores,
                contextual_narrative_options: docs.map(d => d.Name),
                provenance_batch: batchRef,
                location_tag: dir.includes('SAI-COM') ? 'SAI-COM-INTELLIGENCE' : 'GENERAL-DISCOVERY'
            });
        });
    });

    const outPath = path.join(SCOUT_OUTPUT_DIR, `ScoutFindings_${nowStamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        scanned_at: new Date().toISOString(),
        batch_ref: batchRef,
        count: identified.length,
        assets: identified
    }, null, 2));

    return {
        ok: true,
        action: 'scan',
        summary: `Scored and identified ${identified.length} high-value assets.`,
        artifacts: [
            { type: 'scout_findings', path: outPath, count: identified.length }
        ],
        priority_targets: identified.filter(a => a.location_tag === 'SAI-COM-INTELLIGENCE').slice(0, 5)
    };
}

// ── CLI ──

if (require.main === module) {
    const args = process.argv.slice(2);
    const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'scan';
    const batch = args.includes('--batch') ? args[args.indexOf('--batch') + 1] : 'ALL';

    const result = actionScan(batch);
    console.log(JSON.stringify(result, null, 2));
}
