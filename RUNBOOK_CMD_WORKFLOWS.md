# OpenClaw — Operator Runbook: CMD Workflows

> **Workflow index**
>
> | npm script | Purpose | Section |
> |---|---|---|
> | `workflow:runbook-check` | **Run this first** — preflight: ledger + Kimi ping + env sanity | §0 |
> | `workflow:founder-sales-draft` | Founder sales draft (SALES_INTERNAL → sales agent) | §1 |
> | `workflow:founder-marketing-draft` | Founder marketing draft (MARKETING_INTERNAL → marketing_pr agent) | §5 |
> | `workflow:governance-triage` | **Execution loop** — pop oldest TODO, run OpenClaw, retrieve artefact | §6 |
> | `workflow:task-close` | **Close loop** — transition doing → done, write task_close audit action | §7 |
> | `tasks:stop-loss` | **Stop-loss CLI** — mark task blocked, write stop_loss audit action | §8 |
> | `workflow:human-review` | **Human review** — governance override: review → retry\|close\|reject a stop-lossed task | §9 |
> | `tasks:policy-gate` | **Policy gate CLI** — mark task blocked with `hil_required=true`, write `policy_gate` audit action | §10 |
> | `workflow:policy-show` | **Policy Ops** — print current autonomy policy as JSON (read-only) | §11 |
> | `workflow:policy-validate` | **Policy Ops** — deep-validate autonomy policy against locked enum + range checks (read-only) | §11 |
> | `stack:check` | **Stack Check** — consolidated health check: runbook + policy + triage dry-run | §12 |

> **⚠️ SHELL WARNING — Read first**
>
> Our canonical operator shell is **CMD** (`cmd.exe`).
> All commands in this runbook are written for CMD unless a section is explicitly labelled `[PowerShell]`.
>
> **Do NOT run CMD commands in PowerShell.**  The argument quoting, `&&` behaviour, and `%VAR%` expansion
> are ALL different.  Mixing shells is the #1 source of paste errors in this repo.
>
> | Shell      | Env var syntax | Separator | Arg quote |
> |------------|---------------|-----------|-----------|
> | CMD        | `%VAR%`        | `&&`      | `"`       |
> | PowerShell | `$env:VAR`     | `;`       | `'` or `"` |
>
> If you are in PowerShell and cannot switch, prefix every command with `cmd /c "..."`.

---

---

## 0. Preflight — Run This Before Every Workflow

```cmd
npm run workflow:runbook-check
```

This single command performs three checks in order:

| Step | What it checks | Pass condition |
|------|---------------|----------------|
| `ledger` | `verify_ledger.js` — opens DB, counts rows, prints recent entries | Exit 0 + output contains `OK: ledger verified` |
| `kimi_ping` | `models_list_cli_v1.js` — sends one chat completion to Moonshot API | JSON `ok: true` + `usage.total_tokens > 0` |
| `env` | Shell hint, cwd, API key presence (masked) | Informational only — never fails the command |

**On success** — prints one consolidated JSON block:
```json
{
  "ok": true,
  "checks": {
    "ledger": { "ok": true, "summary": "OK: ledger verified" },
    "kimi":   { "ok": true, "base_url": "...", "model": "...", "usage": {...} }
  },
  "env": {
    "shell_hint": "CMD | PowerShell | Unix-shell | Unknown",
    "cwd": "C:\\...",
    "kimi_base_url": "https://api.moonshot.ai/v1",
    "kimi_model": "...",
    "api_key_present": true,
    "api_key_prefix": "sk-",
    "api_key_tail": "XXXX"
  }
}
```

**On failure** — prints `{ ok:false, step:"ledger|kimi_ping", error:"..." }` and exits with code 1.

> **Shell detection** uses three signals in priority order:
> 1. `PSModulePath` (present ⟹ PowerShell ancestor — most reliable Windows signal)
> 2. `ComSpec` content (`cmd.exe` ⟹ CMD; `powershell.exe`/`pwsh.exe` ⟹ PowerShell)
> 3. `SHELL` / `TERM_PROGRAM` (Unix fallback)
>
> `comspec` in the output shows the raw `ComSpec` path (executable only, no secrets).
> `has_psmodulepath` shows whether `PSModulePath` was present in this process's env.
>
> **Why `shell_hint` may say `PowerShell` even when you ran `cmd /c`:** `cmd /c` creates a CMD child process but inherits the parent's `PSModulePath`. Only a fresh CMD window launched from Start Menu / `Win+R` will have `PSModulePath=absent`. If `shell_hint=PowerShell` appears when you expected CMD, it means your terminal session has a PowerShell ancestor — switch to a standalone CMD window for strict CMD discipline.

---

## 1. Standard Sequence — Founder Sales Draft (with `--no-stub`)

Run these in order, **one at a time**, in a CMD shell opened at the repo root:

```cmd
REM ── PRE-FLIGHT ──────────────────────────────────────────────────
npm run verify:ledger

REM ── KIMI AUTH PING (chat completion, not /models list) ─────────
npm run models:list

REM ── MAIN RUN ────────────────────────────────────────────────────
npm run openclaw:run -- requests/sales_draft.json --founder --new-session
REM  ↑ Capture the "session_id" from the printed JSON. Call it NEW_SESSION_ID.

REM ── FETCH LATEST NON-STUB ARTIFACT ──────────────────────────────
npm run artifacts:latest -- NEW_SESSION_ID --no-stub

REM ── POP NEXT NON-STUB TASK (assigns owner "cos") ────────────────
npm run tasks:next -- NEW_SESSION_ID --no-stub --owner cos

REM ── INSPECT THE POPPED TASK ─────────────────────────────────────
npm run tasks:get -- TASK_ID
REM  ↑ Replace TASK_ID with the "task.id" value from tasks:next output.
```

> **Shortcut:** run everything at once with the workflow runner:
> ```cmd
> npm run workflow:founder-sales-draft
> ```
> This does steps 3-5 automatically and outputs one consolidated JSON with session_id, artifact, and task.

### Options you can pass to the workflow runner

| Flag | Effect |
|------|--------|
| `--kimi-stub` | No live API call; uses deterministic stub response (safe for CI/smoke tests) |
| `--owner <name>` | Override the task owner (default: `cos`) |
| `--dry-run` | Print the commands that would run, then exit without writing anything |

---

## 2. Known Failure Modes

### 2.1 CMD Concatenated Paste Error

**Symptom:** You paste multiple lines at once into CMD and get garbled output or the wrong command runs.

**Cause:** CMD does not support multi-line paste safely.  Pasting a block of commands may concatenate them, break quoting, or skip lines silently.

**Fix:** Paste and execute **one line at a time**.  Never paste a block into a CMD window.

---

### 2.2 npm Argument Forwarding Rules

**How it works:** `npm run <script> -- <args>` forwards everything after the `--` separator to the underlying `node` script.

```
npm run tasks:next -- sess_xyz --no-stub --owner cos
          ↓
node app/tasks_next_cli_v1.js sess_xyz --no-stub --owner cos
```

**Common mistakes:**

| Wrong | Right | Why it fails |
|-------|-------|-------------|
| `npm run tasks:next sess_xyz` | `npm run tasks:next -- sess_xyz` | Without `--`, `sess_xyz` is treated as an npm flag, not forwarded |
| `npm run tasks:next --no-stub` | `npm run tasks:next -- --no-stub` | Same — `--no-stub` goes to npm, not to the script |
| `npm run openclaw:run requests/file.json` | `npm run openclaw:run -- requests/file.json` | File path swallowed by npm |

**Rule:** Every positional argument and every `--flag` you want the script to see **must** come after `--`.

---

### 2.3 `models:list` Is a Chat Ping, NOT a `/v1/models` Call

`npm run models:list` sends a single `chat.completions.create` call with `messages: [{role:"user", content:"ping"}]` and `max_tokens: 1`.

It does **not** call `GET /v1/models`.  Moonshot AI returns `404 url.not_found` on that endpoint.

**Success indicator:** `"ok": true` with `usage.total_tokens > 0`.

**This command verifies:**  (a) API key is valid, (b) model name is accepted, (c) network route is open.

---

### 2.4 401 vs 404 from Moonshot API

| Code | Meaning | Fix |
|------|---------|-----|
| `401 Unauthorized` | API key is wrong, expired, or not set | Rotate key; set `MOONSHOT_API_KEY` in `.env` and reload shell |
| `404 url.not_found` | You called a Moonshot endpoint that doesn't exist (e.g. `GET /v1/models`) | This is expected for `/models`; use `models:list` (chat ping) instead |
| `429 Too Many Requests` | Rate limit | Wait, then retry; do not loop without backoff |
| `500 Internal Server Error` | Moonshot-side issue | Retry once; if persistent, check `status.moonshot.ai` |

---

### 2.5 `MISSING_SESSION_ID` on `tasks:purge-stub`

```
{ "ok": false, "error": "MISSING_SESSION_ID: ..." }
```

**Cause:** The session_id was not forwarded through npm's `--` separator, or the old `--` delimiter form was used without the session_id after it.

**Fix:**
```cmd
npm run tasks:purge-stub -- founder_draft_session --owner cos
REM                      ^^                    ^^ positional arg, no delimiter needed
```

Both forms are accepted: `-- SESSION_ID` (delimiter) and `SESSION_ID` (bare positional).

---

### 2.6 LLM Response Fails Contract Validation

**Symptom:** `dispatch.state == "REJECTED"`, `repair_attempted: true`, `repair_succeeded: false`.

**Cause:** Kimi's response (or the repair attempt) did not conform to the agent contract (`required_fields`, `outputs` shape, `ledger_writes` array, `summary` length).

**Fix:** Re-run the command.  Contract validation is deterministic; the LLM response is not.  A fresh call often produces a compliant response.  If it fails repeatedly, check the agent contract file at `agents/contracts/<agent>.contract.json`.

---

### 2.7 `artifact:null` Due to Write Timing

**Symptom:** `artifacts:latest --no-stub` returns `artifact: null` even though `openclaw:run` just produced an artifact.

**Cause:** All dispatch-created artifacts are tagged `["stub","dispatch"]` by `dispatch_v1.js` regardless of `KIMI_MODE`. The `--no-stub` filter excludes them. This is by design — the artifact tag tracks *origin*, not content quality.

**Behaviour in workflow runners:** Both `workflow:founder-sales-draft` and `workflow:founder-marketing-draft` include a single automatic retry:

```
Attempt 1 → artifacts:latest SESSION_ID --no-stub
If artifact is null:
    Wait 1000ms (Atomics.wait — synchronous, not a poll loop)
Attempt 2 → artifacts:latest SESSION_ID --no-stub
If still null → keep artifact:null, do NOT fail the workflow
```

The output JSON always includes:
- `artifact_attempts: 1 | 2` — how many attempts were made
- `artifact_retry_used: true | false` — whether the retry fired
- `artifact_retry_delay_ms: 1000` — the exact delay constant

**Why `artifact:null` is not a failure:** The real artifact content is always accessible via `artifacts:latest SESSION_ID` (without `--no-stub`). The stub tag is an origin marker, not a quality gate.

---

## 3. Session Hygiene

### When to run `tasks:purge-stub`

Run this command when a session's task queue contains stub tasks (created by `KIMI_MODE=stub` runs or by first-pass LLM calls that produced stub next_actions) and you want to clear them before starting real work.

**Stub tasks are identified by:** `meta_json.source == "stub"` with `status IN ('todo','doing')`.

**What it does:** Marks qualifying tasks `status = done`.  Does NOT delete rows.  Writes one audit action row of `type = "tasks_purge_stub"`.

```cmd
npm run tasks:purge-stub -- FOUNDER_DRAFT_SESSION --owner cos
```

### When NOT to run `tasks:purge-stub`

- On a session with live (non-stub) tasks in `todo` or `doing` — those will not be touched (the command only acts on `meta_json.source == "stub"`), but confirm first with `tasks:list`.
- On production sessions without reviewing `tasks:list` output first.

### Session ID discipline

| Scenario | Recommended approach |
|----------|---------------------|
| Fresh exploratory run | `--new-session` on `openclaw:run` — generates `sess_<timestamp>` |
| Repeating a fixed session | Use the hardcoded `session_id` in the request file (e.g. `founder_draft_session`) |
| Recurring workflow run | Use `workflow:founder-sales-draft` — always forces `--new-session` |
| CI/automation | Set `KIMI_MODE=stub` and use `workflow:founder-sales-draft --kimi-stub` |

### Checking what's in a session's queue

```cmd
REM List all tasks (any status) for a session:
npm run tasks:list -- SESSION_ID

REM Pop the next non-stub todo task:
npm run tasks:next -- SESSION_ID --no-stub --owner cos
```

### How `--no-stub` works

`--no-stub` is an **explicit opt-in filter**.  It is NOT a default.

- On `tasks:next`: excludes tasks where `meta_json LIKE '%"source":"stub"%'`
- On `artifacts:latest` / `artifacts:list`: excludes artifacts where `tags_json LIKE '%"stub"%'`

**All dispatch-created artifacts carry `tags_json: ["stub","dispatch"]`** regardless of `KIMI_MODE`.  This is by design — the artifact content may be real Kimi output, but the tag marks its origin.  Use `artifacts:latest SESSION_ID` (without `--no-stub`) to retrieve the actual artifact content.

> **Retry note:** `artifacts:latest` in workflow runners includes a single retry (1000ms wait) to mitigate timing edge cases. Still no stubs — both attempts use `--no-stub`. No loops, no polling. See §2.7.

---

## 4. Quick Reference Card

```
PREFLIGHT                npm run workflow:runbook-check

VERIFY LEDGER            npm run verify:ledger
AUTH PING                npm run models:list

SALES WORKFLOW           npm run workflow:founder-sales-draft
  (stub LLM)             npm run workflow:founder-sales-draft -- --kimi-stub
  (dry run)              npm run workflow:founder-sales-draft -- --dry-run

MARKETING WORKFLOW       npm run workflow:founder-marketing-draft
  (stub LLM)             npm run workflow:founder-marketing-draft -- --kimi-stub
  (dry run)              npm run workflow:founder-marketing-draft -- --dry-run

RUN ONLY (sales)         npm run openclaw:run -- requests/sales_draft.json --founder --new-session
RUN ONLY (marketing)     npm run openclaw:run -- requests/marketing_draft.json --founder --new-session
ARTIFACT (no-stub)       npm run artifacts:latest -- SESSION_ID --no-stub
TASK POP (no-stub)       npm run tasks:next -- SESSION_ID --no-stub --owner cos
TASK GET                 npm run tasks:get -- TASK_ID
PURGE STUBS              npm run tasks:purge-stub -- SESSION_ID --owner cos
```

---

## 5. Founder Marketing Draft Workflow

### Purpose

Produces an internal **marketing/PR content draft** (LinkedIn post + email follow-up brief) for TechSafeAI positioning using the `marketing_pr` agent via `MARKETING_INTERNAL` routing.

All rules from Section 1 apply. The request uses `risk_flags.external_comms: true` — Founder Mode auto-allows because `external_comms` is the only truthy flag and the intent is `MARKETING_INTERNAL`.

### Standard sequence (CMD)

```cmd
REM ── PRE-FLIGHT ──────────────────────────────────────────────────
npm run verify:ledger
npm run models:list

REM ── MAIN RUN ────────────────────────────────────────────────────
npm run openclaw:run -- requests/marketing_draft.json --founder --new-session
REM  ↑ Capture the "session_id" from the printed JSON. Call it NEW_SESSION_ID.

REM ── FETCH LATEST NON-STUB ARTIFACT ──────────────────────────────
npm run artifacts:latest -- NEW_SESSION_ID --no-stub

REM ── POP NEXT NON-STUB TASK (assigns owner "cos") ────────────────
npm run tasks:next -- NEW_SESSION_ID --no-stub --owner cos

REM ── INSPECT THE POPPED TASK ─────────────────────────────────────
npm run tasks:get -- TASK_ID
```

> **Shortcut:**  `npm run workflow:founder-marketing-draft`

### Routing — what triggers `MARKETING_INTERNAL`

The router matches on these keywords in `user_goal` (first match wins):
`market`, `position`, `brand`, `pr`, `content plan`, `messaging`, `campaign`, `audience`, `publish plan`

`marketing_draft.json` uses the phrase **"content plan"** and **"messaging"** — deterministic match.

### Agent contract

| Field | Value |
|---|---|
| Agent | `marketing_pr` |
| Contract | `agents/contracts/marketing_pr.contract.json` |
| Artifact types allowed | `script`, `email_draft`, `sequence`, `positioning`, `content_plan`, `pr_brief`, `brand_check`, `message_framework` |
| Forbidden outputs | `public_publish`, `send_email`, `deploy`, `create_public_endpoint`, `send_sms`, `post_to_social` |

### Session hygiene for marketing runs

Marketing draft requests include no hardcoded `session_id` — the CLI auto-generates `sess_<timestamp>` on every run.
If stub tasks accumulate, purge them:
```cmd
npm run tasks:purge-stub -- NEW_SESSION_ID --owner cos
```

---

## 6. Governance Triage Workflow

> **Command:** `npm run workflow:governance-triage`
>
> This is the **execution** workflow (not draft-only). It pops the oldest real TODO task, runs OpenClaw to produce an artefact, and preserves the full audit trail.

### When to use

- You have accumulated TODO tasks (from `tasks:list`) that need to be worked
- You want to advance the governance queue without manually identifying which task to do next
- Routine operational triage of outstanding governance items

### Prerequisites

1. Run preflight first: `npm run workflow:runbook-check` — must be `ok:true`
2. Non-stub TODO tasks must exist: `npm run tasks:oldest -- --no-stub`

### Command forms

```cmd
REM Standard triage — auto-creates session, pops oldest TODO
npm run workflow:governance-triage

REM With explicit owner (default: cos)
npm run workflow:governance-triage -- --owner cos

REM Dry-run — shows what WOULD be popped, no state changes
npm run workflow:governance-triage -- --dry-run

REM Operate within a specific session only
npm run workflow:governance-triage -- --session sess_1234567890
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--owner <agent>` | `cos` | Owner written to the popped task's `owner_agent` column |
| `--session <id>` | auto | Use existing session; omit to create a new triage session via `openclaw:run` |
| `--dry-run` | off | Steps 0–2 only (preflight + session + peek). No pops. No openclaw:run. Prints `would_pop_task`. |

### Six-step flow

```
[0] Preflight     workflow:runbook-check               exit 1 if ok:false
[1] Session       openclaw:run governance_triage.json  creates triage session OR uses --session
[2] Find work     tasks:oldest --no-stub               peek: oldest non-stub TODO across all sessions
                                                        → if null: output ok:true,task:null, stop
[3] Pop           tasks:next <session> --no-stub        todo → doing, writes 2 action rows (ATOMIC)
[4] Execute       openclaw:run <runtime_request>        writes temp JSON to requests/_runtime/ (gitignored)
                                                         deletes temp file immediately after run
[5] Retrieve      artifacts:latest <session> --no-stub  1 retry (1000ms Atomics.wait) if null
[6] Output        consolidated JSON
```

> **Note on session scoping:** The `work_session_id` is taken from the **task's own session**, not from the triage init session. This ensures `tasks:next` pops correctly and all artefacts link to the right session.

### Output shape

```json
{
  "ok": true,
  "owner": "cos",
  "session_id": "<task_session>",
  "triage_session_id": "<triage_init_session>",
  "task": { "id": "...", "title": "...", "status": "doing", ... },
  "task_audit": {
    "task_update_action_id": "task_update_...",
    "task_next_action_id":   "task_next_..."
  },
  "run": {
    "status": "OK",
    "run_id": "...",
    "intent": "GOVERNANCE_REVIEW",
    "dispatch_state": "GATED | DISPATCHED | BLOCKED",
    "agent": "governance",
    "artifact_id": "..."
  },
  "artifact": { ... } | null,
  "artifact_attempts": 1 | 2,
  "artifact_retry_used": true | false,
  "artifact_retry_delay_ms": 1000,
  "notes": [ ... ]
}
```

**Empty queue output** (`task: null`):
```json
{ "ok": true, "owner": "cos", "session_id": "...", "task": null, "run": null, "artifact": null, "artifact_attempts": 0, "notes": [...] }
```

### Audit trail confirms

After a successful triage run, the following ledger writes occur (all via existing CLIs — the workflow does **not** write to DB directly):

| CLI | Ledger writes |
|---|---|
| `openclaw:run` (init session) | `sessions`, `messages` (router I/O), `actions` (route, dispatch), `decisions` |
| `tasks:next` | `tasks` (status `todo → doing`), 2 × `actions` (`task_update`, `task_next`) — single atomic txn |
| `openclaw:run` (task exec) | `sessions`, `messages`, `actions` (dispatch), `artifacts` (if Kimi call succeeds) |

Verify audit trail after a run:
```cmd
npm run decisions:list -- TRIAGE_SESSION_ID
npm run tasks:list -- WORK_SESSION_ID --status doing
```

### Failure modes

| Failure | Step | Behaviour |
|---|---|---|
| Preflight fails | `preflight` | Hard exit 1 — fix environment first |
| Init session dispatch fails | `triage_session_init` | Hard exit 1 (`EXIT_CODE_*` or JSON parse error) |
| No non-stub TODO found | step 2 | `ok:true, task:null` — not an error |
| Task claimed between peek and pop | step 3 | `ok:true, task:null` — safe, retry triage next cycle |
| Kimi auth missing in child env | `openclaw_run_task` | Hard exit 1 — ensure `MOONSHOT_API_KEY` is set (`.env` must exist) |
| Artefact null after 2 attempts | step 5 | `ok:true, artifact:null` — task was popped, run registered; artefact accessible via `artifacts:latest SESSION_ID` |

---

## 7. Task Close Workflow

> **Command:** `npm run workflow:task-close -- <task_id> --reason "<text>" [options]`
>
> Completes the triage → execute → **close** loop. Transitions a `doing` task to `done`, writes a structured closure metadata block into `meta_json`, and inserts a `task_close` audit action (distinct from `task_update`).

### When to use

- A task has been triaged (`doing`) and the work is complete
- You want to formally record the closure reason and link to a producing artefact
- Routine governance queue hygiene after reviewing `workflow:governance-triage` output

### Command forms

```cmd
REM Standard close (infer session from task record)
npm run workflow:task-close -- task_XXXX --reason "Completed draft artefact" --owner cos

REM Close with linked artefact
npm run workflow:task-close -- task_XXXX --reason "Completed draft artefact" --owner cos --artifact art_YYYY

REM Dry-run — show what WOULD change, no DB writes
npm run workflow:task-close -- task_XXXX --reason "Completed draft artefact" --dry-run

REM Override session (rarely needed)
npm run workflow:task-close -- task_XXXX --reason "..." --session sess_ZZZZ
```

> ⚠️ **Quoting in CMD:** Wrap `--reason` value in double-quotes. In PowerShell, use single-quotes or escaped double-quotes.

### Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `<task_id>` | ✅ | — | Task to close (must be positional, before flags) |
| `--reason <text>` | ✅ | — | Closure reason, max 240 chars |
| `--owner <agent>` | — | `cos` | Closed-by agent, written to `meta_json.closed_by` |
| `--artifact <id>` | — | `null` | Artefact ID to link; written to `meta_json.closed_artifact_id` |
| `--session <id>` | — | inferred | Override session for the audit action row |
| `--dry-run` | — | off | Validate + show would-change; do NOT write to DB |

### Two-step flow

```
[1] tasks:get <task_id>       Read task, confirm status = doing  → ok:false + exit 1 if not doing
[2] tasks:close <task_id>     Atomic: UPDATE tasks + INSERT action (task_close)
                              meta_json gains: close_reason, closed_by, closed_at,
                                               closed_artifact_id, closed_session_id
```

### Output shape

```json
{
  "ok": true,
  "task_id": "task_XXXX",
  "session_id": "sess_YYYY",
  "owner": "cos",
  "artifact_id": "art_ZZZZ" | null,
  "before": { "status": "doing", "owner_agent": "cos", "meta": { ... } },
  "after":  {
    "status": "done",
    "owner_agent": "cos",
    "close_reason": "...",
    "closed_by": "cos",
    "closed_at": "2026-02-23T05:47:30.213Z",
    "closed_artifact_id": null,
    "closed_session_id": "sess_YYYY"
  },
  "action_id": "task_close_<timestamp>",
  "notes": [ "Task transitioned doing → done in a single atomic transaction", ... ]
}
```

**Guard failure** (`status != doing`):
```json
{ "ok": false, "step": "status_guard", "error": "STATUS_GUARD_FAILED: ...", "hint": "..." }
```

### Audit trail

| CLI | Ledger write |
|---|---|
| `tasks:close` | `tasks` (status `doing → done`, `meta_json` closure block) + 1 × `actions` (`type=task_close`, `status=ok`) — single atomic txn |

Verify after close:
```cmd
npm run tasks:get -- task_XXXX
```

Look for `"status": "done"` and the closure fields in `meta`.

### Failure modes

| Failure | Behaviour |
|---|---|
| `task_id` not provided | `ok:false, exit 1` immediately |
| `--reason` missing or empty | `ok:false, exit 1` immediately |
| `--reason` > 240 chars | `ok:false, exit 1` immediately |
| Task not found | `ok:false, step=tasks_get, NOT_FOUND` |
| Task not `doing` (todo/done/blocked) | `ok:false, step=status_guard` with `hint` field |
| DB write fails | `ok:false, step=tasks_close, DB_WRITE_FAILED` |
| Dry-run | Always `ok:true`, `after:null`, `action_id:null` |

### Full execution loop

The three workflows together complete the governance execution cycle:

```
npm run workflow:governance-triage    → pops oldest TODO → doing, runs OpenClaw
npm run workflow:task-close -- <id>   → closes doing → done, writes audit
```

---

## 8. Stop-Loss Governance Gates

> **Stop-loss gates prevent repeated failed executions and force human review.**
> They are evaluated per-run (no polling, no loops) by `workflow:governance-triage`.

### Architecture

Two independent gates, evaluated in order:

| Gate | When | Checks | Action if triggered |
|---|---|---|---|
| **Threshold gate** (step 2a) | Before pop — after finding candidate task | `task.meta.stop_loss_triggered === true` | Refuse to pop/execute; output `ok:false, next_action:human_review_required` |
| **Post-execution gate** (step 4a) | After `openclaw:run` completes | `dispatch.state` classification (see below) | Pop already done; call `tasks:stop-loss` to mark blocked; output `ok:false` |

### Stop-Loss Trigger Conditions

| Condition | dispatch.state | Failure type |
|---|---|---|
| Contract validation failed, repair exhausted | `REJECTED` | `REJECTED` |
| Router keyword gate hard-block | `BLOCKED` | `BLOCKED` |
| Router deny-path (GATE_BLOCK_KEYWORDS) | `BLOCKED` | `BLOCKED` |
| Governance required, no override, stuck permanently | `GATED` | `GATED` |
| Dispatch DISPATCHED but repair attempted and failed (no artifact) | `DISPATCHED` | `REPAIR_FAILED` |

### tasks:stop-loss CLI

> **Command:** `npm run tasks:stop-loss -- <task_id> --reason "<text>" --step "<step>" [options]`
>
> Marks a task as `blocked` and writes a `stop_loss` audit action. Called automatically by
> `workflow:governance-triage` on failure. May also be called by operators manually.

#### Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `<task_id>` | ✅ | — | Task to stop-loss |
| `--reason <text>` | ✅ | — | Short failure reason (max 240 chars) |
| `--step <step>` | ✅ | — | Workflow step where failure occurred |
| `--owner <agent>` | — | `cos` | Responsible agent |
| `--session <id>` | — | inferred | Override session for audit row |
| `--run-id <id>` | — | `null` | run_id at point of failure |
| `--failure-type <type>` | — | `null` | `GATED\|BLOCKED\|REJECTED\|REPAIR_FAILED` |

#### Guard

If `task.meta_json.stop_loss_triggered=true` already → exits 1 with `ALREADY_TRIGGERED`. No double-marking.

#### Writes (atomic transaction)

| Write | Detail |
|---|---|
| `tasks` | `status=blocked`, `meta_json` gains stop-loss block: `stop_loss_triggered, stop_loss_reason, stop_loss_step, stop_loss_at, stop_loss_owner, stop_loss_run_id, stop_loss_failure_type` |
| `actions` | `type=stop_loss`, `status=ok`, `actor=ops` — distinct from `task_update` |

#### Stop-loss output shape

```json
{ "ok": true, "task_id": "...", "session_id": "...", "owner": "cos",
  "before": { "status": "doing", ... },
  "after":  { "status": "blocked", "stop_loss_triggered": true, "stop_loss_reason": "...",
               "stop_loss_step": "openclaw_run_task", "stop_loss_at": "<ISO>",
               "stop_loss_failure_type": "BLOCKED" },
  "action_id": "stop_loss_<timestamp>" }
```

### Triage stop-loss output shapes

**Post-execution gate triggered:**
```json
{ "ok": false, "step": "stop_loss", "task_id": "...", "session_id": "...",
  "failure_summary": { "failure_type": "BLOCKED", "reason": "...", "dispatch_state": "BLOCKED", "run_id": "..." },
  "stop_loss_applied": true, "stop_loss_action_id": "stop_loss_<ts>",
  "next_action": "human_review_required" }
```

**Threshold gate triggered (already stop-lossed):**
```json
{ "ok": false, "step": "stop_loss_threshold_gate",
  "error": "STOP_LOSS_ALREADY_TRIGGERED: task has failed before and requires human review",
  "stop_loss": { "triggered": true, "reason": "...", "step": "...", "at": "<ISO>", "failure_type": "BLOCKED" },
  "next_action": "human_review_required" }
```

### Remediation Steps

When `next_action: human_review_required`:

1. **Inspect the task**
   ```cmd
   npm run tasks:get -- <task_id>
   ```
   Check `meta.stop_loss_reason`, `meta.stop_loss_failure_type`, `meta.stop_loss_step`.

2. **Inspect the audit trail**
   ```cmd
   REM Check stop_loss action rows in ledger directly
   node -e "const D=require('better-sqlite3');const db=new D('db/openclaw_ledger.db',{readonly:true});console.log(JSON.stringify(db.prepare('SELECT id,type,status,reason,ts FROM actions WHERE type=?').all('stop_loss'),null,2));db.close()"
   ```

3. **Resolve the root cause**
   - `BLOCKED`: Task title or goal contains a forbidden keyword. Revise the task.
   - `GATED`: Requires manual governance approval before OpenClaw can dispatch.
   - `REJECTED`: Contract validation failed. Inspect `stop_loss_reason` for field errors.
   - `REPAIR_FAILED`: LLM output failed twice. May need clearer prompt or spec revision.

4. **Clear the stop-loss and re-queue** (after resolution)
   ```cmd
   REM Manually clear stop-loss: update meta_json in SQLite
   REM Then set status=todo to re-queue
   REM There is no automated clear CLI in v1 — requires operator judgement.
   ```

### Full Governance Execution Loop

```
workflow:governance-triage   → pop oldest TODO → doing
                             → [stop_loss gate]  → if BLOCKED/GATED/REJECTED: mark blocked, exit ok:false
                             → [threshold gate]  → if already stop-lossed: refuse, exit ok:false
                             → OpenClaw runs, artefact retrieved

workflow:task-close <id>     → close doing → done, write task_close audit

[on stop-loss] tasks:stop-loss <id> --reason "..." --step "..."   → mark blocked, write stop_loss audit
```

### Invariants

- No polling, no loops — stop-loss is evaluated **per-run only**.
- Both gates exit code `0` (operational outcome, not a crash).
- `ok:false` in output signals stop-loss, not a CLI error.
- Stop-loss CLI is **idempotent-guarded** — cannot double-trigger (`ALREADY_TRIGGERED` guard).
- All writes via `tasks_stop_loss_cli_v1.js` — no direct DB writes in workflow layer.
- **Threshold gate bypass**: triage allows re-execution if `stop_loss_retry_approved=true` (set by `workflow:human-review`).

---

## 9. Human Review Workflow

> **The governance override point.** A human operator reviewed a stop-lossed task and
> decides to retry, close, or reject it. This is the ONLY authorised path to re-queue
> or permanently close a blocked task. No automatic retries.

### Command

```cmd
npm run workflow:human-review -- <task_id>
  --decision  retry|close|reject     (required)
  --reason    "<text>"               (required, max 240 chars)
  [--owner    <agent>]               (default: cos)
  [--artifact <artifact_id>]         (link to artifact; used by close)
  [--session  <session_id>]          (override session; else inferred from task)
  [--dry-run]                        (steps 1–4 only, no DB writes)
```

### Prerequisites

- Task must have `status=blocked` AND `meta_json.stop_loss_triggered=true`
- If not, workflow returns `ok:false, error=NOT_STOP_LOSS_BLOCKED`

### Flags

| Flag | Required | Default | Description |
|---|---|---|---|
| `<task_id>` | ✅ | — | Task to review |
| `--decision <d>` | ✅ | — | `retry`, `close`, or `reject` |
| `--reason <text>` | ✅ | — | Human rationale (max 240 chars) |
| `--owner <agent>` | — | `cos` | Reviewing operator |
| `--artifact <id>` | — | `null` | Link an artifact to the decision (optional) |
| `--session <id>` | — | inferred | Override session for audit rows |
| `--dry-run` | — | false | Show plan without writing; exits after step 3 |

### Decision Paths

| Decision | Status transition | Extra meta fields | Action type | next_action |
|---|---|---|---|---|
| `retry` | `blocked → todo` | `stop_loss_retry_approved=true`, `_by`, `_at`, `_reason` | `human_review_retry` | `run triage again` |
| `close` | `blocked → done` | `review_closed=true`, `close_reason`, `closed_by`, `closed_at` | `human_review_close` | `no further automation` |
| `reject` | `blocked` (unchanged) | `review_rejected=true`, `_by`, `_at`, `_reason` | `human_review_reject` | `no further automation` |

### Audit Trail

| Decision | Writes |
|---|---|
| `retry` | `decisions` table row (approve:override, intent=HUMAN_REVIEW_RETRY) + `actions` row type=`approve_override` + `actions` row type=`human_review_retry` |
| `close` | `actions` row type=`human_review_close` |
| `reject` | `actions` row type=`human_review_reject` |

All writes are **atomic** (single DB transaction per decision) via `tasks_review_update_cli_v1.js`.

### Idempotency Guards

| Decision | Guard condition | Error code |
|---|---|---|
| `retry` | `meta.stop_loss_retry_approved=true` | `ALREADY_APPROVED_FOR_RETRY` |
| `close` | `task.status=done` | `ALREADY_CLOSED` |
| `reject` | `meta.review_rejected=true` | `ALREADY_REJECTED` |

### Output shapes

**Dry-run:**
```json
{ "ok": true, "dry_run": true, "task_id": "...",
  "review": { "task": {...}, "stop_loss": {...}, "latest_artifact": {...}, "proposed_decision": {...} },
  "would_do": ["1. Write approve:override ...", "2. tasks:review-update ...", ...],
  "notes": ["Dry-run exits after step 3 ..."] }
```

**Retry applied:**
```json
{ "ok": true, "task_id": "...", "decision": "retry",
  "override": { "decision_id": "decision_<ts>", "intent": "HUMAN_REVIEW_RETRY", "approved_by": "cos" },
  "apply": { "ok": true, "action_id": "human_review_retry_<ts>", ... },
  "next_action": "run triage again",
  "next_command": "npm run workflow:governance-triage -- --session <session_id>" }
```

**Close applied:**
```json
{ "ok": true, "task_id": "...", "decision": "close",
  "apply": { "ok": true, "action_id": "human_review_close_<ts>", ... },
  "next_action": "no further automation" }
```

**Reject applied:**
```json
{ "ok": true, "task_id": "...", "decision": "reject",
  "apply": { "ok": true, "action_id": "human_review_reject_<ts>", ... },
  "next_action": "no further automation" }
```

### After retry: re-run triage

When `decision=retry` succeeds, the output includes `next_command`. The triage threshold gate
will now allow the task through because `stop_loss_retry_approved=true`.

```cmd
REM Check the session_id in the retry output
npm run workflow:governance-triage -- --session <session_id>
```

> ⚠️ If triage triggers stop-loss again on the same task (same keyword block), the task
> will be re-blocked. Another `workflow:human-review` run is required, but `retry` will
> fail with `ALREADY_APPROVED_FOR_RETRY`. Use `close` or `reject` instead.

### Full human review examples

```cmd
REM Dry-run first (always recommended)
npm run workflow:human-review -- <task_id> --decision retry --reason "Reviewed, safe to retry" --dry-run

REM Apply retry (logs override, re-queues as todo)
npm run workflow:human-review -- <task_id> --decision retry --reason "Reviewed, safe to retry" --owner cos

REM Then run triage with the session shown in the retry output
npm run workflow:governance-triage -- --session <session_id>

REM Close (marks done, no retry ever)
npm run workflow:human-review -- <task_id> --decision close --reason "Task scope is no longer relevant" --owner cos

REM Reject (marks permanently rejected — keeps blocked, no automation)
npm run workflow:human-review -- <task_id> --decision reject --reason "Violates governance policy" --owner cos
```

### Invariants

- Human review is **always explicit** — no automatic retries.
- No direct DB writes in the workflow layer — all writes via `tasks_review_update_cli_v1.js`.
- `workflow:task-close` is bypassed for the close path: it guards for `status=doing`; human-review close handles `blocked → done` directly via the review CLI.
- Original stop-loss fields (`stop_loss_triggered`, `stop_loss_reason`, etc.) are **never deleted** — preserved as permanent audit history.
- `approve_override_cli_v1.js` bug fix: the positional filter now correctly handles the absent `--run` flag (was filtering `args[0]` off-by-one).

---

## 10. Autonomy Policy Matrix

> **The pre-execution access control layer.** Determines whether a task may be
> auto-executed by `workflow:governance-triage` or must be held for human review.
> Evaluated on every triage run, before any task is popped.

### Where the policy lives

```
policy/autonomy_v1.json   ← single source of truth
app/utils/policy_loader_v1.js    ← loader + gate check (no cache; re-read every run)
app/tasks_policy_gate_cli_v1.js  ← CLI that writes policy_gate audit action
```

### Default stance

**Unknown or missing intent → HITL.** Triage is conservative by design.
If a task has no `meta_json.intent` field, policyGateCheck returns `gated:true`.

### Intent tiers

| Tier | Policy key | Intents | Triage behaviour |
|---|---|---|---|
| **Tier 1** | `tier1_allowed_intents` | `GOVERNANCE_REVIEW`, `PLAN_WORK`, `OPS_INTERNAL` | Auto-execute — triage proceeds to pop + run |
| **Tier 2** | `tier2_founder_allowed_intents` | `SALES_INTERNAL`, `MARKETING_INTERNAL` | HITL — use `workflow:founder-*-draft` instead |
| **Force HITL** | `force_hitl_intents` | `PRODUCT_OFFER` | HITL — pricing/scope decisions require human sign-off |
| **Unknown** | (default) | anything else / null | HITL — fail-safe |

> ⚠️ Intents in the policy file **must** match the locked enum in `app/router_v1.js`.
> Do NOT invent intents. The valid set is:
> `GOVERNANCE_REVIEW`, `PLAN_WORK`, `SALES_INTERNAL`, `MARKETING_INTERNAL`, `PRODUCT_OFFER`, `OPS_INTERNAL`.

### Forbidden phrases (override everything)

If the task title or details contain any phrase from `forbidden_phrases` (case-insensitive),
the task is **always** gated — regardless of intent tier.

Default forbidden phrases:

```
send email, send sms, publish to, post to, post live,
deploy to prod, deploy to production, deploy to live,
buy, pay, charge, call client, call customer,
public api, saas, vps, redis, bigquery, scale out, webhook
```

### Gate evaluation order (triage step 2b)

```
1. Load policy/autonomy_v1.json (fail-safe: if load fails → gate everything)
2. Forbidden phrase scan on task title + details (case-insensitive, left-to-right, first match wins)
   → gated:true if any match
3. Intent evaluation:
   a. null/missing intent           → gated:true (HITL default)
   b. force_hitl_intents            → gated:true
   c. tier2_founder_allowed_intents → gated:true (use founder-draft workflows)
   d. tier1_allowed_intents         → gated:false (proceed to pop + execute)
   e. anything else                 → gated:true (HITL default)
```

### How triage enforces it

The policy gate runs at **step 2b** — after the stop-loss threshold gate (2a) but**before** the task is popped (step 3). If gated:

1. `tasks:policy-gate CLI` is called → marks task `blocked`, writes `hil_required=true` into `meta_json`
2. Writes `actions` row: `type=policy_gate`, `status=gated`
3. Triage exits `ok:false, step:policy_gate, next_action:human_review_required`
4. Task is **NOT popped** (`tasks:next` is never called)

### Output shape — policy gate triggered

```json
{
  "ok": false,
  "step": "policy_gate",
  "task_id": "task_...",
  "session_id": "sess_...",
  "policy_check": {
    "gated": true,
    "reason": "FORBIDDEN_PHRASE: task text contains \"send email\" — auto-execution not permitted",
    "matched_phrase": "send email",
    "intent": "OPS_INTERNAL"
  },
  "policy_gate_applied": true,
  "policy_gate_action_id": "policy_gate_<ts>",
  "next_action": "human_review_required"
}
```

### How to update the policy

1. Edit `policy/autonomy_v1.json` directly — no code changes required.
2. Changes take effect on the **next triage run** (policy is re-read on every invocation).
3. To add an intent to tier1, **only use existing router intent names**.
4. To add a forbidden phrase, add a lowercase string to `forbidden_phrases`.
5. Bump `version` (e.g. `"1.1"`) so gate outputs reflect the change.

```cmd
REM Example: add a new forbidden phrase
REM Edit policy/autonomy_v1.json, add "wire transfer" to forbidden_phrases array.
REM No restart needed. Takes effect immediately on next triage run.
```

### Remediation after policy gate

A policy-gated task has `status=blocked` and `meta_json.hil_required=true`.
The operator must review and decide:

```cmd
REM Option 1: close the task (out of scope)
npm run workflow:human-review -- <task_id> --decision close --reason "Task violates policy" --owner cos

REM Option 2: reject the task
npm run workflow:human-review -- <task_id> --decision reject --reason "Forbidden phrase in title" --owner cos

REM Option 3: fix the task title/details to remove the forbidden phrase,
REM then re-set status=todo via tasks:update, and retry triage.
npm run tasks:update -- <task_id> --status todo
npm run workflow:governance-triage -- --session <session_id>
```

### Invariants

- Policy gate runs **before task pop** — gate never affects a task that is already in `doing` state.
- `tasks:policy-gate` action type is `policy_gate` (distinct from `stop_loss` and `task_update`) for clean audit queries.
- `hil_required=true` in task `meta_json` is the canonical flag — query `SELECT * FROM tasks WHERE json_extract(meta_json,'$.hil_required')=1` to list all gated tasks.
- If the policy file fails to load, policyGateCheck fails safe: ALL tasks are gated (no auto-execution).
- Policy file is re-read on every triage run — no cache. Changes take effect immediately.
- Forbidden phrase scan is case-insensitive full-substring match (e.g. `"SEND EMAIL"` matches `"send email"` in forbidden list).
- The stop-loss threshold gate (step 2a) runs **before** the policy gate (step 2b). A stop-lossed task never reaches the policy gate.

---

## 11. Policy Ops

> **Read-only policy inspection tools.** No DB access. No writes. Safe to run at any time.

### 11.1 workflow:policy-show

Prints the current Autonomy Policy Matrix as formatted JSON.

```cmd
npm run workflow:policy-show
```

**Output (success):**
```json
{
  "ok": true,
  "policy_path": "policy\\autonomy_v1.json",
  "version": "1.0",
  "policy": { ... }    // full parsed policy object
}
```

**Output (failure, exit 1):**
```json
{ "ok": false, "error": "POLICY_NOT_FOUND", "detail": "..." }
{ "ok": false, "error": "POLICY_READ_FAIL",  "detail": "..." }
```

---

### 11.2 workflow:policy-validate

Deep-validates the policy file against 10 checks. Reuses locked intent enum from `app/router_v1.js` at runtime (single source of truth — no duplicated lists).

```cmd
npm run workflow:policy-validate
```

**Checks performed:**

| Check | Description |
|---|---|
| `C1_JSON_PARSE` | File exists and parses as valid JSON |
| `C2_REQUIRED_KEYS` | All 7 required top-level keys present |
| `C3_ARRAY_TYPES` | Array keys are arrays; intent arrays non-empty |
| `C4_NO_BLANK_ENTRIES` | No non-string or blank/empty entries in any string array |
| `C5_PHRASE_FORMAT` | `forbidden_phrases` entries are trimmed + lowercase (warn if not) |
| `C6_RETRY_MS` | `artifact_retry_once_ms` is integer in `[250, 5000]` |
| `C7_INTENT_ENUM` | All intent values in `tier1/tier2/force_hitl` arrays belong to locked enum extracted from `router_v1.js` |
| `C8_NO_INTENT_OVERLAP` | No single intent appears in more than one intent category |
| `C9_VERSION` | `version` is a non-empty string |
| `C10_STOP_LOSS_TRIGGERS` | `stop_loss_triggers` values belong to known set: `REJECTED`, `BLOCKED`, `GATED`, `REPAIR_FAILED` (warns on unknown, does not fail) |

**Output (ok:true):**
```json
{
  "ok": true,
  "version": "1.0",
  "policy_path": "policy\\autonomy_v1.json",
  "checks": {
    "C1_JSON_PARSE": { "pass": true },
    "C2_REQUIRED_KEYS": { "pass": true, "keys": [...] },
    "C7_INTENT_ENUM": {
      "pass": true,
      "locked_enum": ["GOVERNANCE_REVIEW", "PLAN_WORK", "SALES_INTERNAL",
                      "MARKETING_INTERNAL", "PRODUCT_OFFER", "OPS_INTERNAL"],
      "all_intents_valid": true
    },
    "...": "..."
  },
  "warnings": []   // non-fatal issues (e.g. C5 casing, C10 unknown triggers)
}
```

**Output (ok:false, exit 1):**
```json
{
  "ok": false,
  "error": "POLICY_VALIDATION_FAILED",
  "version": "1.0",
  "policy_path": "policy\\autonomy_v1.json",
  "details": {
    "C6_RETRY_MS": { "pass": false, "error": "artifact_retry_once_ms must be...", "got": 50 },
    "C7_INTENT_ENUM": { "pass": false, "violations": { "force_hitl_intents": ["UNKNOWN_INTENT"] } }
  },
  "warnings": [...]
}
```

**Always run validate after editing `policy/autonomy_v1.json`:**
```cmd
npm run workflow:policy-validate
```

**Notes:**
- Both commands are **read-only**. No DB access, no writes.
- Intent enum source of truth is `app/router_v1.js` `INTENT_RULES` — validate reads it at runtime.
- `warnings` in the output are non-fatal (exit 0 still). Treat them as style issues to address.
- Exit code 1 means the policy is invalid and triage will likely gate everything (fail-safe behaviour).

---

## 12. Stack Check

> **After Updates: always run `npm run stack:check` to confirm the stack is healthy.**

Consolidated health check. Runs three steps sequentially and emits a single deterministic JSON result. Short-circuits on first failure.

```cmd
npm run stack:check
```

**Steps (in order):**

| Step | Internal command | What it checks |
|---|---|---|
| `runbook` | `workflow:runbook-check` | Ledger integrity + Kimi API auth ping + env sanity |
| `policy` | `workflow:policy-validate` | Policy file: 10 deep checks against locked intent enum |
| `triage_dry_run` | `workflow:governance-triage --dry-run --owner cos` | End-to-end triage path: session, oldest task candidate, policy gate - no writes |

**Output (ok:true, exit 0) - all checks pass:**
```json
{
  "ok": true,
  "checks": {
    "runbook":        { "ok": true, "checks": { "ledger": {}, "kimi": {} }, "env": {} },
    "policy":         { "ok": true, "version": "1.0", "checks": {}, "warnings": [] },
    "triage_dry_run": { "ok": true, "dry_run": true, "would_pop_task": null }
  },
  "summary": { "total": 3, "passed": 3, "failed": 0 }
}
```

**Output (ok:false, exit 1) - a step failed:**
```json
{
  "ok": false,
  "failed_step": "runbook",
  "error": "STEP_FAILED",
  "checks": { "runbook": { "ok": false } },
  "summary": { "total": 3, "passed": 0, "failed": 1 }
}
```

**triage_dry_run valid ok:true states:**

| `would_pop_task` | Meaning |
|---|---|
| `{ id, title, ... }` | A TODO task exists and would pass the gate |
| `null` (+ `no_work:true`) | No non-stub TODO tasks - healthy, not broken |

**Notes:**
- No DB writes. Triage dry-run exits before popping any task.
- Timeouts: runbook 90s (Kimi ping), policy 15s, triage dry-run 30s.
- Run after any of: dep updates, policy edits, env changes, new CLIs wired in.
