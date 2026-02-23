# OpenClaw — TechSafe Internal Governance Brain (On-Demand)

Internal orchestration layer for TechSafe Industries. Not a SaaS product. Not publicly exposed.

---

## Constraints

- **On-demand only** — no persistent services, no always-on gateway
- **SQLite ledger** — single-file datastore for all sessions, decisions, and audit trails; no Redis, no BigQuery
- **Deterministic routing** — agent dispatch is rule-based and auditable, no probabilistic black-box routing
- **Governance-first gating** — every agent action is logged and gated before execution
- **No SaaS / no public exposure** — internal use by TechSafe operators only; no VPS scaling, no public endpoints
- **Structured outputs only** — all agent responses return typed, schema-validated JSON; no freeform prose passed downstream
- **Kimi is LLM engine only** — OpenClaw controls agent lifecycle, logging, and routing; Kimi provides inference only

---

## Folders

| Folder | Purpose |
|---|---|
| `app/` | Core application logic — orchestrator, session manager, agent dispatcher |
| `db/` | SQLite database files (gitignored) and migration runner |
| `schema/` | SQL migration files applied in order (001_init.sql, 002_…, etc.) |
| `agents/` | Agent registry JSON and individual agent definition files |
| `docs/` | Architecture documents, decision records, and governance specs |
| `tests/` | Unit, integration, and E2E test suites |
| `src/` | TypeScript gateway source (existing Node layer) |
| `config/` | Environment-specific configuration (non-secret values only) |
| `docker/` | Dockerfile variants and compose configs for local dev only |

---

## Status

> v1 scaffolding in progress. No agent logic implemented yet.
