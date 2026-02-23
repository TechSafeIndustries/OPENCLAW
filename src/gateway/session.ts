/**
 * Gateway Session Manager
 *
 * Generates a signed JWT session token on startup and validates inbound
 * WebSocket connection tokens. The token is logged at startup so it can
 * be copied from console or log files.
 *
 * Token lifecycle:
 *   - Generated once per process start
 *   - Valid for SESSION_TTL_HOURS (default 24h)
 *   - Verified on every WS connection handshake
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface SessionPayload {
    iss: string;       // issuer: 'openclaw-gateway'
    iat: number;       // issued-at (epoch seconds)
    exp: number;       // expiry  (epoch seconds)
    jti: string;       // unique token ID
    scope: string[];   // granted permissions
}

const ISSUER = 'openclaw-gateway';
const DEFAULT_TTL_HOURS = 24;

/**
 * Holds the single active session token for this process lifetime.
 */
let activeToken: string | null = null;
let activeJti: string | null = null;

function getJwtSecret(): string {
    const secret = process.env['JWT_SECRET'];
    if (!secret || secret === 'your-jwt-secret-key-here') {
        // Auto-generate an ephemeral secret if none is configured
        const ephemeral = crypto.randomBytes(48).toString('hex');
        console.warn(
            '⚠️  JWT_SECRET not set — using ephemeral secret for this session only.',
        );
        return ephemeral;
    }
    return secret;
}

/**
 * Generate (or return the cached) session token.
 * Call once at startup; the token is stable for the process lifetime.
 */
export function generateSessionToken(): string {
    if (activeToken) return activeToken;

    const secret = getJwtSecret();
    const ttlHours = parseInt(
        process.env['SESSION_TTL_HOURS'] ?? String(DEFAULT_TTL_HOURS),
        10,
    );

    const jti = crypto.randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    const payload: SessionPayload = {
        iss: ISSUER,
        iat: now,
        exp: now + ttlHours * 3600,
        jti,
        scope: ['provider:read', 'provider:write', 'gateway:admin'],
    };

    activeToken = jwt.sign(payload, secret, { algorithm: 'HS256' });
    activeJti = jti;

    const expiresAt = new Date((now + ttlHours * 3600) * 1000).toISOString();

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑  OPENCLAW GATEWAY — SESSION TOKEN');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Token ID : ${jti}`);
    console.log(`   Expires  : ${expiresAt}`);
    console.log(`   Token    : ${activeToken}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    return activeToken;
}

/**
 * Validate a token string supplied by a connecting WS client.
 * Returns the decoded payload on success, throws on failure.
 */
export function validateSessionToken(token: string): SessionPayload {
    const secret = getJwtSecret();

    let decoded: jwt.JwtPayload;
    try {
        decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            issuer: ISSUER,
        }) as jwt.JwtPayload;
    } catch (err) {
        throw new Error(
            `Token validation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // Extra check: must match the active jti (rejects old tokens after restart)
    if (decoded['jti'] !== activeJti) {
        throw new Error('Token JTI does not match active session — please use the current startup token');
    }

    return decoded as unknown as SessionPayload;
}

/**
 * Revoke the current session token (forces reconnect with new token).
 * Returns the freshly generated replacement token.
 */
export function rotateSessionToken(): string {
    console.log('🔄  Session token rotated — existing connections will need to re-authenticate.');
    activeToken = null;
    activeJti = null;
    return generateSessionToken();
}

// ── Trusted-origin allowlist ─────────────────────────────────────────────────

/**
 * Comma-separated list of trusted client IPs that may initiate the WS handshake.
 * Supports both IPv4 and IPv6 literals, and IPv4-mapped IPv6 (::ffff:x.x.x.x).
 *
 * Set via environment variable, e.g.:
 *   TRUSTED_CLIENT_IPS=203.0.113.42,127.0.0.1,::1
 *
 * Defaults to loopback only if the variable is unset.
 */
function getTrustedIps(): Set<string> {
    const raw = process.env['TRUSTED_CLIENT_IPS'] ?? '127.0.0.1,::1';
    return new Set(
        raw.split(',').map((ip) => ip.trim()).filter(Boolean),
    );
}

/**
 * Normalise an IPv4-mapped IPv6 address (::ffff:1.2.3.4) down to its plain
 * IPv4 form so it matches entries in TRUSTED_CLIENT_IPS like `1.2.3.4`.
 */
function normaliseIp(ip: string): string {
    const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return v4mapped ? (v4mapped[1] ?? ip) : ip;
}

/**
 * Throws if `remoteIp` is not in the trusted allowlist.
 * Call this at WS connection time, before any JWT processing.
 */
export function assertTrustedOrigin(remoteIp: string | undefined): void {
    const ip = normaliseIp(remoteIp ?? '');
    const trusted = getTrustedIps();
    if (!trusted.has(ip)) {
        throw new Error(
            `Connection from untrusted IP [${ip}] rejected. ` +
            `Add it to TRUSTED_CLIENT_IPS to allow access.`,
        );
    }
}
