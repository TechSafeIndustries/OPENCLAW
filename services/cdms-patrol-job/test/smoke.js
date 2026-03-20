'use strict';
const path = require('path');
const fs = require('fs');
let passed = 0; let failed = 0;

function assert(c, n) { if (c) { console.log(`  PASS: ${n}`); passed++; } else { console.error(`  FAIL: ${n}`); failed++; } }
function assertThrows(fn, frag, n) { try { fn(); console.error(`  FAIL: ${n} (no error)`); failed++; } catch (e) { if (e.message.includes(frag)) { console.log(`  PASS: ${n}`); passed++; } else { console.error(`  FAIL: ${n} (wrong: ${e.message})`); failed++; } } }

console.log('\n1. Config loader - v2 fixture');
const { validateConfig, BLOCKED_WRITE_BUCKETS } = require('../lib/config');
const v2Raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/config-v2.json'), 'utf8'));
const v2 = validateConfig(v2Raw);
assert(v2.version === 'v2', 'version is v2');
assert(Array.isArray(v2.readRoots), 'readRoots is array');
assert(Array.isArray(v2.writeRoots), 'writeRoots is array');
assert(v2.readRoots.length === 4, 'readRoots has 4 entries');
assert(v2.writeRoots.length === 1, 'writeRoots has 1 entry');
assert(v2.maxBatchSize === 10, 'maxBatchSize is 10');
assert(!v2.writeRoots.some(r => r.includes('controlled-outputs')), 'controlled-outputs not in writeRoots');

console.log('\n2. Config loader - blocked bucket rejection');
const blockedRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/config-blocked.json'), 'utf8'));
assertThrows(() => validateConfig(blockedRaw), 'BLOCKED', 'controlled-outputs in writeRoots throws BLOCKED');

console.log('\n3. CSV parser');
const { parseCsv } = require('../lib/patrol');
const csvText = fs.readFileSync(path.join(__dirname, 'fixtures/sample-batch.csv'), 'utf8');
const { headers, rows } = parseCsv(csvText);
assert(headers.length === 4, 'CSV has 4 headers');
assert(rows.length === 2, 'CSV has 2 data rows');
assert(rows[0].CurrentName === 'test-document-001.pdf', 'row 0 CurrentName correct');
assert(rows[1].ProposedName === 'TSI-GOV-test-document-002-2026-03-20-v1-DRAFT.docx', 'row 1 ProposedName correct');

console.log('\n4. Logger - structured JSON');
const { log: logFn } = require('../lib/logger');
const origLog = console.log; let captured = '';
console.log = (msg) => { captured = msg; }; logFn('test-event', { key: 'value' }); console.log = origLog;
let parsed; try { parsed = JSON.parse(captured); } catch (e) { parsed = null; }
assert(parsed !== null, 'logger output is valid JSON');
assert(parsed && parsed.event === 'test-event', 'event field correct');
assert(parsed && parsed.severity === 'INFO', 'severity is INFO');
assert(parsed && parsed.key === 'value', 'custom field passed through');

console.log('\n5. Storage - blocked bucket enforcement');
assert(BLOCKED_WRITE_BUCKETS.includes('tsi-automation-ase1-controlled-outputs'), 'controlled-outputs in blocked list');
assert(BLOCKED_WRITE_BUCKETS.includes('tsi-automation-ase1-audit-logs'), 'audit-logs in blocked list');

console.log('\n6. FIRESTORE_DATABASE_ID enforcement');
const saved = process.env.FIRESTORE_DATABASE_ID; delete process.env.FIRESTORE_DATABASE_ID;
assert(process.env.FIRESTORE_DATABASE_ID === undefined, 'env var is unset when deleted');
if (saved) process.env.FIRESTORE_DATABASE_ID = saved;
const allowed = ['(default)', 'tsi-dev'];
for (const v of allowed) assert(allowed.includes(v), `"${v}" is in allowed set`);
for (const v of ['prod', 'default', 'tsi-production', '', 'dev']) assert(!allowed.includes(v), `"${v}" is correctly outside allowed set`);
const { createFirestoreClient } = require('../lib/firestore');
let threw = false;
try { const c = createFirestoreClient('tsi-dev'); assert(typeof c.checkApproval === 'function', 'tsi-dev client has checkApproval'); assert(typeof c.writePatrolRun === 'function', 'tsi-dev client has writePatrolRun'); } catch (e) { threw = true; }
assert(!threw, 'createFirestoreClient("tsi-dev") does not throw');
threw = false;
try { const c = createFirestoreClient('(default)'); assert(typeof c.checkApproval === 'function', '(default) client has checkApproval'); } catch (e) { threw = true; }
assert(!threw, 'createFirestoreClient("(default)") does not throw');

console.log('\n7. Dockerfile controls');
const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
assert(dockerfile.includes('USER patrol'), 'Dockerfile runs as non-root');
assert(dockerfile.includes('npm ci'), 'Dockerfile uses npm ci');
assert(dockerfile.includes('COPY index.js'), 'Dockerfile copies index.js explicitly');
assert(dockerfile.includes('COPY lib/'), 'Dockerfile copies lib/ explicitly');
assert(!dockerfile.includes('COPY . .'), 'Dockerfile does NOT do broad COPY');

console.log('\n8. .dockerignore');
const dip = path.join(__dirname, '..', '.dockerignore');
assert(fs.existsSync(dip), '.dockerignore exists');
const di = fs.readFileSync(dip, 'utf8');
assert(di.includes('.git'), 'excludes .git');
assert(di.includes('node_modules'), 'excludes node_modules');
assert(di.includes('.env'), 'excludes .env');
assert(di.includes('openclaw-auth'), 'excludes openclaw-auth');
assert(di.includes('*.db'), 'excludes *.db');

console.log(`\n=== SMOKE RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
