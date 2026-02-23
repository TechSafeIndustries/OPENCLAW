# OpenClaw Architecture — v1

> One-page reference. Last updated: 2026-02-22. Status: scaffold / pre-implementation.

---

## Overview

OpenClaw is a deterministic, governance-first agent orchestration layer. It sits between TechSafe operators and the Kimi LLM inference engine. OpenClaw owns session state, agent dispatch, audit logging, and output validation. Kimi owns inference only.

---

## 1 — SQLite Operational Ledger

All runtime state is persisted in a single SQLite database file (`db/openclaw.db`).

- **Tables (planned):** `sessions`, `messages`, `actions`, `decisions`, `tasks`, `artifacts`, `agents`, `routing_rules`
- One write-ahead log (WAL) per run; no concurrent writers by design
- DB file is gitignored; schema migrations live in `schema/` and are applied in numeric order
- No external datastore (no Redis, no BigQuery, no Postgres) in v1

---

## 2 — Agent Registry Model

Agents are declared statically in `agents/registry_v1.json`.

- Each agent entry specifies: `id`, `name`, `role`, `capabilities[]`, `input_schema`, `output_schema`
- Agents are loaded at orchestrator startup; no dynamic registration in v1
- The registry is the single source of truth for what agents exist and what they can do

---

## 3 — Deterministic Routing

Agent dispatch is rule-based, not probabilistic.

- Routing rules are declared in `agents/registry_v1.json` under `routing_rules[]`
- Each rule maps an intent/trigger pattern to a target agent `id` with an explicit priority order
- The orchestrator evaluates rules top-to-bottom; first match wins
- No LLM is involved in routing decisions; Kimi is called only after an agent is selected and its prompt is assembled

---

## 4 — Governance-First Gating

Every agent action passes through a governance gate before execution.

- Gate checks: schema validation of inputs, routing rule match confirmation, session state validity
- All gate decisions (pass / reject / escalate) are written to the `decisions` ledger table with timestamp and reason
- Structured outputs only: agents must return schema-validated JSON; freeform prose is rejected
- Human escalation path: any gate rejection flags the session for operator review

---

## Non-Goals (v1)

- No real-time streaming or WebSocket agent responses
- No multi-tenant isolation
- No horizontal scaling
- No public API surface
