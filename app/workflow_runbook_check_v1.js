/**
 * OpenClaw — Runbook Preflight Check v1
 * ----------------------------------------
 * Validates the operator environment before any workflow run.
 * Performs three checks in order:
 *
 *   1. Ledger integrity    — node app/verify_ledger.js
 *   2. Kimi auth ping      — node app/models_list_cli_v1.js (chat completion ping)
 *   3. Environment sanity  — shell hint, cwd, key presence (no secrets printed)
 *
 * Does NOT write to the DB. Only calls existing CLIs via spawnSync.
 *
 * Usage:
 *   node app/workflow_runbook_check_v1.js
 *   npm run workflow:runbook-check
 *
 * Output: single JSON object on stdout.
 * Exit 0 = all checks passed.
 * Exit 1 = first failing check (step name + error in JSON).
 *
 * Deps: Node core (child_process, path), dotenv (already in project deps).
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// ── Load .env — must happen before any process.env reads ─────────────────────
// dotenv.config() is safe to call even if MOONSHOT_API_KEY is already set in
// the shell: it will NOT overwrite existing env vars (shell wins).
try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch (_) {
    // dotenv not available — fall through, rely on ambient env
}

const ROOT = path.resolve(__dirname, '..');

// ── Helper: run a node script synchronously and return structured result ──────
function runScript(scriptPath, timeoutMs) {
    timeoutMs = timeoutMs || 30000;

    const result = spawnSync(process.execPath, [scriptPath], {
        cwd: ROOT,
        env: process.env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,  // 2 MB — verify_ledger prints tables
    });

    return {
        status: result.status,
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        spawnErr: result.error ? result.error.message : null,
        timedOut: result.signal === 'SIGTERM',
    };
}

// ── Helper: fatal exit with structured JSON ───────────────────────────────────
function fatal(step, error, extras) {
    process.stdout.write(JSON.stringify(
        Object.assign({ ok: false, step, error }, extras || {}),
        null, 2
    ) + '\n');
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 1: Ledger integrity
// verify_ledger.js prints plain text and ends with "OK: ledger verified"
// ─────────────────────────────────────────────────────────────────────────────
const ledgerScript = path.join(ROOT, 'app', 'verify_ledger.js');
const ledger = runScript(ledgerScript, 15000);

if (ledger.spawnErr) {
    fatal('ledger', `SPAWN_ERROR: ${ledger.spawnErr}`);
}
if (ledger.timedOut) {
    fatal('ledger', 'TIMEOUT: verify_ledger.js did not complete within 15s');
}
if (ledger.status !== 0) {
    fatal('ledger', `EXIT_CODE_${ledger.status}: verify_ledger.js returned non-zero`, {
        stdout: ledger.stdout.slice(0, 500),
        stderr: ledger.stderr.slice(0, 200),
    });
}
if (!ledger.stdout.includes('OK: ledger verified')) {
    fatal('ledger', 'LEDGER_VERIFY_FAILED: expected "OK: ledger verified" in output', {
        stdout_tail: ledger.stdout.slice(-300),
    });
}

// Extract a clean one-line summary (the "OK: ledger verified" line)
const ledgerSummary = ledger.stdout
    .split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('OK:')) || 'OK: ledger verified';

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 2: Kimi auth ping
// models_list_cli_v1.js outputs JSON {ok, base_url, model, test, usage}
// It is async internally but spawnSync captures the full output on exit.
// ─────────────────────────────────────────────────────────────────────────────
const modelsScript = path.join(ROOT, 'app', 'models_list_cli_v1.js');
const models = runScript(modelsScript, 45000);   // live API call — give it 45s

if (models.spawnErr) {
    fatal('kimi_ping', `SPAWN_ERROR: ${models.spawnErr}`);
}
if (models.timedOut) {
    fatal('kimi_ping', 'TIMEOUT: models:list did not complete within 45s (check network/API key)');
}
if (models.status !== 0) {
    // models_list_cli_v1 already prints JSON on stderr/stdout — surface it
    let detail = null;
    try { detail = JSON.parse(models.stdout); } catch (_) {/* ignore */ }
    fatal('kimi_ping', `EXIT_CODE_${models.status}: models:list returned non-zero`, {
        detail: detail || models.stdout.slice(0, 500),
    });
}

let kimiJson = null;
try {
    kimiJson = JSON.parse(models.stdout);
} catch (_) {
    fatal('kimi_ping', 'JSON_PARSE_ERROR: models:list stdout was not valid JSON', {
        raw: models.stdout.slice(0, 500),
    });
}

if (!kimiJson.ok) {
    fatal('kimi_ping', `KIMI_PING_FAILED: ${kimiJson.error || 'ok was false'}`, {
        detail: kimiJson,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 3: Environment sanity — no secrets printed
// ─────────────────────────────────────────────────────────────────────────────

// ── Shell detection — multi-signal, Windows-accurate ─────────────────────────
//
// Signal priority (highest → lowest):
//   1. ComSpec content: most authoritative on Windows.
//      "cmd.exe"      → CMD
//      "powershell.exe" | "pwsh.exe" → PowerShell (rare: PS can set ComSpec)
//   2. PSModulePath present: PS always injects this; cmd.exe does NOT unless
//      a PS session was the ancestor. We only use it as confirmation when
//      ComSpec is absent or ambiguous.
//   3. SHELL / TERM_PROGRAM: Linux/macOS fallback, mostly empty on Windows.
//
// Typical Windows scenarios:
//   CMD window:             ComSpec=C:\Windows\System32\cmd.exe   PSModulePath absent
//   PowerShell window:      ComSpec=C:\Windows\System32\cmd.exe   PSModulePath SET
//   pwsh window:            ComSpec=C:\Windows\System32\cmd.exe   PSModulePath SET
//   PS-launched cmd child:  ComSpec=C:\Windows\System32\cmd.exe   PSModulePath SET  ← tricky
//
// Resolution for the tricky case: PSModulePath present overrides ComSpec=cmd.exe
// because npm.cmd itself is always run via cmd, so ComSpec will always say cmd.exe.
// The only reliable signal that the *user* shell is PS is PSModulePath.
const hasPSModulePath = typeof process.env.PSModulePath === 'string' && process.env.PSModulePath.length > 0;
const comspec = (process.env.ComSpec || '').toLowerCase().replace(/\\/g, '/');
const parentShell = (process.env.SHELL || '').toLowerCase();
const termProgram = (process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || '').toLowerCase();

let shellHint;
if (hasPSModulePath) {
    // PSModulePath is the most reliable Windows signal that PS is in the ancestor chain.
    // comspec will say cmd.exe here because npm always launches via cmd, but the
    // user-facing shell IS PowerShell (or pwsh).
    shellHint = 'PowerShell';
} else if (comspec.includes('cmd.exe')) {
    shellHint = 'CMD';
} else if (comspec.includes('powershell.exe') || comspec.includes('pwsh.exe')) {
    shellHint = 'PowerShell';
} else if (parentShell.includes('bash') || parentShell.includes('zsh') || parentShell.includes('sh')) {
    shellHint = 'Unix-shell';
} else if (termProgram) {
    shellHint = `unknown (TERM_PROGRAM=${termProgram})`;
} else {
    shellHint = 'Unknown';
}

// API key — presence + masked prefix/tail only. Full key NEVER printed.
const rawKey = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || null;
const keyPresent = rawKey !== null && rawKey.trim().length > 0;
const keyPrefix = keyPresent ? rawKey.trim().slice(0, 3) : null;    // e.g. "sk-"
const keyTail = keyPresent ? rawKey.trim().slice(-4) : null;    // e.g. "nwYSQ" → last 4

const env = {
    shell_hint: shellHint,
    cwd: process.cwd(),
    comspec: process.env.ComSpec || null,          // safe — path only, no secrets
    has_psmodulepath: hasPSModulePath,
    kimi_base_url: (process.env.KIMI_BASE_URL || '').trim() || null,
    kimi_model: (process.env.KIMI_MODEL || '').trim() || null,
    api_key_present: keyPresent,
    api_key_prefix: keyPrefix,
    api_key_tail: keyTail,
};

// ─────────────────────────────────────────────────────────────────────────────
// ALL CHECKS PASSED — emit consolidated JSON
// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write(JSON.stringify({
    ok: true,
    checks: {
        ledger: {
            ok: true,
            summary: ledgerSummary,
        },
        kimi: {
            ok: true,
            base_url: kimiJson.base_url,
            model: kimiJson.model,
            test: kimiJson.test,
            usage: kimiJson.usage,
        },
    },
    env,
}, null, 2) + '\n');

process.exit(0);
