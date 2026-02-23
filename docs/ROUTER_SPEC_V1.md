# OpenClaw Router Spec (v1)

> Status: LOCKED for v1. Changes require a version bump and governance review.
> Last updated: 2026-02-22.

---

## 1 — Purpose

The OpenClaw router is the **deterministic first step** of every session. Its only job is to:

1. Validate the incoming structured request against the controlled input schema.
2. Classify the request into exactly one intent from the controlled enum (see `docs/INTENTS_V1.md`).
3. Pass the classified request through the governance gate.
4. Emit a structured router output consumed by the CoS agent for dispatch.

The router is **not** an LLM call. It is a rule-evaluation function. No inference occurs at this layer.
Kimi (LLM) is only invoked after a valid intent is confirmed and the governance gate passes.

---

## 2 — Controlled Input Schema

Every request sent to the router must conform to this structure. Requests that fail validation are rejected immediately — no routing attempt is made.

```json
{
  "request_id": "<string: UUIDv4>",
  "session_id": "<string: UUIDv4 | 'boot_session'>",
  "ts": "<string: ISO-8601 UTC timestamp>",
  "initiator": "<string: 'user' | 'system'>",
  "user_goal": "<string: plain-text description of the request, max 2000 chars>",
  "constraints": {
    "no_public_exposure": true,
    "structured_outputs_only": true,
    "on_demand_only": true,
    "additional": ["<string>"]
  },
  "context": {
    "prior_session_id": "<string | null>",
    "active_tasks": ["<string: task_id>"],
    "tags": ["<string>"]
  }
}
```

**Validation rules:**
- `request_id`, `session_id`, `ts`, `initiator`, `user_goal` are all required and non-empty.
- `user_goal` must be ≤ 2000 characters.
- `initiator` must be exactly `"user"` or `"system"`.
- `constraints.no_public_exposure`, `constraints.structured_outputs_only`, and `constraints.on_demand_only` must all be `true`. Any `false` value is an immediate rejection.

---

## 3 — Deterministic Intent Mapping Rules

Rules are evaluated **top-to-bottom**. First match wins. No fuzzy matching. No LLM involvement.

| # | Condition (keywords / patterns in `user_goal`) | Mapped Intent | Primary Agent |
|---|---|---|---|
| 1 | Contains any of: `risk`, `block`, `approve`, `deny`, `compliance`, `policy`, `control`, `audit`, `gate`, `review risk` | `GOVERNANCE_REVIEW` | governance |
| 2 | Contains any of: `plan`, `route`, `task`, `schedule`, `brief`, `assign`, `orchestrate`, `prioritise`, `prioritize` | `PLAN_WORK` | cos |
| 3 | Contains any of: `sale`, `pipeline`, `qualify`, `prospect`, `script`, `deal`, `revenue`, `close`, `outreach plan` | `SALES_INTERNAL` | sales |
| 4 | Contains any of: `market`, `position`, `brand`, `pr`, `content plan`, `messaging`, `campaign`, `audience`, `publish plan` | `MARKETING_INTERNAL` | marketing_pr |
| 5 | Contains any of: `product`, `offer`, `scope`, `price`, `package`, `roadmap`, `feature`, `requirement`, `spec` | `PRODUCT_OFFER` | product_offer |
| 6 | Contains any of: `sop`, `checklist`, `process`, `procedure`, `ops`, `execute`, `run`, `deploy plan`, `workflow` | `OPS_INTERNAL` | ops |
| 7 | **No rule matched** | `GOVERNANCE_REVIEW` | governance |

> Rule 7 is the mandatory fallback. An unclassifiable request is never dropped silently — it is always escalated to governance for human review.

---

## 4 — Governance Gate Rules

After intent classification, **every request** passes through the governance gate before dispatch. The gate blocks or flags requests that violate non-negotiables.

- **BLOCK — reject immediately, log decision as `deny`:**
  - `constraints.no_public_exposure !== true`
  - `constraints.structured_outputs_only !== true`
  - `constraints.on_demand_only !== true`
  - `user_goal` contains any of: `public api`, `saas`, `vps`, `scale out`, `redis`, `bigquery`, `publish to`, `send email`, `send sms`, `post to` (without an explicit `internal` qualifier)
  - `initiator` is not `"user"` or `"system"`

- **FLAG — allow but force `requires_governance_review = true`, log decision as `approve_with_flag`:**
  - Mapped intent is `GOVERNANCE_REVIEW` (always flagged by definition)
  - `user_goal` contains any of: `external`, `client data`, `security`, `credential`, `key`, `token`, `export`, `architecture change`
  - Any `routing_rule` for the matched intent has `requires_governance_review: true`

- **PASS — dispatch normally, log decision as `approve`:**
  - All block conditions are absent.
  - No flag conditions apply.
  - Intent is `PLAN_WORK` with no flag triggers (the only intent where `requires_governance_review` is `false`).

> All gate outcomes — `deny`, `approve_with_flag`, `approve` — are written to the `decisions` ledger table before any agent is invoked.

---

## 5 — Router Output Schema

On a successful gate pass (or `approve_with_flag`), the router emits this structured object. This is the only input CoS accepts for dispatch.

```json
{
  "router_output_version": "v1",
  "request_id": "<string: echoed from input>",
  "session_id": "<string: echoed from input>",
  "ts_routed": "<string: ISO-8601 UTC timestamp of routing decision>",
  "intent": "<string: one of the 6 controlled intents>",
  "primary_agent": "<string: agent name from registry>",
  "secondary_agents": ["<string>"],
  "requires_governance_review": "<boolean>",
  "gate_decision": "<string: 'approve' | 'approve_with_flag'>",
  "gate_flags": ["<string: flag reason | empty array>"],
  "original_request": {
    "user_goal": "<string>",
    "constraints": {},
    "context": {}
  }
}
```

**Rules:**
- `intent` must be one of the 6 values in `docs/INTENTS_V1.md`. Any other value is a hard error.
- `gate_decision` of `"deny"` never produces a router output — a denial record is written to `decisions` only, and the session is flagged for operator review.
- `router_output_version` must be `"v1"` in all v1 outputs. Version mismatch is a hard reject.

---

## 6 — Non-Negotiables

These rules apply to the router at all times. They cannot be overridden by any agent, user request, or runtime flag.

- **No free-text intents.** Every request maps to one of the 6 controlled intents. No exceptions.
- **Structured outputs only.** The router never emits freeform text. Every output is schema-validated JSON.
- **Log every route, action, and decision.** Three ledger writes occur for every valid routing cycle:
  1. An `actions` row — `type: "route"`, recording the intent classification.
  2. A `decisions` row — recording the gate outcome (`approve` / `approve_with_flag` / `deny`).
  3. (On dispatch) An `actions` row — `type: "dispatch"`, recording which agent was invoked.
- **No LLM at the routing layer.** Kimi is never called to determine intent. Routing is pure rule evaluation.
- **No public endpoints.** The router is an internal function call only — never an HTTP handler, never a public API.
- **Deny-on-ambiguity.** If rule evaluation is ambiguous (e.g. conflicting keyword matches across two intents), fallback to `GOVERNANCE_REVIEW` and flag for human review. Never guess.

---

## 7 — Agent Output Contract

Every agent dispatched by the router **must** return output conforming to its contract file in `agents/contracts/`.

| Agent | Contract file |
|---|---|
| `cos` | `agents/contracts/cos.contract.json` |
| `governance` | `agents/contracts/governance.contract.json` |
| `sales` | `agents/contracts/sales.contract.json` |
| `marketing_pr` | `agents/contracts/marketing_pr.contract.json` |
| `product_offer` | `agents/contracts/product_offer.contract.json` |
| `ops` | `agents/contracts/ops.contract.json` |

**Contract rules:**
- Every agent output must include the `required_fields` listed in the contract: `agent`, `version`, `intent`, `summary`, `outputs`, `ledger_writes`.
- `outputs` must contain only artifact types listed in the agent's `artifact_types_allowed`.
- Any action in `forbidden_outputs` (e.g. `send_email`, `deploy`, `public_publish`) must never appear in an agent output — not as a field, not as a `next_action`, not as a plan step.
- `requires_decision_when` defines gate triggers: if any of these conditions is present in the request context, the agent must emit a `log_decision_request` action and halt before producing final output.
- Structured JSON only — no freeform prose passed downstream.
- Contract version must match registry version (`v1.0`). Mismatch is a hard reject.
