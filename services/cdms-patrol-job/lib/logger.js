'use strict';

function log(event, data = {}) {
  const entry = { severity: 'INFO', event, timestamp: new Date().toISOString(), ...data };
  console.log(JSON.stringify(entry));
}

function logWarn(event, data = {}) {
  const entry = { severity: 'WARNING', event, timestamp: new Date().toISOString(), ...data };
  console.log(JSON.stringify(entry));
}

function logError(event, data = {}) {
  const entry = { severity: 'ERROR', event, timestamp: new Date().toISOString(), ...data };
  console.error(JSON.stringify(entry));
}

module.exports = { log, logWarn, logError };
