'use strict';

/**
 * OpenClaw — Drive API Write Operations
 * --------------------------------------
 * Exports low-level Drive v3 helpers for CDMS-01.
 *
 * Auth: reads GOOGLE_APPLICATION_CREDENTIALS env var (path to service account JSON).
 *       Never prints or exposes the key content.
 * Scope: drive (read-write). Caller is responsible for granting correct SA roles.
 *
 * All list/get/update calls set supportsAllDrives + includeItemsFromAllDrives.
 *
 * Exports:
 *   getDriveClient()
 *   findSharedDriveIdByName(driveName)
 *   ensureFolderPath(driveId, pathParts)
 *   moveFile(fileId, fromParentId, toParentId)
 *   renameFile(fileId, newName)
 */

const { google } = require('googleapis');

// ── Auth + client ─────────────────────────────────────────────────────────────

/**
 * getDriveClient()
 * Builds and returns a Drive v3 client using GOOGLE_APPLICATION_CREDENTIALS.
 * Throws if the env var is missing or the key file cannot be loaded.
 */
async function getDriveClient() {
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credsPath) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set.');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });
    return drive;
}

// ── Shared Drive resolution ───────────────────────────────────────────────────

/**
 * findSharedDriveIdByName(driveName)
 * Iterates all Shared Drives visible to the service account and returns
 * the ID of the first drive whose name matches exactly.
 * Returns null if not found.
 *
 * @param {string} driveName  Exact display name of the Shared Drive.
 * @returns {Promise<string|null>}
 */
async function findSharedDriveIdByName(driveName) {
    const drive = await getDriveClient();
    let pageToken;

    do {
        const params = {
            pageSize: 100,
            fields: 'nextPageToken, drives(id, name)',
        };
        if (pageToken) params.pageToken = pageToken;

        const res = await drive.drives.list(params);
        for (const d of res.data.drives || []) {
            if (d.name === driveName) return d.id;
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return null;
}

// ── Folder helpers ────────────────────────────────────────────────────────────

/**
 * _findChildFolder(drive, driveId, parentId, name)
 * Returns the file ID of a child folder named `name` under `parentId`, or null.
 */
async function _findChildFolder(drive, driveId, parentId, name) {
    const safe = name.replace(/\\/g, '').replace(/'/g, "\\'");
    const res = await drive.files.list({
        corpora: 'drive',
        driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        q: `mimeType='application/vnd.google-apps.folder'` +
            ` and name='${safe}'` +
            ` and '${parentId}' in parents` +
            ` and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 10,
    });
    const files = res.data.files || [];
    return files.length > 0 ? files[0].id : null;
}

/**
 * _createChildFolder(drive, driveId, parentId, name)
 * Creates a folder named `name` under `parentId` in the Shared Drive.
 * Returns the new folder ID.
 */
async function _createChildFolder(drive, driveId, parentId, name) {
    const res = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id, name',
    });
    return res.data.id;
}

/**
 * ensureFolderPath(driveId, pathParts)
 * Walks `pathParts` starting from the Shared Drive root, finding or creating
 * each folder segment. Returns the leaf folder ID.
 *
 * Example:
 *   ensureFolderPath(driveId, ['TSI-01 DocControl.GOOGLE', '01_Governance', 'INCOMING'])
 *
 * @param {string}   driveId    Shared Drive ID (used as root parent anchor).
 * @param {string[]} pathParts  Ordered folder name segments.
 * @returns {Promise<{ folderId: string, created: string[], found: string[] }>}
 */
async function ensureFolderPath(driveId, pathParts) {
    const drive = await getDriveClient();
    let currentId = driveId;  // Shared Drive root = drive ID itself
    const created = [];
    const found = [];

    for (const part of pathParts) {
        if (!part || part.trim() === '') continue;
        const trimmed = part.trim();
        const existing = await _findChildFolder(drive, driveId, currentId, trimmed);
        if (existing) {
            found.push(trimmed);
            currentId = existing;
        } else {
            const newId = await _createChildFolder(drive, driveId, currentId, trimmed);
            created.push(trimmed);
            currentId = newId;
        }
    }

    return { folderId: currentId, created, found };
}

// ── File mutations ────────────────────────────────────────────────────────────

/**
 * moveFile(fileId, fromParentId, toParentId)
 * Moves a file by adding toParentId and removing fromParentId.
 * Returns a result object — never throws (errors are captured in result.error).
 *
 * @param {string} fileId       File to move.
 * @param {string} fromParentId Current parent folder ID.
 * @param {string} toParentId   Target parent folder ID.
 * @returns {Promise<{ ok: boolean, fileId, fromParentId, toParentId, ts, error? }>}
 */
async function moveFile(fileId, fromParentId, toParentId) {
    const ts = new Date().toISOString();
    const drive = await getDriveClient();
    try {
        await drive.files.update({
            fileId,
            addParents: toParentId,
            removeParents: fromParentId,
            supportsAllDrives: true,
            fields: 'id, parents',
        });
        return { ok: true, fileId, fromParentId, toParentId, ts };
    } catch (err) {
        return {
            ok: false,
            fileId,
            fromParentId,
            toParentId,
            ts,
            error: err.message,
            status: err.status || err.code,
        };
    }
}

/**
 * renameFile(fileId, newName)
 * Updates the display name of a file without moving it.
 * Returns a result object — never throws.
 *
 * @param {string} fileId   File to rename.
 * @param {string} newName  New display name.
 * @returns {Promise<{ ok: boolean, fileId, newName, ts, error? }>}
 */
async function renameFile(fileId, newName) {
    const ts = new Date().toISOString();
    const drive = await getDriveClient();
    try {
        await drive.files.update({
            fileId,
            supportsAllDrives: true,
            requestBody: { name: newName },
            fields: 'id, name',
        });
        return { ok: true, fileId, newName, ts };
    } catch (err) {
        return {
            ok: false,
            fileId,
            newName,
            ts,
            error: err.message,
            status: err.status || err.code,
        };
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    getDriveClient,
    findSharedDriveIdByName,
    ensureFolderPath,
    moveFile,
    renameFile,
};

// ── Self-test (read-only) ─────────────────────────────────────────────────────
// Usage: node scripts/drive_api_write_ops.js --selftest

if (require.main === module) {
    const args = process.argv.slice(2);
    if (!args.includes('--selftest')) {
        console.error('Usage: node scripts/drive_api_write_ops.js --selftest');
        process.exit(1);
    }

    (async () => {
        console.log('=== drive_api_write_ops selftest ===');
        console.log('Auth source: GOOGLE_APPLICATION_CREDENTIALS (path not printed)');

        let drive;
        try {
            drive = await getDriveClient();
            console.log('OK: getDriveClient() succeeded');
        } catch (err) {
            console.error('FAIL: getDriveClient():', err.message);
            process.exit(1);
        }

        // List first 3 Shared Drives (read-only, no writes)
        try {
            const res = await drive.drives.list({ pageSize: 3, fields: 'drives(id, name)' });
            const drives = res.data.drives || [];
            if (drives.length === 0) {
                console.warn('WARN: No Shared Drives visible to this service account.');
            } else {
                console.log(`OK: First ${drives.length} Shared Drive(s) visible:`);
                drives.forEach((d, i) => console.log(`  [${i + 1}] ${d.name}  (${d.id})`));
            }
        } catch (err) {
            console.error('FAIL: drives.list():', err.message);
            process.exit(1);
        }

        console.log('=== selftest complete (no writes performed) ===');
        process.exit(0);
    })();
}
