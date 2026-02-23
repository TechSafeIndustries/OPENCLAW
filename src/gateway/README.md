# Gateway Module

Core runtime components for the OpenClaw Enterprise Gateway.

## Components

```
src/gateway/
├── session.ts           # JWT session token generation & validation
└── ws-control-plane.ts  # Authenticated WebSocket command server
```

## Control Plane (WebSocket)

The gateway exposes a JWT-authenticated WebSocket on `WS_CONTROL_PORT` (default **18789**).

### Starting up

When the gateway starts, it prints the session token to stdout:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑  OPENCLAW GATEWAY — SESSION TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Token ID : <jti>
   Expires  : <ISO timestamp>
   Token    : eyJhbGciOiJIUzI1NiJ9...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Copy the token — you'll need it for every WS message.

### Message format

**Request** (client → gateway):
```json
{ "token": "<JWT>", "cmd": "<command>", "data": { } }
```

**Response** (gateway → client):
```json
{ "ok": true, "cmd": "<command>", "result": { } }
{ "ok": false, "cmd": "<command>", "error": "reason" }
```

### Commands

| Command           | Data payload                              | Description                         |
|-------------------|-------------------------------------------|-------------------------------------|
| `ping`            | —                                         | Liveness check                      |
| `status`          | —                                         | Current provider, model, uptime     |
| `switch_provider` | `{ provider: 'kimi'\|'gemini', model? }` | Hot-swap the active AI provider     |
| `health_check`    | —                                         | Run health checks on all providers  |
| `rotate_token`    | —                                         | Invalidate & reissue session token  |

### Quick-connect example (wscat)

```bash
# Install wscat once
npm install -g wscat

# Connect
wscat -c ws://127.0.0.1:18789

# Ping
> {"token":"<paste-token-here>","cmd":"ping"}
< {"ok":true,"cmd":"ping","result":{"pong":true,"ts":1234567890}}

# Switch to Kimi K series
> {"token":"<paste-token-here>","cmd":"switch_provider","data":{"provider":"kimi","model":"moonshot-v1-8k"}}
< {"ok":true,"cmd":"switch_provider","result":{"previous":"gemini","active":"kimi","model":"moonshot-v1-8k"}}

# Check status
> {"token":"<paste-token-here>","cmd":"status"}
< {"ok":true,"cmd":"status","result":{"provider":"Kimi (Moonshot AI)","model":"moonshot-v1-8k",...}}
```

## Security

The control plane enforces two independent layers of protection:

### 1 — IP Allowlist (connection-time)

Before any JWT is inspected, the connecting client's IP is checked against `TRUSTED_CLIENT_IPS`. Connections from unlisted addresses are closed immediately with WebSocket close code **1008 (Policy Violation)** and nothing further is processed.

```dotenv
# .env — comma-separated, IPv4 and/or IPv6
TRUSTED_CLIENT_IPS=203.0.113.42,127.0.0.1,::1
```

> **Tip:** If you're unsure of your current WAN IP, run:
> ```powershell
> Invoke-RestMethod https://ifconfig.me/ip
> ```

IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`) are automatically normalised to their plain IPv4 form, so plain IPv4 entries in `TRUSTED_CLIENT_IPS` work regardless of how the OS reports the address.

### 2 — JWT Authentication (per-message)

Every message payload must carry a valid HS256 JWT issued by this gateway process. The token is validated for:
- Correct **signature** (using `JWT_SECRET`)
- Correct **issuer** (`openclaw-gateway`)
- **Expiry** (`exp` claim)
- **JTI match** — the token must be the one issued at the current process startup; old tokens are rejected after a restart or `rotate_token` call

---

## Environment Variables

| Variable              | Default          | Description                                                  |
|-----------------------|------------------|--------------------------------------------------------------|
| `WS_CONTROL_PORT`     | `18789`          | Port for the WebSocket control plane                         |
| `SESSION_TTL_HOURS`   | `24`             | How long a session token stays valid                         |
| `JWT_SECRET`          | *(ephemeral)*    | HMAC secret for signing tokens — **set this in production!** |
| `TRUSTED_CLIENT_IPS`  | `127.0.0.1,::1`  | Comma-separated list of IPs allowed to open a WS connection  |
