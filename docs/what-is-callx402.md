# What Callx402 Is, What It Can Do, and How to Use It

**Version:** 1.0.1 · **Status:** published on npm as `callx402@1.0.1` · **Verified against:** `cli-help-verified-2026-10-06.txt`, `SPEC.md`, `core/`, `server/index.js`, `sdk/`, and the test suite (2026-10-06), plus a clean-install audit 2026-10-07.

## The one-paragraph definition

Callx402 is a universal action and entry-point layer for x402 infrastructure. It is a command-line tool, an HTTP server, and two SDKs that dispatch requests into a set of existing x402 subsystems (Sentinel, Rescue, Doctor, Router, SpendGuard, Settlement Resolver, the MCP fabric, RevRule, and others). Callx402 is the **action**, not the product name: it does not rename or replace any subsystem, and every command either dispatches into the real subsystem or reports honestly why it cannot. Nothing in callx402 executes payments by itself.

## Architecture position

```
UNIQUE PRODUCT BRAND  →  accessed through  →  callx402  →  subsystems
```

Callx402 sits between the caller and the subsystems. There are three entry points:

- **CLI** (`bin/callx402.js`, stdlib only): `callx402 <command> [args] [options]`
- **HTTP server** (`server/index.js`, node:http only): `GET /health`, `GET /openapi.json`, and five `POST` routes
- **SDKs**: JavaScript (`sdk/js/index.js`, same-process dispatch through `core/`) and Python (`sdk/python/`, which invokes the bundled CLI through `node` and parses `--json` output)

All three entry points converge on one dispatcher, `core/index.js` (`runAction` / `runIntent`), and return one shared shape: the result envelope from SPEC section 4.

The subsystems themselves live in the Veyline Developer Primer v2.0.0 tree (x402-paid-api-starter-kit) (`~/workspace/products/x402-paid-api-starter-kit/v2.0.0`). Callx402 imports from that tree via lazy `require` and never writes anything under it; an integrity test ("zero files changed under the v2.0.0 tree") guards this invariant. A separate Veyline recovery track (`core/veyline.js`) resolves modules from the Veyline engineering recovery directory instead.

## The Veyline relationship

Veyline is the flagship product; callx402 is its action and entry layer. In branding terms: **CALLX402 BY PAYLOAD, POWERED BY VEYLINE**.

Concretely, this means two things in the code:

1. Three callx402 commands (`evidence`, `explain`, `recover`) dispatch to the Veyline recovery subsystem (`core/veyline.js`), which loads Veyline's operation ledger, recovery state, rescue planner, trust graph, incident intel, and continuity modules from the Veyline recovery directory (`CALLX402_VEYLINE_ROOT`, config `veylineRoot`, or the default relative path). These commands are gated by `PAYLOAD_VEYLINE_LEDGER=1` (evidence, explain) and `PAYLOAD_VEYLINE_RECOVERY=1` (recover), off by default.
2. The flagship keeps its own brand; the permanent MCP identifier for callx402 remains a deferred decision until that brand is chosen (`docs/MCP_IDENTITY.md`).

## What it does

- Dispatches 13 named actions into the real subsystems, with per-subsystem reachability and flag checks before every dispatch.
- Runs a 10-stage intent pipeline for `execute`: idempotency dedupe, intent parsing, tool discovery, costed planning, SpendGuard budget check, route selection, execution (only with a live route), effect proof, settlement resolution, and RevRule event emission.
- Returns the same JSON result envelope from the CLI, the SDKs, and the HTTP server.
- Fails closed: disabled or unreachable subsystems, over-budget intents, costs above the approval threshold without approval, and unknown settlement states all produce explicit refusals, never silent success.

## What it does not do

- It does not execute payments by itself. (From the verified CLI help: "Nothing here executes payments by itself.")
- It is not a broker, negotiator, or custodian. It dispatches to subsystems; it holds no funds and negotiates no terms.
- It does not retry or repay on unknown settlement. Settlement `UNKNOWN` exits with code 5 and explicit instructions for manual resolution; an explicit `--force-retry` after a stored `UNKNOWN` settlement is refused.
- It does not fake success. If a subsystem is disabled, unreachable, or has no live route, the command says so plainly and exits non-zero.
- It is not the flagship product name, and it does not claim trademark or exclusivity over behavioral phrases like "Need to diagnose x402? callx402." (`docs/ACTION_LANGUAGE.md`).

## The action inventory

Thirteen actions, plus intent mode and config. Each action is documented in full in `docs/action-reference.md`.

| Action | Subsystem it reaches | Read-only? |
|---|---|---|
| `diagnose` / `doctor` (alias) | Doctor | Yes |
| `rescue` | Rescue (auth-gated) | Yes, triage only |
| `route` | Router | Yes, selection only |
| `resolve` | Settlement Resolver | Yes |
| `execute` | Intent pipeline | No (budget-gated; dry-run available) |
| `monitor` | Sentinel | Yes |
| `status` | All 15 subsystem handles | Yes |
| `preflight` | Preflight | Yes |
| `inspect` | Capability Graph | Yes |
| `evidence` | Veyline operation ledger | Yes |
| `explain` | Veyline operation ledger | Yes |
| `recover` | Veyline recovery network | Yes |
| `config` | Local config file (CLI-handled, not a subsystem dispatch) | File write to own config only |

`execute` is the only action with execution side effects, and it is budget-gated (SpendGuard), dry-run capable, and idempotent. In the current build no live tool endpoint is wired to the dispatch layer, so the execution stage reports "no executable route available" and moves no money.

## CLI usage

```
callx402 <command> [args] [options]
callx402 "natural language intent"        intent mode (plans, never executes blindly)
callx402 --help | --version
```

Commands (from the verified 2026-10-06 help surface):

```
diagnose    run the x402 doctor over supplied evidence        [--target ...]
rescue      incident triage (auth-gated; read-only without auth) --incident <id>
route       select a tool/route for a goal                   --goal <text>
resolve     resolve settlement state from evidence           --evidence <json|@file>
doctor      alias of diagnose
execute     run the intent pipeline                          --intent <text> [--max-budget N] [--dry-run] [--idempotency-key K]
monitor     sentinel snapshot [--once] or stream [--watch]
status      per-subsystem reachable/enabled/version report
preflight   run MCP preflight checks
inspect     capability-graph lookup/stats                    [--query <text>]
evidence    show recorded evidence for an operation          <operationId> [--dir <path>]
explain     explain an operation's state in plain language   <operationId> [--dir <path>]
recover     report the safe recovery decision (read-only)    <operationId> [--identity <id> | --evidence <json>]
config      list | get <key> | set <key> <value>
```

Global options: `--json` (full result envelope on stdout), `--timeout <ms>` (fail the action if it exceeds the timeout), `--approve` (authorize costs above the approval threshold), `--force-retry` (refused when prior settlement is UNKNOWN), `--dry-run` (plan only, no execution side effects), `--speed fast|balanced|cheap` (routing policy hint), `--max-budget <usd>`, `--idempotency-key <k>`, plus `--approval-threshold`, `--networks`, `--assets`, `--providers`, `--deadline`, `--risk`, `--dir`, `--identity`, `--auth`, `--watch`, `--once`, `--interval`. Unknown flags are usage errors, never silently ignored.

**Intent mode.** A bare quoted string dispatches to `execute`: `callx402 "complete this job for under $1"`. It plans, never executes blindly.

**Non-JSON output** is a concise human-readable summary (status line, disposition, subsystem status, settlement, txHash); `--json` prints the full envelope.

## HTTP usage

`server/index.js` (node:http only, zero dependencies). Defaults: `127.0.0.1:8787`, 30s timeout, 1 MiB body limit.

| Method and route | Behavior |
|---|---|
| `GET /health` | `{ok, version, subsystems}` from `getStatus()` |
| `GET /openapi.json` | The OpenAPI document as JSON |
| `GET /openapi.yaml` | The raw OpenAPI YAML |
| `POST /call` | `{intent, maxBudget, deadline, speed, risk, networks, assets, providers, approvalThreshold, idempotencyKey, dryRun}` → `runIntent` |
| `POST /rescue` | `{incidentId, ...}` → rescue dispatch |
| `POST /route` | `{goal, ...}` → router dispatch |
| `POST /resolve` | `{evidence}` (object) → settlement resolve |
| `POST /diagnose` | `{target}` and/or `{evidence}` → doctor dispatch |

The HTTP surface is a subset: `monitor`, `status`, `preflight`, `inspect`, `evidence`, `explain`, `recover`, and `config` are not exposed as POST routes. If `CALLX402_AUTH_TOKEN` is set, all POST routes require `Authorization: Bearer <token>` (compared in constant time); otherwise they are open.

HTTP status mapping (from `statusFromEnvelope`): 200 ok · 400 validation/malformed input · 401 missing or invalid bearer token · 403 budget or approval refusal · 404 unknown route · 409 settlement UNKNOWN or unsafe retry refusal · 413 body too large · 503 subsystem disabled or unreachable · 504 timeout.

## SDK usage

SDK usage is supported only where verified in `sdk/`; the SDKs wrap the core, they do not duplicate logic.

**JavaScript** (`sdk/js/index.js`, same-process, no subprocess):

```js
const { callx402 } = require('callx402');

const result = await callx402({
  intent: 'complete this job for under $1',
  maxBudget: 1.00,
  deadline: '2026-10-07T00:00:00Z',
  speed: 'balanced',
  risk: 'low',
  networks: ['base'],
  assets: ['USDC'],
  providers: [],
  approvalThreshold: 5.00,
  idempotencyKey: 'job-42',
  timeoutMs: 30000,
  dryRun: false,
});
```

Named helpers exist for `diagnose`, `rescue`, `route`, `resolve`, `doctor`, `execute`, `monitor`, `preflight`, `inspect`, and `status`. Envelopes with `ok:false` are returned, not thrown, so budget refusals and settlement UNKNOWN surface exactly as the core reports them. Limits: `evidence`, `explain`, and `recover` are not in the JS SDK's action set, and `action:'config'` passes SDK validation but the core rejects it (`unknown_action`), because `config` is handled directly by the CLI.

**Python** (`sdk/python/`, stdlib only; requires `node` on PATH, clear error otherwise):

```python
import callx402

result = callx402.callx402(
    intent="complete this job for under $1",
    max_budget=1.00,
    speed="balanced",
    risk="low",
    networks=["base"],
    assets=["USDC"],
    approval_threshold=5.00,
    idempotency_key="job-42",
    dry_run=False,
)
```

It invokes the bundled CLI with `--json` and returns the envelope as a dict. Named helpers exist for `diagnose`, `rescue`, `route`, `resolve`, `doctor`, `execute`, `monitor`, `preflight`, `inspect`, and `status`. There are no helpers for `evidence`, `explain`, `recover`, or `config`.

## Inputs and expected outputs

Every dispatch returns the SPEC section 4 envelope:

```json
{
  "ok": true,
  "action": "diagnose",
  "disposition": "human-readable outcome",
  "subsystem": "doctor",
  "subsystemStatus": "ok",
  "data": {},
  "settlement": "DEFINITELY_PAID",
  "txHash": "0x...",
  "receipt": {},
  "idempotencyKey": "job-42",
  "deduped": false,
  "error": null
}
```

- `subsystemStatus`: `ok`, `disabled`, `unreachable`, or `prototype`.
- `settlement`: `DEFINITELY_PAID`, `DEFINITELY_NOT_PAID`, `AUTHORIZED_NOT_SETTLED`, `SETTLEMENT_PENDING`, `CONFLICT`, `UNKNOWN`, or null. These are the implementation's settlement states, from `lib/settlement-resolver.js` [implementation]. (SPEC section 4 lists `PENDING`; the code uses `SETTLEMENT_PENDING`.)
- `error` is null on success; `ok` is false whenever `error` is set. `deduped:true` means the result is a replay of an earlier stored run, not a re-execution.

## Failure behavior

CLI exit codes (from `core/envelope.js`, verified in the 2026-10-06 help surface and in tests):

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | generic failure (includes timeouts) |
| 2 | usage or validation error (unknown command, malformed JSON, missing required input) |
| 3 | subsystem disabled or unreachable (names the subsystem and its feature flag); also rescue without auth |
| 4 | budget refused (over budget, or above the approval threshold without `--approve`) |
| 5 | settlement UNKNOWN (never auto-retry, never repay) |

A `--timeout <ms>` that fires ends with exit 1 and a timeout error, not a hang. In remote mode, an unreachable server exits 3; malformed input fails locally before any network call.

## Safety behavior

Hard invariants, enforced in the core and honored by the CLI, SDKs, and HTTP server:

- **Settlement UNKNOWN is never auto-retried and never repaid.** It exits 5 with instructions for manual resolution.
- **Explicit retry after UNKNOWN is refused.** `--force-retry` (or `retry`) on an `execute` whose stored run settled UNKNOWN returns `unsafe_retry_refused`, exit 5.
- **Over-budget intents are refused with zero execution side effects.** SpendGuard checks the plan before anything runs; refusal exits 4.
- **The approval threshold fails closed.** Planned cost above the threshold (default $5.00 USD) without explicit `--approve` refuses with exit 4. Default budget is $1.00 USD.
- **Idempotency keys are honored.** A duplicate key returns the original stored result with `deduped:true`; nothing re-executes. The store is a file-backed JSONL log (`~/.config/callx402/idempotency.jsonl`, overridable with `CALLX402_IDEMPOTENCY_FILE`).
- **Disabled or unreachable subsystems fail closed.** They name the subsystem and its flag; success is never faked.
- **Feature flags are per-module.** Each subsystem exposes `FLAG` and `enabled()`; callx402 checks before dispatch and never force-enables anything that guards money movement. Default state is off: with the v2.0.0 tree present, a fresh `callx402 status` reports 15/15 subsystems reachable and 0/15 enabled; on a bare `npm install callx402` (no tree) it reports 0/15 reachable.

## Configuration

Config file: `~/.config/callx402/config.json` (override the path with `CALLX402_CONFIG`). Environment overrides exist for every key (`CALLX402_V2_ROOT`, `CALLX402_MODE`, `CALLX402_REMOTE_URL`, `CALLX402_AUTH_TOKEN`, `CALLX402_DEFAULT_NETWORK`, `CALLX402_DEFAULT_ASSET`, `CALLX402_DEFAULT_BUDGET_USD`, `CALLX402_APPROVAL_THRESHOLD_USD`). Defaults: mode `local`, no auto-spend, default budget $1.00, approval threshold $5.00, rescue auth off.

`callx402 config list | get <key> | set <key> <value>` manages it (CLI only; not a core action). Unknown keys are rejected. In `remote` mode the CLI and SDKs dispatch over HTTP to the callx402 server; subsystem override seams stay local-only.

## Current limitations

- **Subsystem commands need the v2.0.0 tree.** `diagnose`, `rescue`, `route`, `resolve`, `doctor`, `monitor`, `preflight`, and `inspect` dispatch into the Veyline Developer Primer v2.0.0 tree, which is a separate checkout, not an npm dependency. On a bare `npm install callx402` they exit 3 with `subsystem_unreachable`. Point `CALLX402_V2_ROOT` at the tree, or run in remote mode against your own callx402 server.
- **No live execution route is wired.** The `execute` pipeline is honest about this: without a real executable route it returns "no executable route available," moves no money, and issues no effect proof. Execution side effects would require a live route plus an enabled execution kernel.
- **Subsystems are disabled by default.** Each action exits 3 naming the flag (e.g. `PAYLOAD_SENTINEL=1`) until the operator enables it.
- **Rescue is triage only.** Even with auth, this local command runs detection, quoting, and a free-vs-paid offer; paid execution is performed only through the paid on-demand callx402 action path, never by this local command.
- **Diagnosis and resolution depend on supplied evidence.** `diagnose` evaluates evidence deterministically; `resolve` on empty evidence yields UNKNOWN.
- **The capability graph is experimental** (`createGraph()` throws unless `PAYLOAD_MCP_FABRIC=1`), so `route` and `inspect` have nothing to rank or look up until tools are registered under that flag.
- **HTTP covers five POST routes only** (`/call`, `/rescue`, `/route`, `/resolve`, `/diagnose`); `monitor`, `preflight`, `inspect`, `evidence`, `explain`, `recover`, and `config` are CLI/SDK only.
- **The JS SDK cannot reach `evidence`, `explain`, `recover`, or `config`**; the Python SDK additionally requires `node` on PATH.
- **Settlement state names differ between SPEC and code** (`PENDING` in SPEC section 4 vs `SETTLEMENT_PENDING` in `lib/settlement-resolver.js`). The code's names are what the implementation returns.
- **UNVERIFIED:** this document was verified against the 2026-10-06 codebase and test suite. The Veyline recovery modules resolve from a relative default path (`../../veyline/engineering/recovery`); this document did not independently verify the contents of that Veyline tree, only callx402's dispatch layer over it.

## Verification status

Layer labels used in this document: **[protocol]** claims about the x402 protocol cite the x402 specification (maintained at github.com/x402-foundation/x402, originally developed by Coinbase; HTTP 402 payment flow: server returns 402 with payment requirements, client submits a signed payment payload, a facilitator verifies and settles it). **[implementation]** claims cite callx402 code. **[tested]** claims cite the `node --test` suite, all passing on 2026-10-06: cli-dispatch (26), intent-pipeline (8), safety (7), veyline-commands (12), server (9), remote (8), subsystems (6), integrity (1), sdk (4 pass, 3 skip).

## Sources

- `~/workspace/products/callx402/EDITORIAL_FRAMEWORK.md` (the 20 rules)
- `~/workspace/products/callx402/docs/cli-help-verified-2026-10-06.txt` (verified CLI surface)
- `~/workspace/products/callx402/SPEC.md` (build spec)
- `~/workspace/products/callx402/core/`, `~/workspace/products/callx402/bin/callx402.js`, `~/workspace/products/callx402/server/index.js`, `~/workspace/products/callx402/sdk/`
- `~/workspace/products/callx402/test/` (nine test files, all green or skipped as noted)
- The x402 specification for protocol claims (see the [protocol] label above)
