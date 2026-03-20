'use strict';
const crypto = require('crypto');
const { log, logWarn, logError } = require('./logger');
function uuid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function generateRunId() { const year = new Date().getFullYear(); const ts = Date.now().toString(36).toUpperCase(); return 'PATROL-' + year + '-' + ts; }
function generateFindingId(index) { const year = new Date().getFullYear(); return 'FINDING-' + year + '-' + String(index).padStart(4, '0'); }
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };
  const splitLine = function(line) { const cols = []; let cur = ''; let inQ = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; } else { cur += ch; } } cols.push(cur); return cols; };
  const headers = splitLine(lines[0]).map(function(h) { return h.replace(/^\ufeff/, '').trim(); });
  const rows = lines.slice(1).map(function(l) { const cols = splitLine(l); const obj = {}; headers.forEach(function(h, i) { obj[h] = (cols[i] || '').trim(); }); return obj; });
  return { headers: headers, rows: rows };
}
async function runPatrol(opts) {
  var mode = opts.mode, config = opts.config, firestore = opts.firestore, storage = opts.storage, batchPath = opts.batchPath;
  var runId = generateRunId(); var startTime = nowIso();
  log('patrol-run-init', { runId: runId, mode: mode });
  if (!batchPath) {
    var batchPrefix = config.readRoots.find(function(r) { return r.includes('input-warehouse'); });
    if (!batchPrefix) throw new Error('No input-warehouse path found in readRoots');
    var candidates = await storage.listObjects(batchPrefix + 'cdms_batches/');
    var csvFiles = candidates.filter(function(f) { return f.endsWith('.csv'); });
    if (csvFiles.length === 0) throw new Error('No batch CSV files found for auto-selection');
    batchPath = csvFiles.sort().pop();
    log('batch-auto-selected', { path: batchPath });
  }
  var batchExists = await storage.objectExists(batchPath);
  if (!batchExists) throw new Error('Gate 1 FAIL: Batch not found at ' + batchPath);
  if (!storage.isInsideRoots(batchPath, config.readRoots)) throw new Error('Gate 1 FAIL: Batch path ' + batchPath + ' is not inside any readRoot');
  var batchRef = batchPath.split('/').pop().replace(/\.csv$/i, '');
  log('gate-1-pass', { batchRef: batchRef, batchPath: batchPath });
  var csvText = await storage.readObject(batchPath);
  var parsed = parseCsv(csvText);
  var headers = parsed.headers; var rows = parsed.rows;
  if (rows.length === 0) throw new Error('Gate 2 FAIL: Batch is empty (0 data rows)');
  if (rows.length > config.maxBatchSize) throw new Error('Gate 2 FAIL: Batch has ' + rows.length + ' rows, exceeds maxBatchSize=' + config.maxBatchSize);
  log('gate-2-pass', { rowCount: rows.length, maxBatchSize: config.maxBatchSize });
  var violators = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]; var srcPath = row.CurrentPath || row.SourcePath || ''; var dstPath = row.ProposedTSI01Path || row.DestinationPath || '';
    if (!srcPath) { violators.push({ rowIndex: i+1, error: 'Missing source path' }); continue; }
    var srcOk = storage.isInsideRoots(srcPath, config.readRoots);
    var dstOk = dstPath ? storage.isInsideRoots(dstPath, config.writeRoots) : true;
    if (!srcOk) violators.push({ rowIndex: i+1, error: 'Source ' + srcPath + ' outside readRoots' });
    if (!dstOk) violators.push({ rowIndex: i+1, error: 'Destination ' + dstPath + ' outside writeRoots' });
  }
  if (violators.length > 0) { logError('gate-3-fail', { violators: violators }); throw new Error('Gate 3 FAIL: ' + violators.length + ' row(s) violate allowlist.'); }
  log('gate-3-pass', { rowCount: rows.length });
  if (mode === 'execute' && config.requireHumanApproval) {
    var approval = await firestore.checkApproval(batchRef);
    if (!approval) throw new Error('Gate 4 FAIL: No APPROVED decision found for batch "' + batchRef + '". Create an approval-receipts document first.');
    log('gate-4-pass', { approvalId: approval.id, approvedBy: approval.approvedBy, timestamp: approval.timestamp });
  } else if (mode === 'dry-run') { log('gate-4-skip', { reason: 'Dry-run mode' }); }
  log('all-gates-passed', { mode: mode, batchRef: batchRef, rowCount: rows.length });
  var findings = []; var rowResults = []; var stopLossTriggered = false; var failCount = 0;
  for (var i = 0; i < rows.length; i++) {
    if (stopLossTriggered) { rowResults.push({ index: i, status: 'SKIPPED_STOP_LOSS', src: rows[i].CurrentPath || '', dst: rows[i].ProposedTSI01Path || '' }); continue; }
    var row = rows[i]; var srcP = row.CurrentPath || row.SourcePath || ''; var dstP = row.ProposedTSI01Path || row.DestinationPath || '';
    var srcName = row.CurrentName || ''; var dstName = row.ProposedName || '';
    var fullSrc = srcName ? srcP + (srcP.endsWith('/') ? '' : '/') + srcName : srcP;
    var fullDst = dstName ? dstP + (dstP.endsWith('/') ? '' : '/') + dstName : dstP;
    try {
      if (mode === 'dry-run') {
        var srcExists = await storage.objectExists(fullSrc);
        var finding = { id: generateFindingId(i+1), runId: runId, rowIndex: i+1, src: fullSrc, dst: fullDst, srcExists: srcExists, status: srcExists ? 'VALID' : 'MISSING_SOURCE', program: 'TSI', created_by: 'tsi-cdms-patrol-sa' };
        findings.push(finding); rowResults.push({ index: i, status: finding.status, src: fullSrc, dst: fullDst, ok: true });
      } else if (mode === 'execute') {
        var srcExists = await storage.objectExists(fullSrc);
        if (!srcExists) { rowResults.push({ index: i, status: 'SKIPPED_MISSING_SOURCE', src: fullSrc, dst: fullDst, ok: false, error: 'Source object missing' }); continue; }
        var moveResult = await storage.moveObject(fullSrc, fullDst);
        rowResults.push({ index: i, status: moveResult.ok ? 'OK' : 'FAIL', src: fullSrc, dst: fullDst, ok: moveResult.ok, error: moveResult.error || null });
        if (!moveResult.ok) { failCount++; if (failCount >= config.stopLoss.maxFailures) { logWarn('stop-loss-triggered', { failCount: failCount, maxFailures: config.stopLoss.maxFailures, atRow: i+1 }); stopLossTriggered = true; } }
      }
    } catch (err) {
      logError('row-error', { rowIndex: i+1, error: err.message });
      rowResults.push({ index: i, status: 'FAIL', src: fullSrc, dst: fullDst, ok: false, error: err.message });
      failCount++; if (config.stopLoss.abortOnPermissionError && err.code === 403) stopLossTriggered = true;
      if (failCount >= config.stopLoss.maxFailures) stopLossTriggered = true;
    }
  }
  var endTime = nowIso();
  var runDoc = { id: runId, mode: mode, batchRef: batchRef, batchPath: batchPath, startTime: startTime, endTime: endTime, gatesPassed: true, totalRows: rows.length,
    results: { ok: rowResults.filter(function(r){return r.ok||r.status==='VALID'}).length, fail: rowResults.filter(function(r){return r.status==='FAIL'}).length, skipped: rowResults.filter(function(r){return r.status.startsWith('SKIPPED')}).length, missingSrc: rowResults.filter(function(r){return r.status==='MISSING_SOURCE'||r.status==='SKIPPED_MISSING_SOURCE'}).length },
    stopLossTriggered: stopLossTriggered, program: 'TSI', created_by: 'tsi-cdms-patrol-sa' };
  await firestore.writePatrolRun(runDoc);
  if (mode === 'dry-run' && findings.length > 0) await firestore.writeFindings(findings);
  var receiptRoot = config.writeRoots.find(function(r) { return r.includes('pipeline-staging'); });
  if (receiptRoot) {
    var ts = nowIso().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    var receiptGcsPath = receiptRoot + 'cdms_receipts/Receipt_' + ts + '_' + mode + '.json';
    var receipt = { runId: runId, mode: mode, batchRef: batchRef, batchPath: batchPath, startTime: startTime, endTime: endTime, gatesPassed: true, totalRows: rows.length, results: runDoc.results, stopLossTriggered: stopLossTriggered,
      rowDetails: rowResults.map(function(r) { return { index: r.index, status: r.status, src: r.src, dst: r.dst, error: r.error || null }; }),
      rollbackPlan: mode === 'execute' ? rowResults.filter(function(r){return r.ok&&r.status==='OK'}).map(function(r){ return { action: 'COPY_DELETE', src: r.dst, dst: r.src, reason: 'Rollback of ' + batchRef }; }) : [] };
    await storage.writeObject(receiptGcsPath, JSON.stringify(receipt, null, 2));
    log('receipt-written', { path: receiptGcsPath });
  }
  return { runId: runId, gatesPassed: true, totalRows: rows.length, findings: findings.length, exceptions: 0, results: runDoc.results };
}
module.exports = { runPatrol: runPatrol, parseCsv: parseCsv };
