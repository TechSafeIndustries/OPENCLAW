# OpenClaw — Operator Runbook: CMD Workflows

> **Workflow index**
>
> | npm script | Purpose | Section |
> |---|---|---|
> | `workflow:runbook-check` | **Run this first** — preflight: ledger + Kimi ping + env sanity | §0 |
> | `workflow:founder-sales-draft` | Founder sales draft (SALES_INTERNAL → sales agent) | §1 |
> | `workflow:founder-marketing-draft` | Founder marketing draft (MARKETING_INTERNAL → marketing_pr agent) | §5 |

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
