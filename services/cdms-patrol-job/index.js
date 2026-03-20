'use strict';

const { loadConfig } = require('./lib/config');
const { createFirestoreClient } = require('./lib/firestore');
const { createStorageClient } = require('./lib/storage');
const { runPatrol } = require('./lib/patrol');
const { log, logError } = require('./lib/logger');

const EXIT_SUCCESS = 0;
const EXIT_CONFIG_FAILURE = 1;
const EXIT_GATE_FAILURE = 2;
const EXIT_APPROVAL_MISSING = 3;
const EXIT_STORAGE_FAILURE = 4;
const EXIT_UNEXPECTED = 9;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { args[key] = argv[i + 1]; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'dry-run';
  const batchPath = args.batch || null;

  const firestoreDb = process.env.FIRESTORE_DATABASE_ID;
  if (!firestoreDb) {
    logError('missing-env', { variable: 'FIRESTORE_DATABASE_ID', message: 'Must be set explicitly. Use "(default)" or "tsi-dev".' });
    process.exit(EXIT_CONFIG_FAILURE);
  }
  if (!['(default)', 'tsi-dev'].includes(firestoreDb)) {
    logError('invalid-env', { variable: 'FIRESTORE_DATABASE_ID', value: firestoreDb, message: 'Must be "(default)" or "tsi-dev".' });
    process.exit(EXIT_CONFIG_FAILURE);
  }
  if (!['dry-run', 'execute'].includes(mode)) {
    logError('invalid-mode', { mode, message: 'Use --mode dry-run or --mode execute' });
    process.exit(EXIT_CONFIG_FAILURE);
  }

  log('patrol-start', { mode, firestoreDb, batchPath: batchPath || 'auto-select', projectId: process.env.GCP_PROJECT_ID || 'tsi-automation', timestamp: new Date().toISOString() });

  try {
    const config = await loadConfig();
    log('config-loaded', { version: config.version, readRoots: config.readRoots.length, writeRoots: config.writeRoots.length, maxBatchSize: config.maxBatchSize });

    const firestore = createFirestoreClient(firestoreDb);
    const storage = createStorageClient();

    const result = await runPatrol({ mode, config, firestore, storage, batchPath });
    log('patrol-complete', { mode, runId: result.runId, gatesPassed: result.gatesPassed, totalRows: result.totalRows, findings: result.findings, exceptions: result.exceptions });

    if (!result.gatesPassed) process.exit(EXIT_GATE_FAILURE);
    if (result.results && result.results.fail > 0) process.exit(EXIT_STORAGE_FAILURE);
    process.exit(EXIT_SUCCESS);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Cannot load config')) { logError('config-failure', { error: msg }); process.exit(EXIT_CONFIG_FAILURE); }
    if (msg.includes('Gate') && msg.includes('FAIL')) { logError('gate-failure', { error: msg }); process.exit(EXIT_GATE_FAILURE); }
    if (msg.includes('No APPROVED decision')) { logError('approval-missing', { error: msg }); process.exit(EXIT_APPROVAL_MISSING); }
    if (msg.includes('BLOCKED')) { logError('blocked-write', { error: msg }); process.exit(EXIT_STORAGE_FAILURE); }
    logError('patrol-fatal', { error: msg, stack: err.stack });
    process.exit(EXIT_UNEXPECTED);
  }
}

main();
