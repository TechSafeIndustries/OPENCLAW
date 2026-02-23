#!/usr/bin/env node
/**
 * OpenClaw Gateway — One-Shot WebSocket Command Client
 *
 * Usage:
 *   node scripts/gateway-cmd.js <ws-url> <jwt-token> <command> [data-json]
 *
 * Examples:
 *   node scripts/gateway-cmd.js ws://72.61.151.106:18789 eyJ... ping
 *   node scripts/gateway-cmd.js ws://72.61.151.106:18789 eyJ... status
 *   node scripts/gateway-cmd.js ws://72.61.151.106:18789 eyJ... switch_provider '{"provider":"kimi","model":"moonshot-v1-8k"}'
 */

const { WebSocket } = require('ws');

const [, , url, token, cmd, dataArg] = process.argv;

if (!url || !token || !cmd) {
    console.error('Usage: node scripts/gateway-cmd.js <ws-url> <jwt-token> <command> [data-json]');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/gateway-cmd.js ws://72.61.151.106:18789 eyJ... switch_provider \'{"provider":"kimi","model":"moonshot-v1-8k"}\'');
    process.exit(1);
}

let data;
if (dataArg) {
    try {
        data = JSON.parse(dataArg);
    } catch {
        console.error(`❌  Invalid JSON for data argument: ${dataArg}`);
        process.exit(1);
    }
}

const payload = JSON.stringify({ token, cmd, ...(data ? { data } : {}) });

console.log(`🔌  Connecting to ${url}...`);
const ws = new WebSocket(url);

const timeout = setTimeout(() => {
    console.error('❌  Connection timed out after 10s');
    ws.terminate();
    process.exit(1);
}, 10_000);

ws.on('open', () => {
    console.log(`✅  Connected`);
    console.log(`📤  Sending: ${payload}`);
    ws.send(payload);
});

ws.on('message', (raw) => {
    clearTimeout(timeout);
    let response;
    try {
        response = JSON.parse(raw.toString());
    } catch {
        console.error('❌  Could not parse response:', raw.toString());
        ws.close();
        process.exit(1);
    }

    console.log('');
    if (response.ok) {
        console.log('✅  Gateway response: OK');
        console.log(JSON.stringify(response.result, null, 2));
    } else {
        console.error('❌  Gateway returned error:');
        console.error(response.error);
    }

    ws.close();
    process.exit(response.ok ? 0 : 1);
});

ws.on('error', (err) => {
    clearTimeout(timeout);
    console.error(`❌  WebSocket error: ${err.message}`);
    process.exit(1);
});
