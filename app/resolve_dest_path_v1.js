'use strict';
const path = require('path');

/**
 * resolveDestAbs
 * Anchors a candidate path under a destination root, 
 * avoiding duplication if the candidate already contains the root.
 * 
 * Rules:
 * - rootAbs = path.resolve(destRoot)
 * - candAbs = path.resolve(candidatePath, candidateName)
 * - If candAbs starts with rootAbs, return candAbs.
 * - Else, anchor under rootAbs by stripping any drive/root prefix from candidatePath.
 */
function resolveDestAbs(destRoot, candidatePath, candidateName) {
    if (!destRoot || !candidatePath || !candidateName) {
        throw new Error(`Missing args: destRoot=${destRoot}, candidatePath=${candidatePath}, candidateName=${candidateName}`);
    }

    const rootAbs = path.normalize(path.resolve(destRoot));
    const candAbs = path.normalize(path.resolve(candidatePath, candidateName));

    // Case 1: Already starts with rootAbs (normalized check)
    const nRoot = rootAbs.toLowerCase().endsWith(path.sep) ? rootAbs.toLowerCase() : rootAbs.toLowerCase() + path.sep;
    const nCand = candAbs.toLowerCase().endsWith(path.sep) ? candAbs.toLowerCase() : candAbs.toLowerCase() + path.sep;

    if (nCand.startsWith(nRoot) || candAbs.toLowerCase() === rootAbs.toLowerCase()) {
        const rootSegment = path.basename(rootAbs);
        const doubleSegment = path.join(rootSegment, rootSegment).toLowerCase();
        if (candAbs.toLowerCase().includes(doubleSegment)) {
            console.error(`FAIL: Path duplication detected in resolved path!`);
            console.error(`  rootAbs: ${rootAbs}`);
            console.error(`  candAbs: ${candAbs}`);
        }
        return candAbs;
    }

    // Case 2: Anchor under rootAbs
    const parsed = path.parse(candidatePath);
    const safeRel = path.relative(parsed.root, candidatePath);

    const finalDest = path.normalize(path.join(rootAbs, safeRel, candidateName));

    // Verification Assertion
    const rootBase = path.basename(rootAbs);
    const doubleBase = path.join(rootBase, rootBase).toLowerCase();
    if (finalDest.toLowerCase().includes(doubleBase)) {
        console.error(`FAIL: Path duplication detected in anchored path!`);
        console.error(`  rootAbs: ${rootAbs}`);
        console.error(`  candidatePath: ${candidatePath}`);
        console.error(`  resolved: ${finalDest}`);
    }

    return finalDest;
}

module.exports = { resolveDestAbs };
