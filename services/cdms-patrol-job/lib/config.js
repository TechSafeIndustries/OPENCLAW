'use strict';
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { log, logError } = require('./logger');
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tsi-automation';
const SECRET_NAME = process.env.PATROL_CONFIG_SECRET_ID || 'tsi-cdms-patrol-config';
const BLOCKED_WRITE_BUCKETS = ['tsi-automation-ase1-controlled-outputs','tsi-automation-ase1-audit-logs'];
async function loadConfig() {
  const overridePath = process.env.SECRET_OVERRIDE_PATH;
  if (overridePath) { log('config-override', { source: overridePath }); const fs = require('fs'); return validateConfig(JSON.parse(fs.readFileSync(overridePath, 'utf8'))); }
  const client = new SecretManagerServiceClient();
  const name = `projects/${PROJECT_ID}/secrets/${SECRET_NAME}/versions/latest`;
  try { const [version] = await client.accessSecretVersion({ name }); return validateConfig(JSON.parse(version.payload.data.toString('utf8'))); }
  catch (err) { logError('config-load-failed', { error: err.message }); throw new Error(`Cannot load config from Secret Manager: ${err.message}`); }
}
function validateConfig(config) {
  if (!config.version) throw new Error('Config missing version field');
  if (config.version === 'v1') {
    log('config-v1-detected', { message: 'v1 config. Treating allowlistRoots as readRoots.' });
    return { version: 'v1', readRoots: normaliseRoots(config.allowlistRoots || []), writeRoots: [], maxBatchSize: config.maxBatchSize || 10, requireDryRun: config.requireDryRun !== false, requireHumanApproval: config.requireHumanApproval !== false, stopLoss: config.stopLoss || { maxFailures: 3, abortOnPermissionError: true, abortOnUnexpectedRoot: true }, auditRequired: config.auditRequired !== false };
  }
  if (config.version === 'v2') {
    if (!Array.isArray(config.readRoots) || !Array.isArray(config.writeRoots)) throw new Error('v2 config requires readRoots and writeRoots arrays');
    const writeRoots = normaliseRoots(config.writeRoots);
    enforceBlockedBuckets(writeRoots);
    return { version: 'v2', readRoots: normaliseRoots(config.readRoots), writeRoots, maxBatchSize: config.maxBatchSize || 10, requireDryRun: config.requireDryRun !== false, requireHumanApproval: config.requireHumanApproval !== false, stopLoss: config.stopLoss || { maxFailures: 3, abortOnPermissionError: true, abortOnUnexpectedRoot: true }, auditRequired: config.auditRequired !== false };
  }
  throw new Error(`Unsupported config version: ${config.version}`);
}
function normaliseRoots(roots) { return roots.filter(Boolean).map(r => { let n = r.trim(); if (!n.endsWith('/')) n += '/'; return n; }); }
function enforceBlockedBuckets(writeRoots) {
  for (const root of writeRoots) { for (const blocked of BLOCKED_WRITE_BUCKETS) { if (root.includes(blocked)) throw new Error(`BLOCKED: writeRoot "${root}" targets blocked bucket "${blocked}". Patrol cannot write to controlled-outputs or audit-logs. Remove this entry from writeRoots.`); } }
}
module.exports = { loadConfig, validateConfig, BLOCKED_WRITE_BUCKETS };
