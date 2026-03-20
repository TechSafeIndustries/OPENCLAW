/**
 * utils/path_normaliser.js
 * 
 * Path and filename normaliser for Windows and DriveFS.
 * 
 * Rules:
 * - Unicode normalisation: NFC
 * - Trim leading/trailing whitespace
 * - Remove/replace illegal Windows chars: < > : " / \ | ? * and ASCII control chars
 * - Collapse repeated spaces
 * - Remove trailing dot/space
 */

function normaliseSegment(segment) {
    if (typeof segment !== 'string') return '';

    // 1. Unicode normalisation (NFC)
    let result = segment.normalize('NFC');

    // 2. Trim leading/trailing whitespace
    result = result.trim();

    // 3. Remove/replace illegal Windows characters and ASCII control characters
    // Illegal: < > : " / \ | ? *
    // Control: 0x00-0x1F, 0x7F
    // eslint-disable-next-line no-control-regex
    result = result.replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, '_');

    // 4. Collapse repeated spaces
    result = result.replace(/\s+/g, ' ');

    // 5. Remove trailing dot or space (invalid on Windows)
    result = result.replace(/[. ]+$/, '');

    return result;
}

/**
 * Normalises a full path by normalising each segment between separators.
 */
function normalisePath(fullPath, separator = '\\') {
    if (typeof fullPath !== 'string') return '';

    // Handle drive letter if present
    let drivePrefix = '';
    let pathToNormalise = fullPath;
    const driveMatch = fullPath.match(/^([a-zA-Z]:\\|^\\\\)/);
    if (driveMatch) {
        drivePrefix = driveMatch[0];
        pathToNormalise = fullPath.substring(drivePrefix.length);
    }

    const segments = pathToNormalise.split(/[\\/]/);
    const normalisedSegments = segments.map(s => normaliseSegment(s)).filter(s => s.length > 0);

    let result = normalisedSegments.join(separator);
    if (drivePrefix) {
        if (drivePrefix.endsWith('\\') || drivePrefix.endsWith('/')) {
            result = drivePrefix + result;
        } else {
            result = drivePrefix + separator + result;
        }
    }
    return result;
}

module.exports = {
    normaliseSegment,
    normalisePath
};
