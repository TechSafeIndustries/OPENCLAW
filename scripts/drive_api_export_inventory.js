'use strict';
/**
 * drive_api_export_inventory.js
 * READ-ONLY Google Drive API inventory exporter for blocked Shared Drives.
 * Uses a service account JSON for auth (must be added as member to each Shared Drive).
 *
 * Usage:
 *   node scripts/drive_api_export_inventory.js \
 *     --creds <path/to/service-account.json> \
 *     --out exports/drive_inventory
 *
 * Or via env:
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node scripts/drive_api_export_inventory.js --out exports/drive_inventory
 */

const fs = require('fs');
const path = require('path');

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(flag, fallback) {
    const idx = process.argv.indexOf(flag);
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    return fallback;
}

const credsPath = getArg('--creds', process.env.GOOGLE_APPLICATION_CREDENTIALS || '');
const outDir = getArg('--out', 'exports/drive_inventory');

if (!credsPath) {
    console.error('[ERROR] No credentials supplied. Use --creds <path> or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
}
if (!fs.existsSync(credsPath)) {
    console.error(`[ERROR] Credentials file not found: ${credsPath}`);
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// ── Drive targets ─────────────────────────────────────────────────────────────

const DRIVE_TARGETS = [
    { name: '2. Finance & Admin', slug: 'finance_admin' },
    { name: '3. INTERGRATED MANAGMENT SYSTEMS (IMS)', slug: 'ims' },
    { name: '4. Licensing & Partners', slug: 'licensing_partners' },
    { name: '5. Marketing & Brand Vault', slug: 'marketing_brand_vault' },
    // '10. Website 10Web' removed — drive deprecated 2026-02-24, new website created
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function csvEscape(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}

function writeLine(fd, cols) {
    fs.writeSync(fd, cols.map(csvEscape).join(',') + '\n');
}

async function listAllFiles(drive, driveId, driveName, fd) {
    let pageToken = undefined;
    let pageNum = 0;
    let rowCount = 0;
    const mimeCounts = {};

    do {
        pageNum++;
        process.stdout.write(`\r  [${driveName}] page ${pageNum} (${rowCount} files so far)...`);

        // Build params — only include pageToken when we have one (never pass undefined)
        const params = {
            corpora: 'drive',
            driveId,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            pageSize: 1000,
            q: 'trashed = false',
            orderBy: 'folder,name',
            fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size,parents,trashed,driveId)',
        };
        if (pageToken) params.pageToken = pageToken;

        const res = await drive.files.list(params);
        const files = res.data.files || [];

        // Stream-write this page directly to the open CSV fd
        for (const f of files) {
            const mime = f.mimeType || '';
            const parents = (f.parents || []).join('|');
            writeLine(fd, [
                driveName,
                driveId,
                f.id || '',
                f.name || '',
                mime,
                f.modifiedTime || '',
                f.size || '0',
                parents,
                String(f.trashed || false),
            ]);
            rowCount++;
            mimeCounts[mime] = (mimeCounts[mime] || 0) + 1;
        }

        pageToken = res.data.nextPageToken;
    } while (pageToken);

    process.stdout.write('\n');

    // Top 10 mimeTypes
    const topMimes = Object.entries(mimeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([mime, count]) => ({ mime, count }));

    return { rows: rowCount, pages: pageNum, topMimes };
}

// ── QC report update ──────────────────────────────────────────────────────────

function updateQcReport(outDir) {
    const qcPath = path.join(outDir, 'inventory_qc_report.csv');
    const rows = [];

    const files = fs.readdirSync(outDir)
        .filter(f => f.endsWith('.csv') && f !== 'inventory_qc_report.csv' && !f.endsWith('.errors.csv'))
        .sort();

    for (const fname of files) {
        const fpath = path.join(outDir, fname);
        const stat = fs.statSync(fpath);
        const bytes = stat.size;
        const content = fs.readFileSync(fpath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim()).length;
        const status = (bytes < 200 || lines < 3) ? 'BAD' : 'GOOD';
        rows.push({ File: fname, Bytes: bytes, Lines: lines, Status: status });
    }

    const header = 'File,Bytes,Lines,Status\n';
    const body = rows.map(r => `${csvEscape(r.File)},${r.Bytes},${r.Lines},${r.Status}`).join('\n');
    fs.writeFileSync(qcPath, header + body + '\n', 'utf8');
    return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // Late-require so missing package gives a clean error
    let google;
    try {
        google = require('googleapis').google;
    } catch (e) {
        console.error('[ERROR] googleapis not installed. Run: npm install googleapis');
        process.exit(1);
    }

    // Auth — service account, read-only scope.
    // Explicitly pass projectId from the SA key file to prevent GoogleAuth from
    // falling back to the ambient gcloud project (which may be a different org project).
    const saKey = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const saProjectId = saKey.project_id || '';
    console.log(`  Auth: ${saKey.client_email}  project: ${saProjectId}`);

    const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        projectId: saProjectId,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Resolve all shared drive IDs
    console.log('\n=== Resolving Shared Drive IDs ===');
    const driveIndex = {};
    let nextToken;
    do {
        const res = await drive.drives.list({
            pageSize: 100,
            pageToken: nextToken,
            useDomainAdminAccess: false,
        });
        for (const d of (res.data.drives || [])) {
            driveIndex[d.name] = d.id;
        }
        nextToken = res.data.nextPageToken;
    } while (nextToken);

    for (const target of DRIVE_TARGETS) {
        const id = driveIndex[target.name];
        console.log(`  ${id ? '[FOUND]' : '[MISSING]'} "${target.name}" => ${id || 'NOT_FOUND'}`);
        target.driveId = id || null;
    }

    // Per-drive export
    console.log('\n=== Exporting inventories ===');
    const results = [];

    for (const target of DRIVE_TARGETS) {
        const csvPath = path.join(outDir, `${target.slug}_inventory_api.csv`);
        const jsonPath = path.join(outDir, `${target.slug}_inventory_api.summary.json`);

        console.log(`\n--- [${target.slug}] "${target.name}" ---`);

        if (!target.driveId) {
            console.log(`  STATUS: NO_ACCESS - drive not found in drives.list()`);
            console.log(`  ACTION: Add SERVICE_ACCOUNT_EMAIL as a member (Viewer) on this Shared Drive in Google Drive UI.`);
            results.push({ slug: target.slug, name: target.name, status: 'NO_ACCESS', files: 0 });

            // Write empty-but-valid CSV so QC can flag it
            fs.writeFileSync(csvPath,
                'DriveName,DriveId,FileId,Name,MimeType,ModifiedTime,Size,Parents,Trashed\n', 'utf8');
            fs.writeFileSync(jsonPath,
                JSON.stringify({ slug: target.slug, name: target.name, status: 'NO_ACCESS', fileCount: 0 }, null, 2), 'utf8');
            continue;
        }

        // Open CSV for streaming — header written up-front, rows streamed per-page
        let fd;
        try {
            fd = fs.openSync(csvPath, 'w');
            writeLine(fd, ['DriveName', 'DriveId', 'FileId', 'Name', 'MimeType', 'ModifiedTime', 'Size', 'Parents', 'Trashed']);
        } catch (openErr) {
            console.log(`  STATUS: ERROR opening CSV - ${openErr.message}`);
            results.push({ slug: target.slug, name: target.name, status: 'ERROR', files: 0, error: openErr.message });
            continue;
        }

        let result;
        try {
            result = await listAllFiles(drive, target.driveId, target.name, fd);
        } catch (err) {
            fs.closeSync(fd);
            console.log(`  STATUS: ERROR - ${err.message}`);
            if (err.message && err.message.includes('403')) {
                console.log(`  ACTION: Service account lacks Viewer access. Add SERVICE_ACCOUNT_EMAIL to this Shared Drive.`);
            }
            results.push({ slug: target.slug, name: target.name, status: 'ERROR', files: 0, error: err.message });
            fs.writeFileSync(jsonPath,
                JSON.stringify({ slug: target.slug, name: target.name, status: 'ERROR', error: err.message, fileCount: 0 }, null, 2), 'utf8');
            continue;
        }
        fs.closeSync(fd);

        const { rows: fileCount, pages, topMimes } = result;
        const status = fileCount > 0 ? 'OK' : 'NO_FILES';

        // Write summary JSON
        const summary = {
            slug: target.slug,
            name: target.name,
            driveId: target.driveId,
            status,
            fileCount,
            pagesFetched: pages,
            exportedAt: new Date().toISOString(),
            topMimeTypes: topMimes,
        };
        fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

        // Per-drive console output
        console.log(`  OK drive=${target.slug} files=${fileCount} pages=${pages} status=${status}`);
        console.log(`  Top mimeTypes:`);
        topMimes.slice(0, 5).forEach(m => console.log(`    ${m.count.toString().padStart(5)}  ${m.mime}`));
        if (fileCount === 0) {
            console.log(`  WARNING: 0 files returned. Drive may be empty or service account needs access.`);
            console.log(`  ACTION: Ensure SERVICE_ACCOUNT_EMAIL is added as Viewer on "${target.name}".`);
        }

        results.push({ slug: target.slug, name: target.name, status, files: fileCount, pages });
    }

    // QC report
    console.log('\n=== QC Report ===');
    const qcRows = updateQcReport(outDir);
    const good = qcRows.filter(r => r.Status === 'GOOD');
    const bad = qcRows.filter(r => r.Status === 'BAD');

    console.log(`\nGOOD inventories (${good.length}):`);
    good.forEach(r => console.log(`  [OK]  ${r.File}  (${r.Bytes} bytes, ${r.Lines} lines)`));
    console.log(`\nBAD inventories (${bad.length}):`);
    bad.forEach(r => console.log(`  [BAD] ${r.File}  |  ${r.Bytes} bytes  |  ${r.Lines} lines`));
    console.log(`\nTOTALS =>  GOOD: ${good.length}   BAD: ${bad.length}   TOTAL: ${qcRows.length}`);

    // Final per-drive summary
    console.log('\n=== Drive API Export Summary ===');
    for (const r of results) {
        if (r.status === 'OK') {
            console.log(`  OK    drive=${r.slug}  files=${r.files}`);
        } else if (r.status === 'NO_ACCESS') {
            console.log(`  NO_ACCESS  drive=${r.slug}  => Add service account as Viewer on "${r.name}"`);
        } else if (r.status === 'NO_FILES') {
            console.log(`  NO_FILES   drive=${r.slug}  => Drive may be empty or service account needs access`);
        } else {
            console.log(`  ERROR      drive=${r.slug}  => ${r.error || 'unknown'}`);
        }
    }

    console.log('\nDone.\n');
}

main().catch(err => {
    console.error('[FATAL]', err.message || err);
    process.exit(1);
});
