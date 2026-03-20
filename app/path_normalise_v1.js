/**
 * app/path_normalise_v1.js
 * 
 * Hardened path and filename normaliser for Windows and DriveFS.
 * 
 * Rules:
 * 1. Trim whitespace.
 * 2. Normalise Unicode to NFC (canonical decomposition, then canonical composition).
 * 3. Strip invisible/control characters.
 * 4. Replace illegal Windows filename characters with underscores or dashes.
 * 5. Collapse multiple spaces into single space.
 */

function normaliseString(text) {
    if (typeof text !== 'string') return '';

    // 1. Trim
    let result = text.trim();

    // 2. Normalise Unicode (NFC)
    result = result.normalize('NFC');

    // 3. Strip invisible/control characters (keeping basic printable ASCII + some extended)
    // Range 00-1F are control chars, 7F is DEL, 80-9F are additional controls.
    // eslint-disable-next-line no-control-regex
    result = result.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    // 4. Replace illegal Windows filename characters: < > : " / \ | ? *
    // Note: We leave / and \ if this is intended to be a full path, 
    // but the requirement says apply to ProposedName and path segments.
    // If it's a segment, we should replace them.
    result = result.replace(/[<>:"/\\|?*]/g, '_');

    // 5. Collapse multiple spaces
    result = result.replace(/\s+/g, ' ');

    return result.trim();
}

/**
 * Normalises a full path by splitting into segments, normalising each, and joining back.
 * @param {string} fullPath 
 * @param {string} separator 
 */
function normalisePath(fullPath, separator = '\\') {
    if (typeof fullPath !== 'string') return '';

    // Handle drive letter if present (e.g. C:\ or G:\)
    let drivePrefix = '';
    let pathToNormalise = fullPath;

    const driveMatch = fullPath.match(/^([a-zA-Z]:\\|^\\\\)/);
    if (driveMatch) {
        drivePrefix = driveMatch[0];
        pathToNormalise = fullPath.substring(drivePrefix.length);
    }

    const segments = pathToNormalise.split(/[\\/]/);
    const normalisedSegments = segments
        .map(s => normaliseString(s))
        .filter(s => s.length > 0);

    let result = normalisedSegments.join(separator);
    if (drivePrefix) {
        // Ensure drive prefix is joined correctly
        if (drivePrefix.endsWith('\\') || drivePrefix.endsWith('/')) {
            result = drivePrefix + result;
        } else {
            result = drivePrefix + separator + result;
        }
    }

    return result;
}

module.exports = {
    normaliseString,
    normalisePath
};
