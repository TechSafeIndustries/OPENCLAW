/**
 * Gateway WebSocket Control Plane
 *
 * Listens on WS_CONTROL_PORT (default 18789) for authenticated clients.
 * All inbound messages must be signed with the session JWT from session.ts.
 *
 * Message protocol (JSON over WebSocket):
 *
 *   ┌─ Client → Gateway ──────────────────────────────────────────────────┐
 *   │  { "token": "<JWT>", "cmd": "<command>", "data": { ... } }         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 *   ┌─ Gateway → Client ───────────────────────────────────────────────────┐
 *   │  { "ok": true|false, "cmd": "<command>", "result": { ... },         │
 *   │    "error": "<message if ok=false>" }                                │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Supported commands:
 *   ping             — liveness check
 *   status           — current provider, model, uptime
 *   switch_provider  — data: { provider: 'kimi' | 'gemini', model?: string }
 *   rotate_token     — invalidate & reissue session token
 *   health_check     — run healthCheck() on all providers
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { validateSessionToken, assertTrustedOrigin } from './session';
import { getProvider, checkAllProviders } from '../intelligence/index';
import type { ProviderName } from '../intelligence/index';

const DEFAULT_PORT = 18789;
const START_TIME = Date.now();

// ── Runtime state ────────────────────────────────────────────────────────────

/** Track the currently active provider name so status can report it. */
let currentProviderName: ProviderName =
    (process.env['ACTIVE_AI_PROVIDER'] as ProviderName | undefined) ?? 'gemini';

// ── Helper types ─────────────────────────────────────────────────────────────

interface ControlRequest {
    token: string;
    cmd: string;
    data?: Record<string, unknown>;
}

interface ControlResponse {
    ok: boolean;
    cmd: string;
    result?: unknown;
    error?: string;
}

// ── Command handlers ─────────────────────────────────────────────────────────

function handlePing(): ControlResponse {
    return { ok: true, cmd: 'ping', result: { pong: true, ts: Date.now() } };
}

function handleStatus(): ControlResponse {
    const provider = getProvider(currentProviderName);
    return {
        ok: true,
        cmd: 'status',
        result: {
            provider: provider.name,
            model: provider.model,
            providerKey: currentProviderName,
            uptimeMs: Date.now() - START_TIME,
            nodeEnv: process.env['NODE_ENV'] ?? 'development',
        },
    };
}

function handleSwitchProvider(data?: Record<string, unknown>): ControlResponse {
    const requestedProvider = data?.['provider'] as string | undefined;
    const requestedModel = data?.['model'] as string | undefined;

    if (!requestedProvider || !['gemini', 'kimi'].includes(requestedProvider)) {
        return {
            ok: false,
            cmd: 'switch_provider',
            error: `Invalid provider "${requestedProvider ?? '(none)'}". Valid options: gemini | kimi`,
        };
    }

    const previous = currentProviderName;
    currentProviderName = requestedProvider as ProviderName;

    // Override ACTIVE_AI_PROVIDER so getProvider() picks it up on next call
    process.env['ACTIVE_AI_PROVIDER'] = currentProviderName;

    // If a model override was supplied, set it too
    if (requestedModel) {
        if (currentProviderName === 'kimi') {
            process.env['MOONSHOT_MODEL'] = requestedModel;
        } else if (currentProviderName === 'gemini') {
            process.env['GEMINI_MODEL'] = requestedModel;
        }
    }

    const provider = getProvider(currentProviderName);

    console.log(
        `🔀  Provider switched: ${previous} → ${currentProviderName} (model: ${provider.model})`,
    );

    return {
        ok: true,
        cmd: 'switch_provider',
        result: {
            previous,
            active: currentProviderName,
            model: provider.model,
        },
    };
}

async function handleHealthCheck(): Promise<ControlResponse> {
    await checkAllProviders();
    return {
        ok: true,
        cmd: 'health_check',
        result: { message: 'Health check complete — see server logs for details.' },
    };
}

function handleRotateToken(): ControlResponse {
    // Defer import to avoid circular reference at module level
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rotateSessionToken } = require('./session') as typeof import('./session');
    const newToken = rotateSessionToken();
    return {
        ok: true,
        cmd: 'rotate_token',
        result: { token: newToken },
    };
}

// ── Message dispatcher ───────────────────────────────────────────────────────

async function dispatch(
    req: ControlRequest,
): Promise<ControlResponse> {
    switch (req.cmd) {
        case 'ping':
            return handlePing();
        case 'status':
            return handleStatus();
        case 'switch_provider':
            return handleSwitchProvider(req.data);
        case 'health_check':
            return await handleHealthCheck();
        case 'rotate_token':
            return handleRotateToken();
        default:
            return {
                ok: false,
                cmd: req.cmd,
                error: `Unknown command: "${req.cmd}". Valid commands: ping, status, switch_provider, health_check, rotate_token`,
            };
    }
}

// ── WebSocket server ─────────────────────────────────────────────────────────

export function startControlPlane(port?: number): WebSocketServer {
    const listenPort = port ?? parseInt(
        process.env['WS_CONTROL_PORT'] ?? String(DEFAULT_PORT),
        10,
    );

    const wss = new WebSocketServer({ port: listenPort });

    wss.on('listening', () => {
        console.log(`🔌  Control plane WebSocket listening on ws://127.0.0.1:${listenPort}`);
        console.log('    Connect with: { "token": "<session-token>", "cmd": "ping" }');
    });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const clientIp = req.socket.remoteAddress ?? 'unknown';

        // ── IP allowlist check (before any JWT processing) ──────────────────
        try {
            assertTrustedOrigin(clientIp);
        } catch (err) {
            console.warn(`🚫  Rejected connection from ${clientIp}: ${(err as Error).message}`);
            ws.close(1008, 'IP not permitted'); // 1008 = Policy Violation
            return;
        }

        console.log(`🔗  WS client connected from ${clientIp}`);

        ws.on('message', async (raw: Buffer | string) => {
            let parsed: ControlRequest;
            let response: ControlResponse;

            try {
                parsed = JSON.parse(raw.toString()) as ControlRequest;
            } catch {
                response = { ok: false, cmd: '(parse error)', error: 'Invalid JSON' };
                ws.send(JSON.stringify(response));
                return;
            }

            // ── Authenticate every message ──────────────────────────────────────
            try {
                validateSessionToken(parsed.token ?? '');
            } catch (authErr) {
                response = {
                    ok: false,
                    cmd: parsed.cmd ?? '(auth)',
                    error: `Unauthorised: ${authErr instanceof Error ? authErr.message : String(authErr)}`,
                };
                ws.send(JSON.stringify(response));
                return;
            }

            // ── Dispatch ────────────────────────────────────────────────────────
            try {
                response = await dispatch(parsed);
            } catch (err) {
                response = {
                    ok: false,
                    cmd: parsed.cmd,
                    error: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
                };
            }

            ws.send(JSON.stringify(response));
        });

        ws.on('close', () => {
            console.log(`🔌  WS client disconnected (${clientIp})`);
        });

        ws.on('error', (err: Error) => {
            console.error(`❌  WS client error (${clientIp}):`, err.message);
        });
    });

    wss.on('error', (err: Error) => {
        console.error('❌  Control plane WebSocket error:', err.message);
    });

    return wss;
}
