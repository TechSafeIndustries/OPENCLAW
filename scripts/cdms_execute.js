'use strict';

/**
 * OpenClaw — CDMS Execute (dry-run gate)
 * ----------------------------------------
 * Runs all hard gates before any Drive write is attempted.
 * Default mode: DRY-RUN (safe, no Drive calls).
 * --live flag: exits with LIVE_NOT_IMPLEMENTED (not yet built).
 *
 * Usage:
 *   node scripts/cdms_execute.js --batch <path_or_id> --owner <name> [--live]
 *
 * Gates:
 *   1. Batch exists under stack/cdms_batches/
 *   2. CSV parses and row count <= policy.maxBatchSize
 *   3. Every ProposedTSI01Path starts with policy.allowlistRoots[0]
 *   4. Ledger has an APPROVED cdms_human_review decision for this batch_ref
 */

const fs = require('fs');
const path = require('path');
function resolveDestPath(destRoot, candidate) {
    const rootAbs = path.resolve(destRoot);

    // If candidate is already inside root, keep it (prevents root duplication)
    if (candidate && path.isAbsolute(candidate)) {
        const candAbs = path.resolve(candidate);
        if (candAbs === rootAbs || candAbs.startsWith(rootAbs + path.sep)) return candAbs;
    }

    // Treat everything else as relative; strip any drive prefix if present
    const rel = String(candidate || "").replace(/^[A-Za-z]:[\\/]/, "");
    return path.resolve(rootAbs, rel);
}
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { resolveDestAbs } = require('../app/resolve_dest_path_v1');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'db', 'openclaw_ledger.db');
const POLICY_PATH = path.join(ROOT, 'policy', 'cdms_write_rule_v1.json');
const BATCH_DIR = path.join(ROOT, 'stack', 'cdms_batches');
const RECEIPT_DIR = path.join(ROOT, 'stack', 'cdms_receipts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}
function sha256(s) {
    return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Normalises a key by removing BOM, trimming whitespace, and lowercasing.
 */
function normKey(k) {
    if (k == null) return '';
    return String(k).replace(/^\ufeff/, '').trim().toLowerCase();
}

/**
 * Path normalization for comparison (Gate 3, base resolution).
 * Handles dashes, spaces, and casing.
 */
/**
 * Path normalization for comparison (Gate 3, base resolution).
 * Handles dashes, spaces, and casing.
 * Per user requirement: absolute, normalized, lowercase.
 */
function normalizePath(p) {
    if (!p) return "";
    let s = path.normalize(path.resolve(ROOT, p)).toLowerCase();
    // Special character cleanup (preserved from previous version)
    s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-');
    s = s.replace(/\u00A0/g, ' ');
    s = s.replace(/\s+/g, ' ');
    return s.trim();
}

/**
 * Robust field getter for CSV rows.
 * Handles BOM, whitespace, and case issues in headers.
 * Also strips wrapping quotes from values and trims.
 */
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
    if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).trim();
    }
    return val;
}

/**
 * Windows Long Path Prefix Helper (\\?\).
 * Bypasses the 260 character MAX_PATH limit.
 */
function toLongPath(p) {
    if (!p || typeof p !== 'string') return p;
    if (process.platform !== 'win32') return p;
    if (p.startsWith('\\\\?\\')) return p;
    // Resolve to absolute path before adding prefix
    const resolved = path.resolve(p);
    // Only prefix drive-letter paths (G:\...) or UNC paths if handled differently
    if (/^[A-Z]:\\/i.test(resolved)) {
        return '\\\\?\\' + resolved;
    }
    return resolved;
}

/**
 * Deterministically resolves src/dst paths for a batch row.
 * Supports Smoke schema (direct paths) and Real schema (joined components).
 */
function resolveRowPaths(row, index, allowRoots = []) {
    const g = (k) => getField(row, k);

    // Schema component lookup
    const cPath = g('CurrentPath');
    const cName = g('CurrentName');
    const pTSI = g('ProposedTSIPath') || g('ProposedTSI01Path');
    const pName = g('ProposedName');
    const sDrive = g('SourceDrive');

    // ── MoveBatch detection ──
    const isMoveBatch = !!getField(row, 'ProposedTSI01Path');

    if (isMoveBatch) {
        // PERMITTED: join("G:\\Shared drives\\", ProposedTSI01Path.trimLeadingSlashes(), ProposedName)
        const trim = (s) => String(s || "").replace(/^[\\\/]+/, "");
        const driveBase = "G:\\Shared drives\\";

        // srcAbs logic
        let srcAbs;
        if (cPath.match(/^[A-Za-z]:/)) {
            srcAbs = path.join(cPath, cName);
        } else {
            srcAbs = path.join(driveBase, trim(cPath), cName);
        }

        // dstAbs logic (NO resolveDestAbs mapping for MoveBatch)
        const dstAbs = path.join(driveBase, trim(pTSI), pName);

        // Specialized Guard for ZERO TRUST
        if (pTSI && pName) {
            const isZT = pName.toLowerCase().includes('tsi-zt-rs_');
            const hasIncoming = dstAbs.toLowerCase().includes('\\incoming\\');
            if (isZT && !hasIncoming) {
                throw new Error('MOVE_ROW_NOT_APPLIED: Zero Trust row must land in \\INCOMING\\');
            }
        }

        return { srcAbs, dstAbs };
    }

    // Detect schema components for real CDMS batches
    const isRealBatch = (sDrive !== '' || cName !== '' || pName !== '');

    if (isRealBatch || cPath) {
        if (cName && pName && cPath && pTSI) {
            let base = (sDrive && path.isAbsolute(sDrive)) ? sDrive : null;
            if (sDrive === 'CurrentPath') base = ROOT;

            const normCPath = normalizePath(cPath);

            // Attempt to derive absolute base from allowlist
            if (allowRoots.length > 0) {
                // Pre-normalize all allowRoots for comparison
                const candidates = allowRoots.map(r => ({
                    original: r,
                    normalized: normalizePath(r).replace(/[\\\/]$/, '') + path.sep
                })).sort((a, b) => b.normalized.length - a.normalized.length);

                for (const cand of candidates) {
                    const np = normCPath.endsWith(path.sep) ? normCPath : normCPath + path.sep;
                    if (np.startsWith(cand.normalized) || normCPath === cand.normalized.slice(0, -1)) {
                        base = cand.original;
                        break;
                    }
                }
            }

            if (!base) {
                throw new Error(`Row ${index} cannot derive absolute base from CurrentPath "${cPath}". SourceDrive fragment "${sDrive}" is not an absolute path.`);
            }

            return {
                srcAbs: path.join(cPath, cName),
                base: base,
                dstAbs: resolveDestAbs(base, pTSI, pName)
            };
        }
    }

    // Smoke Schema fallback
    if (!cPath || !pTSI) {
        throw new Error(`Row ${index} missing required fields for path resolution`);
    }
    // For smoke, we treat them as ready-to-use paths
    return { srcAbs: cPath, dstAbs: pTSI };
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
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
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

function resolveBatchPath(batchArg, isDryRun) {
    // 1. Handle missing/boolean case
    if (batchArg === true || !batchArg) {
        if (isDryRun) {
            // Auto-select latest batch matching Batch_MIGRATE_1._Corporate_*.csv
            if (!fs.existsSync(BATCH_DIR)) return null;
            const files = fs.readdirSync(BATCH_DIR)
                .filter(f => f.startsWith('Batch_MIGRATE_1._Corporate_') && f.endsWith('.csv'))
                .map(f => {
                    const full = path.join(BATCH_DIR, f);
                    return { name: f, path: full, mtime: fs.statSync(full).mtime };
                })
                .sort((a, b) => b.mtime - a.mtime);

            if (files.length > 0) {
                console.log(`Auto-selected latest batch: ${files[0].name}`);
                return files[0].path;
            }
            return null;
        } else {
            // If not dryrun, it's a hard fail, handled in main
            return null;
        }
    }

    if (typeof batchArg !== 'string') return null;

    // 2. Full absolute path
    if (path.isAbsolute(batchArg) && fs.existsSync(batchArg)) return batchArg;

    // 3. Relative path under repo
    const repoRel = path.resolve(ROOT, batchArg);
    if (fs.existsSync(repoRel)) return repoRel;

    // 4. Filename with or without .csv under BATCH_DIR
    const direct = path.join(BATCH_DIR, batchArg);
    if (fs.existsSync(direct)) return direct;

    if (!batchArg.toLowerCase().endsWith('.csv')) {
        const withCsv = path.join(BATCH_DIR, batchArg + '.csv');
        if (fs.existsSync(withCsv)) return withCsv;
    }

    // 5. Existing fuzzy search fallback
    const entries = fs.existsSync(BATCH_DIR) ? fs.readdirSync(BATCH_DIR).filter(f => f.endsWith('.csv')) : [];

    // Exact batch_id match (basename without .csv)
    let match = entries.find(f => path.basename(f, '.csv') === batchArg);
    if (match) return path.join(BATCH_DIR, match);

    // Prefix/unambiguous match for Batch_ or MoveBatch_
    const candidates = entries.filter(f =>
        f.startsWith(batchArg) ||
        f.startsWith('Batch_' + batchArg) ||
        f.startsWith('MoveBatch_' + batchArg)
    );
    if (candidates.length === 1) return path.join(BATCH_DIR, candidates[0]);

    // Fallback search for any filename containing the arg
    match = entries.find(f => f.includes(batchArg));
    return match ? path.join(BATCH_DIR, match) : null;
}

function fail(msg, code = 1) {
    if (code === 10) { // Specific code for batch missing
        console.error('Batch path missing. Use --batch <fullpath-or-filename.csv>');
    } else {
        console.error('\nFAIL: ' + msg);
    }
    process.exit(code);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const rawArgs = parseArgs(process.argv.slice(2));

    // --execute or --live forces EXECUTE mode.
    // Also support --dryrun false as an explicit opt-out of dry-run.
    const isExecute = !!rawArgs.execute || !!rawArgs.live || rawArgs.dryrun === 'false';
    const isDryRun = !isExecute;
    const runMode = isExecute ? 'EXECUTE' : 'DRYRUN';

    // ── Safety Gates for EXECUTE ──────────────────────────────────────────────
    if (runMode === 'EXECUTE') {
        const driveFS = 'G:\\Shared drives';
        if (!fs.existsSync(driveFS)) {
            // Special case for local testing: if environment says it's ok, proceed.
            // But requirement says: "Must run only when G:\Shared drives exists."
            // So we strictly follow the requirement.
            fail(`DriveFS not mounted at ${driveFS}. Cannot run EXECUTE mode.`);
        }
    }

    // ── Batch resolution ──────────────────────────────────────────────────────
    const batchArg = rawArgs.batch;
    if ((batchArg === true || !batchArg) && !isDryRun) {
        fail('', 10); // Batch path missing. Use --batch <fullpath-or-filename.csv>
    }

    const batchPath = resolveBatchPath(batchArg, isDryRun);
    if (!batchPath) {
        if (batchArg && batchArg !== true) {
            console.error(`\nAvailable batches in ${BATCH_DIR}:`);
            if (fs.existsSync(BATCH_DIR)) {
                fs.readdirSync(BATCH_DIR)
                    .filter(f => (f.startsWith('MoveBatch_') || f.startsWith('Batch_')) && f.endsWith('.csv'))
                    .forEach(f => console.error('  ' + f));
            }
            fail(`Batch not found: ${batchArg}`);
        } else {
            fail('No batch files found for auto-selection.');
        }
    }

    // Must refuse to execute if batch path is not under repo stack\cdms_batches OR not a .csv.
    const normBatchPath = path.resolve(batchPath);
    const normBatchDir = path.resolve(BATCH_DIR);
    const isUnderBatchDir = normBatchPath.startsWith(normBatchDir + path.sep) || normBatchPath.startsWith(normBatchDir + '/');
    const isCsv = batchPath.toLowerCase().endsWith('.csv');

    if (runMode === 'EXECUTE') {
        if (!isUnderBatchDir || !isCsv) {
            fail(`Safety Violation: Batch file must be a .csv inside ${BATCH_DIR}. Path: ${batchPath}`);
        }
    }

    if (!rawArgs.owner) fail('--owner is required');

    const owner = rawArgs.owner;

    // ── Load policy ───────────────────────────────────────────────────────────
    console.log(`\n=== CDMS Execute — ${runMode} ===`);
    if (runMode === 'EXECUTE') {
        console.log('RUN MODE: EXECUTE');
    } else {
        console.log('RUN MODE: DRYRUN');
    }
    let policy;
    try {
        policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    } catch (err) {
        fail('Cannot load policy: ' + err.message);
    }
    const rawRoots = [
        ...(policy.allowListRoots || []),
        ...(policy.allowlistRoots || []),
        policy.allowListRoot
    ].filter(Boolean);

    const allowRoots = rawRoots.map(r => {
        let n = r.replace(/\\/g, '/');
        if (!n.endsWith('/')) n += '/';
        return n;
    });

    const maxBatchSize = policy.maxBatchSize;

    // ── STRICT_LOCAL_MODE Extension ───────────────────────────────────────────
    const STRICT_LOCAL_MODE = process.env.CDMS_ALLOW_LOCAL_TMP === '1';
    const tmpRoot = path.join(ROOT, 'stack', 'cdms_tmp');
    if (STRICT_LOCAL_MODE) {
        let n = tmpRoot.replace(/\\/g, '/');
        if (!n.endsWith('/')) n += '/';
        if (!allowRoots.includes(n.toLowerCase())) {
            allowRoots.push(n); // We keep original case in allowlist for joins
            console.log(`STRICT: Local tmp allowlist enabled: ${n}`);
        }
    }

    console.log(`Policy loaded: allowlistRoots=[${allowRoots.join(', ')}], maxBatchSize=${maxBatchSize}`);

    // ── Gate 1: batch exists (Already resolved above) ────────────────────────
    const batchRef = path.basename(batchPath, '.csv');
    console.log(`\n[GATE 1] Batch exists    : PASS  (${batchRef})`);

    // ── Gate 2: CSV parses + row count ────────────────────────────────────────
    let rows;
    try {
        const text = fs.readFileSync(batchPath, 'utf8');
        ({ rows } = parseCsv(text));
    } catch (err) {
        fail('CSV parse error: ' + err.message);
    }
    if (rows.length === 0) fail('Batch is empty (0 data rows).');
    if (rows.length > maxBatchSize) {
        fail(`Batch has ${rows.length} rows, exceeds maxBatchSize=${maxBatchSize}. Split the batch.`);
    }
    console.log(`[GATE 2] Row count       : PASS  (${rows.length} rows, max=${maxBatchSize})`);

    // ── Gate 3: allowlist check on every row ──────────────────────────────────
    // Validate BOTH resolved src and dst are inside ANY allowRoot
    const violators = [];
    rows.forEach((r, i) => {
        try {
            const res = resolveRowPaths(r, i + 1, allowRoots);
            const { srcAbs, dstAbs } = res;

            // ABSOLUTE NORMALIZATION (User Requirement)
            const normSrc = normalizePath(srcAbs);
            const normDst = normalizePath(dstAbs);

            const allowRootsNorm = allowRoots.map(r => {
                const abs = normalizePath(r);
                return abs.endsWith(path.sep) ? abs : abs + path.sep;
            });

            const srcOk = allowRootsNorm.some(root => normSrc.startsWith(root) || normSrc === root.slice(0, -1));
            const dstOk = allowRootsNorm.some(root => normDst.startsWith(root) || normDst === root.slice(0, -1));

            // Log resolution for Row 1 in DRYRUN
            if (i === 0 && runMode === 'DRYRUN') {
                console.log(`Row 1 Resolution Check:`);
                console.log(`  DEBUG_KEYS: ${Object.keys(r).join(', ')}`);
                console.log(`  DEBUG SourceDrive: "${getField(r, 'SourceDrive')}"`);
                console.log(`  DEBUG srcAbs: ${srcAbs}`);
                console.log(`  DEBUG dstAbs: ${dstAbs}`);
                console.log(`  DEBUG normSrc: ${normSrc}`);
                console.log(`  DEBUG normDst: ${normDst}`);
                console.log(`  DEBUG allowRootsNorm (computed absolute):`);
                allowRootsNorm.forEach(root => {
                    const sMatch = normSrc.startsWith(root) || normSrc === root.slice(0, -1);
                    const dMatch = normDst.startsWith(root) || normDst === root.slice(0, -1);
                    console.log(`    - ${root} [SRC=${sMatch}, DST=${dMatch}]`);
                });
                console.log(`  Inside Allowlist: SRC=${srcOk}, DST=${dstOk}`);
            }

            if (!srcOk || !dstOk) {
                violators.push({ rowIndex: i + 1, srcAbs, dstAbs });
            }
        } catch (err) {
            console.error(`  Row ${i + 1}: ${err.message}`);
            violators.push({ rowIndex: i + 1, err: err.message });
        }
    });

    if (violators.length > 0) {
        console.error('\nAllowlist violations (src or dst outside allowlistRoots):');
        violators.forEach(v => {
            if (v.err) {
                console.error(`  Row ${v.rowIndex}: ${v.err}`);
            } else {
                console.error(`  Row ${v.rowIndex}: SRC="${v.srcAbs}" | DST="${v.dstAbs}"`);
            }
        });
        fail(`${violators.length} row(s) violate allowlistRoots or resolution. Abort.`);
    }
    console.log(`[GATE 3] Allowlist       : PASS  (all ${rows.length} rows inside allowlistRoots)`);

    // ── Gate 4: ledger approval ───────────────────────────────────────────────
    let db;
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    } catch (err) {
        fail('Cannot open ledger: ' + err.message);
    }

    const approval = db.prepare(`
        SELECT id, approved_by, ts
        FROM decisions
        WHERE decision_type = 'approve'
          AND subject = ?
        ORDER BY ts DESC
        LIMIT 1
    `).get('CDMS batch: ' + batchRef);

    if (!approval) {
        db.close();
        fail(
            `No APPROVED decision found in ledger for batch "${batchRef}".\n` +
            `  Run first: npm run workflow:cdms-human-review -- --batch ${batchRef} --decision approve --reason "..." --owner ${owner}`
        );
    }
    console.log(`[GATE 4] Ledger approval : PASS  (approved_by="${approval.approved_by}" at ${approval.ts})`);
    console.log(`\nGATES_PASSED — all 4 gates passed. Mode: ${runMode}`);

    // ── Execute Loop (if mode is EXECUTE) ─────────────────────────────────────
    const rowResults = [];
    let stopLossTriggered = false;

    if (runMode === 'EXECUTE') {
        console.log('\n=== EXECUTING OPERATIONS ===');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const label = `[Row ${i + 1}/${rows.length}]`;

            let src, dst;
            try {
                const res = resolveRowPaths(row, i + 1, allowRoots);
                src = res.srcAbs;
                dst = res.dstAbs;

                // ── Deterministic Debug Logging ──
                console.log(`[ROW_DEBUG] index=${i + 1}, CurrentPath="${getField(row, 'CurrentPath')}", CurrentName="${getField(row, 'CurrentName')}", ProposedTSI01Path="${getField(row, 'ProposedTSI01Path')}", ProposedName="${getField(row, 'ProposedName')}", srcAbs="${src}", dstAbs="${dst}", srcLen=${src.length}, dstLen=${dst.length}`);

                console.log(`${label} Validating: "${src}" -> "${dst}"`);

                // 1. Basic Path Validation
                if (!src || !dst) throw new Error('Source or Destination path is empty');
                if (src.includes('..') || dst.includes('..')) throw new Error('Path traversal (..) detected');

                // 2. Windows Path Length Guard
                // AG Plan B: Remove the strict 250 guard and use long path prefix instead.
                const longSrc = toLongPath(src);
                const longDst = toLongPath(dst);

                if (src.length >= 32000 || dst.length >= 32000) {
                    throw new Error(`Path effectively exceeding OS limits (> 32k)`);
                }

                // 3. Filesystem State Validation
                if (!fs.existsSync(longSrc)) {
                    console.log(`  ${label} SKIPPED_MISSING_SOURCE: "${src}"`);
                    console.log(`  [HIDDEN_HINT] Path length=${src.length}. If this looks correct, check DriveFS hydration or special characters.`);
                    rowResults.push({ index: i, ok: false, status: 'SKIPPED_MISSING_SOURCE', src: longSrc, dst: longDst, error: 'Source path missing at execution time' });
                    continue;
                }

                if (fs.statSync(longSrc).isDirectory()) {
                    console.log(`  ${label} SKIPPED_SOURCE_IS_DIRECTORY: "${src}"`);
                    rowResults.push({ index: i, ok: false, status: 'SKIPPED_SOURCE_IS_DIRECTORY', src: longSrc, dst: longDst, error: 'Source path is a directory' });
                    continue;
                }

                if (fs.existsSync(longDst)) throw new Error('Destination already exists (no overwrite)');

                // Ensure destination directory exists (LIVE Requirement)
                const dstDir = path.dirname(longDst); // dirname handles \\?\ paths correctly in Node path module
                if (!fs.existsSync(dstDir)) {
                    console.log(`  Creating directory: ${dstDir}`);
                    fs.mkdirSync(dstDir, { recursive: true });
                }

                // 4. Execute Move (fs.renameSync with cross-device fallback)
                try {
                    fs.renameSync(longSrc, longDst);
                } catch (err) {
                    if (err.code === 'EXDEV') {
                        console.log(`  ${label} Cross-device detected. Falling back to copy+unlink...`);
                        fs.copyFileSync(longSrc, longDst);
                        fs.unlinkSync(longSrc);
                    } else {
                        throw err;
                    }
                }
                console.log(`  SUCCESS: Moved.`);
                rowResults.push({ index: i, ok: true, status: 'OK', src, dst });

            } catch (err) {
                console.error(`  FAILURE: ${err.message}`);
                rowResults.push({ index: i, ok: false, status: 'FAIL', src: src || 'unknown', dst: dst || 'unknown', error: err.message });

                // Abort on permission errors / allowlist violations / ledger missing / systemic failures
                // MOVE_ROW_NOT_APPLIED is considered systemic (abort)
                console.error('\nSTOP-LOSS: Aborting remaining operations.');
                stopLossTriggered = true;
                break;
            }
        }
    }

    // ── Write receipt ─────────────────────────────────────────────────────────
    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });

    const ts = nowStamp();
    const receiptPath = path.join(RECEIPT_DIR, `Receipt_${ts}_${runMode}.json`);
    const receipt = {
        mode: runMode,
        batch: batchRef,
        owner,
        executed_at: nowIso(),
        allowlist_roots: allowRoots,
        row_count: rows.length,
        stop_loss_triggered: stopLossTriggered,
        gates_passed: true,
        gates: {
            batch_exists: true,
            max_batch_size: maxBatchSize,
            allowlist_ok: true,
            approval_id: approval.id,
            approved_by: approval.approved_by,
            approval_ts: approval.ts,
        },
        results: rowResults.map(r => ({
            ok: r.ok,
            status: r.status,
            src: r.src,
            dst: r.dst,
            error: r.error || null
        })),
        rollback_plan: rowResults.filter(r => r.ok).map(r => ({
            action: 'MOVE',
            src: r.dst,
            dst: r.src,
            reason: 'Rollback of ' + batchRef
        })),
        note: runMode === 'EXECUTE' ? 'EXECUTE mode. Logic implemented.' : 'DRY-RUN only. No filesystem changes made.',
    };

    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    console.log(`\nReceipt written: ${receiptPath}`);

    // ── Write run sheet CSV ───────────────────────────────────────────────────
    const RUN_SHEET_HEADERS = ['CurrentPath', 'CurrentName', 'ProposedTSI01Path', 'ProposedName'];
    const escCsv = (v) => {
        const s = v == null ? '' : String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    };
    const runSheetPath = path.join(RECEIPT_DIR, `RunSheet_${ts}_status-${runMode}.csv`);
    const RUN_SHEET_HEADERS_EXT = [...RUN_SHEET_HEADERS, 'Status', 'Error'];
    const runSheetLines = [
        RUN_SHEET_HEADERS_EXT.join(','),
        ...rows.map((r, i) => {
            const res = rowResults.find(rr => rr.index === i);
            const status = res ? res.status : (stopLossTriggered ? 'SKIPPED_STOP_LOSS' : 'PENDING');
            const error = res?.error || '';
            const rowVals = RUN_SHEET_HEADERS.map(h => escCsv(r[h]));
            return [...rowVals, status, escCsv(error)].join(',');
        }),
    ];
    fs.writeFileSync(runSheetPath, runSheetLines.join('\n') + '\n', 'utf8');
    console.log(`RunSheet written: ${runSheetPath}`);

    // ── Ledger entry ──────────────────────────────────────────────────────────
    const now = nowIso();
    const sessionId = 'cdms_execute_' + uuid();
    const actionId = uuid();
    const metaJson = JSON.stringify({
        batch: batchRef,
        owner,
        runMode,
        counts: {
            total: rows.length,
            ok: rowResults.filter(r => r.ok).length,
            fail: rowResults.filter(r => !r.ok).length,
        },
        stopLossTriggered,
        receiptFile: receiptPath,
        runsheetFile: runSheetPath,
        type: 'cdms_execute'
    });

    try {
        db.transaction(() => {
            db.prepare(`
                INSERT INTO sessions (id, started_at, ended_at, initiator, mode, status, summary)
                VALUES (?, ?, NULL, ?, 'on_demand', 'open', ?)
                ON CONFLICT(id) DO NOTHING
            `).run(sessionId, now, owner, `CDMS execute ${runMode} — ` + batchRef);

            db.prepare(`
                INSERT INTO actions
                  (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
                VALUES (?, ?, ?, ?, 'cdms_execute', ?, NULL, ?, ?, ?)
            `).run(actionId, sessionId, now, owner, batchRef,
                runMode, `${runMode}; gates passed; rows=${rows.length}; success=${rowResults.filter(r => r.ok).length}`, metaJson);

            // Per-row actions for EXECUTE (including skips)
            if (runMode === 'EXECUTE') {
                for (const res of rowResults) {
                    const rowActionId = uuid();
                    const isSkip = res.status.startsWith('SKIPPED');
                    const actionType = isSkip ? 'cdms_row_skip' : 'cdms_move';
                    const status = res.ok ? 'ok' : (isSkip ? 'SKIPPED' : 'fail');

                    db.prepare(`
                        INSERT INTO actions
                          (id, session_id, ts, actor, type, input_ref, output_ref, status, reason, meta_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        rowActionId,
                        sessionId,
                        now,
                        owner,
                        actionType,
                        res.src,
                        res.dst,
                        status,
                        res.error || (res.ok ? 'moved' : 'fail'),
                        JSON.stringify({
                            batch: batchRef,
                            owner,
                            src: res.src,
                            dst: res.dst,
                            error: res.error || null,
                            timestamp: now,
                            rowIndex: res.index + 1
                        })
                    );
                }
            }
        })();
        console.log(`Ledger entry written: action id=${actionId} status=${runMode}`);
    } catch (err) {
        console.warn('WARN: Ledger write failed (non-fatal in dry-run):', err.message);
    }

    db.close();

    // ── Final summary ─────────────────────────────────────────────────────────
    const stats = {
        TOTAL: rows.length,
        OK: rowResults.filter(r => r.status === 'OK').length,
        SKIPPED_MISSING_SOURCE: rowResults.filter(r => r.status === 'SKIPPED_MISSING_SOURCE').length,
        SKIPPED_SOURCE_IS_DIRECTORY: rowResults.filter(r => r.status === 'SKIPPED_SOURCE_IS_DIRECTORY').length,
        FAIL: rowResults.filter(r => r.status === 'FAIL').length,
        PENDING: rows.length - rowResults.length
    };

    console.log(`\n=== ${runMode} COMPLETE ===`);
    console.log(`  Batch    : ${batchRef}`);
    console.log(`  Summary  : TOTAL=${stats.TOTAL}, OK=${stats.OK}, MISSING=${stats.SKIPPED_MISSING_SOURCE}, DIR=${stats.SKIPPED_SOURCE_IS_DIRECTORY}, FAIL=${stats.FAIL}, PENDING=${stats.PENDING}`);
    console.log(`  Receipt  : ${receiptPath}`);
    console.log(`  Next     : npm run workflow:cdms-verify -- --batch ${batchRef} --owner ${owner}`);
    process.exit(0);
}

main();
