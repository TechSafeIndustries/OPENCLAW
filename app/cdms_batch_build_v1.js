/**
 * app/cdms_batch_build_v1.js
 * 
 * Builds CDMS migration or cleanup batches from Drive inventory exports.
 * Freshness rule: Must consume latest exports with the same RunId.
 */

const fs = require('fs');
const path = require('path');
const { normalisePath, normaliseSegment } = require('../utils/path_normaliser');

// Standard CDMS Batch Schema (from repo inspection)
const BATCH_HEADERS = [
    'BatchId',
    'SourceDrive',
    'CurrentPath',
    'CurrentName',
    'CurrentType',
    'ProposedTSI01Path',
    'ProposedName',
    'RenameReason',
    'Confidence'
];

function parseInventory(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return null;

    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(l => {
        const cols = splitCsvLine(l);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
        return obj;
    });
    return { headers, rows };
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

function findLatestRunIdSet(exportsDir, requiredDrives) {
    if (!fs.existsSync(exportsDir)) return null;
    const files = fs.readdirSync(exportsDir).filter(f => f.endsWith('.summary.json'));

    // Group by RunId
    const runGroups = {};
    files.forEach(f => {
        const summary = JSON.parse(fs.readFileSync(path.join(exportsDir, f), 'utf8'));
        const rid = summary.RunId;
        if (!runGroups[rid]) runGroups[rid] = {};
        runGroups[rid][summary.DriveName] = summary.CsvPath;
    });

    // Find latest RunId that has all required drives
    const runIds = Object.keys(runGroups).sort().reverse();
    for (const rid of runIds) {
        const group = runGroups[rid];
        const missing = requiredDrives.filter(d => !group[d]);
        if (missing.length === 0) {
            return { runId: rid, drives: group };
        }
    }
    return null;
}

function buildBatch({
    mode = 'MIGRATE',
    sourceDrive = '1. Corporate',
    targetDrive = 'TSI-01 DocControl.GOOGLE',
    maxBatchSize = 10
}) {
    const exportsDir = path.join(process.cwd(), 'stack', 'drive_exports');
    const requiredDrives = mode === 'MIGRATE' ? [sourceDrive, targetDrive] : [targetDrive];

    const runSet = findLatestRunIdSet(exportsDir, requiredDrives);
    if (!runSet) {
        throw new Error(`Could not find a complete RunId set for drives: ${requiredDrives.join(', ')}`);
    }

    console.log(`Using RunId: ${runSet.runId}`);

    const sourceInv = mode === 'MIGRATE' ? parseInventory(runSet.drives[sourceDrive]) : null;
    const targetInv = parseInventory(runSet.drives[targetDrive]);

    const batchData = [];
    const batchId = `${mode.toLowerCase()}_${new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 19)}`;

    if (mode === 'MIGRATE') {
        // Simple Migration logic
        sourceInv.rows.forEach(row => {
            if (row.IsDirectory === 'true') return;

            const currentName = row.FileName;
            const currentPath = row.CurrentPath || ''; // Wait, columns in export are FileName, RelPath, RootAbsPath
            // Actually export script uses: 
            // Header: RunId,DriveName,RootAbsPath,RelPath,FileName,Extension,SizeBytes,LastWriteTimeIso,IsDirectory,DocId,Url

            const rootAbs = row.RootAbsPath;
            const relPath = row.RelPath;
            const fileName = row.FileName;

            // Normalise paths
            const proposedName = normaliseSegment(fileName);
            // Target: TSI-01 DocControl.GOOGLE\MIGRATED\<OriginalDriveName>\<RelPath>
            const driveFolderName = sourceDrive.replace(/[\\/]/g, '_');
            const proposedRel = normalisePath(path.join('MIGRATED', driveFolderName, relPath), '\\');
            const proposedTSI01Path = path.join(targetDrive, proposedRel, ''); // Ensuring trailing slash if needed

            batchData.push({
                BatchId: batchId,
                SourceDrive: sourceDrive,
                CurrentPath: path.join(rootAbs, relPath),
                CurrentName: fileName,
                CurrentType: 'File',
                ProposedTSI01Path: proposedTSI01Path,
                ProposedName: proposedName,
                RenameReason: `Migrated from ${sourceDrive}`,
                Confidence: 'High'
            });
        });
    } else if (mode === 'CLEANUP') {
        targetInv.rows.forEach(row => {
            const fileName = row.FileName;
            const normalisedName = normaliseSegment(fileName);

            if (fileName !== normalisedName) {
                const rootAbs = row.RootAbsPath;
                const relPath = row.RelPath;

                batchData.push({
                    BatchId: batchId,
                    SourceDrive: targetDrive,
                    CurrentPath: path.join(rootAbs, relPath),
                    CurrentName: fileName,
                    CurrentType: row.IsDirectory === 'true' ? 'Folder' : 'File',
                    ProposedTSI01Path: path.join(targetDrive, relPath, ''),
                    ProposedName: normalisedName,
                    RenameReason: 'Normalisation cleanup',
                    Confidence: 'High'
                });
            }
        });
    }

    // Split batches
    const batches = [];
    for (let i = 0; i < batchData.length; i += maxBatchSize) {
        batches.push(batchData.slice(i, i + maxBatchSize));
    }

    return { batchId, batches };
}

function saveBatches(batchId, batches, mode) {
    const timestamp = new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 19);
    const savedPaths = [];

    if (!fs.existsSync(path.join(process.cwd(), 'stack', 'cdms_batches'))) {
        fs.mkdirSync(path.join(process.cwd(), 'stack', 'cdms_batches'), { recursive: true });
    }

    batches.forEach((batch, idx) => {
        const batchNum = (idx + 1).toString().padStart(2, '0');
        const filename = `${mode}_${timestamp}_batch${batchNum}.csv`;
        const outputPath = path.join(process.cwd(), 'stack', 'cdms_batches', filename);

        const headerLine = BATCH_HEADERS.join(',');
        const contentLines = batch.map(r => {
            return BATCH_HEADERS.map(h => {
                const val = r[h] ?? '';
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',');
        });

        fs.writeFileSync(outputPath, [headerLine, ...contentLines].join('\n') + '\n', 'utf8');
        savedPaths.push(outputPath);
    });

    return savedPaths;
}

module.exports = {
    buildBatch,
    saveBatches
};
