# OpenClaw Intent Enum (v1)

> This is the controlled, exhaustive list of valid intents for v1.
> CoS must map every user request to exactly one of these intents before dispatching.
> **No free-text intents. No unlisted intents. No exceptions.**

---

## Valid Intents

| Code | Intent | Primary Agent |
|---|---|---|
| `GOVT` | `GOVERNANCE_REVIEW` | governance |
| `COS` | `PLAN_WORK` | cos |
| `SALES` | `SALES_INTERNAL` | sales |
| `MKT` | `MARKETING_INTERNAL` | marketing_pr |
| `PROD` | `PRODUCT_OFFER` | product_offer |
| `OPS` | `OPS_INTERNAL` | ops |

---

## Rule

> **CoS must map every request to one of these intents. No free-text intents.**

- If a user request cannot be mapped to a listed intent, CoS must return `GOVERNANCE_REVIEW` and flag for human escalation.
- All intents are logged to the `actions` ledger table before dispatch.
- Adding a new intent requires a registry version bump (`v1.x`) and a new row in both `agents/registry_v1.json` and `routing_rules` table.
