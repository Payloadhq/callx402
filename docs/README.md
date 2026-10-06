# callx402

**callx402 is the action, not the product name.**

callx402 is the universal action / entry-point layer for x402 infrastructure.
You say what you need done in plain language (or hit an HTTP endpoint), and
callx402 dispatches into the existing x402 subsystems that do the real work.
The flagship product keeps a separate, forthcoming brand. callx402 does not
rename anything: Sentinel, Rescue, Doctor, Router, Valuator, SpendGuard,
Settlement Resolver, Intent Engine, Capability Graph, Economic Planner, MCP
fabric, RevRule, and the Payload brand all keep their names.

## Architecture

```
UNIQUE PRODUCT BRAND  →  accessed through  →  callx402  →  subsystems
```

Subsystems reached through callx402 (all live in the x402 paid API starter kit
v2.0.0 tree, which callx402 imports but never modifies):

| Subsystem | What it does |
|---|---|
| Sentinel | Watches for x402 incidents and flags them |
| Rescue | Handles rescue of stuck or failed transactions |
| Doctor | Diagnoses x402 / MCP failures |
| Router | Selects the cheapest viable tool or path for a job |
| Valuator | Quotes and values work |
| SpendGuard | Enforces budgets; refuses over-budget work |
| Settlement Resolver | Determines settlement state from evidence |
| Intent Engine | Parses natural-language intents into structured goals |
| Capability Graph | Tracks what tools exist and how they perform |
| Economic Planner | Builds costed plans for a goal |
| MCP fabric | Transactional execution primitives (saga, execution kernel, effect proof, result recovery) |
| RevRule | Emits the economic event after execution |

Every dispatch goes through the real subsystem. If a subsystem is disabled
(feature flag off) or unreachable, callx402 says so plainly and fails closed.
It never fakes success.

## Quickstart

Install from GitHub (zero dependencies; `npm install` works offline):

```sh
git clone https://github.com/Payloadhq/callx402
cd callx402
npm install
npm link        # exposes the `callx402` command
```

Check the subsystems:

```sh
callx402 status
```

Run an intent:

```sh
callx402 "complete this job for under $1"
```

Diagnose, rescue, route, resolve:

```sh
callx402 diagnose --target "https://api.example.com/x402/pay"
callx402 rescue --incident inc_123
callx402 route --goal "fetch 100 product prices for under $0.50"
callx402 resolve --evidence '{"txHash":"0xabc..."}'
```

### JavaScript SDK

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
// result is the envelope (see "Result envelope" below).
// Also available: callx402.status(), .diagnose(), .rescue(), .route(),
// .resolve(), .doctor(), .execute(), .monitor(), .preflight(), .inspect()
```

### Python SDK

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
# result is a dict matching the envelope below.
```

### HTTP server

```sh
CALLX402_PORT=8787 node server/index.js
```

```sh
curl http://127.0.0.1:8787/health

curl -X POST http://127.0.0.1:8787/call \
  -H 'Content-Type: application/json' \
  -d '{"intent":"complete this job for under $1","maxBudget":1.00,"dryRun":true}'

curl -X POST http://127.0.0.1:8787/resolve \
  -H 'Content-Type: application/json' \
  -d '{"evidence":{"txHash":"0xabc..."}}'
```

The full HTTP surface is documented in `server/openapi.yaml`
(served live as JSON at `GET /openapi.json` and as YAML at `GET /openapi.yaml`).

## Commands

| Command | What it does |
|---|---|
| `callx402 "natural language intent"` | Intent mode: parse, plan, budget-check, route, execute |
| `callx402 status [--json]` | Subsystem reachability and flag state |
| `callx402 diagnose [--target ...] [--json]` | Diagnose an x402 / MCP failure (Doctor) |
| `callx402 rescue --incident <id> [--json]` | Rescue a transaction (auth-gated) |
| `callx402 route --goal <text> [--json]` | Route a paid job to the cheapest viable path |
| `callx402 resolve --evidence <json\|@file> [--json]` | Resolve settlement state from evidence |
| `callx402 doctor [--json]` | Run the MCP doctor checks |
| `callx402 execute --intent <text> [--max-budget 1.00] [--dry-run] [--idempotency-key K]` | Execute under an explicit budget |
| `callx402 monitor [--once\|--watch] [--json]` | Watch subsystem/incident state |
| `callx402 preflight [--json]` | Preflight checks before a paid run |
| `callx402 inspect [--query <text>] [--json]` | Inspect capability graph / state |
| `callx402 config list \| get <k> \| set <k> <v>` | Manage local config |

Global flags: `--json` (machine-readable envelope on stdout), `--timeout <ms>`.
Exit codes: 0 ok · 1 failure · 2 usage/validation error · 3 subsystem disabled or
unreachable · 4 budget refused · 5 settlement UNKNOWN.

## Result envelope

Every action returns the same JSON envelope (CLI `--json`, SDKs, HTTP):

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

`subsystemStatus` is one of `ok`, `disabled`, `unreachable`, `prototype`.
`settlement` is one of `DEFINITELY_PAID`, `DEFINITELY_NOT_PAID`,
`AUTHORIZED_NOT_SETTLED`, `SETTLEMENT_PENDING`, `CONFLICT`, `UNKNOWN`, or null.
`error` is null on success; `ok` is false whenever `error` is set.

## Money-safety rules

These are hard invariants, enforced in the core and honored by the CLI, SDKs,
and HTTP server:

- **Settlement UNKNOWN is never auto-retried and never repaid.** It is surfaced
  for manual resolution. An explicit retry flag is rejected when the prior
  settlement state is UNKNOWN (unsafe retry refusal).
- **Over-budget intents are refused with zero execution side effects.**
  SpendGuard checks the budget before anything runs.
- **Approval threshold fails closed.** Spend above the threshold requires
  explicit approval; without it, the request does not proceed.
- **Idempotency keys are honored.** Repeating a key returns the original stored
  result with `deduped: true`; nothing re-executes.
- **Disabled or unreachable subsystems fail closed.** A 503 (HTTP) or
  non-zero exit names the subsystem and its flag; success is never faked.

## Config reference

Config file: `~/.config/callx402/config.json` (override path with
`CALLX402_CONFIG`). Environment overrides:

| Variable | Meaning | Default |
|---|---|---|
| `CALLX402_V2_ROOT` | Path to the v2.0.0 subsystem tree | `../../x402-paid-api-starter-kit/v2.0.0` |
| `CALLX402_MODE` | `local` or `remote` | `local` |
| `CALLX402_REMOTE_URL` | callx402 server URL when mode is `remote` | — |
| `CALLX402_AUTH_TOKEN` | Bearer token required on all HTTP POST routes | unset (open) |
| `CALLX402_DEFAULT_NETWORK` | Default network for intents | — |
| `CALLX402_DEFAULT_ASSET` | Default asset for intents | — |
| `CALLX402_DEFAULT_BUDGET_USD` | Default max budget | `1.00` |
| `CALLX402_APPROVAL_THRESHOLD_USD` | Spend above this needs explicit approval | `5.00` |
| `CALLX402_PORT` / `CALLX402_HOST` | HTTP server bind | `8787` / `127.0.0.1` |
| `CALLX402_TIMEOUT_MS` | Default per-request timeout | `30000` |

Per-subsystem feature flags live in the v2.0.0 modules themselves (each exposes
`FLAG` and `enabled()`); `callx402 status` reports them. Nothing that guards
real money movement is ever force-enabled by callx402.

## Subsystem docs

callx402 dispatches into the x402 paid API starter kit v2.0.0 tree. Its docs
are the reference for subsystem behavior:

- `../x402-paid-api-starter-kit/v2.0.0/README.md` — kit overview
- `../x402-paid-api-starter-kit/v2.0.0/docs/DOCTOR.md` — Doctor
- `../x402-paid-api-starter-kit/v2.0.0/docs/INTENT_ENGINE.md` — Intent Engine
- `../x402-paid-api-starter-kit/v2.0.0/docs/ECONOMIC_PLANNER.md` — Economic Planner

callx402 never modifies that tree; it only requires from it.

## What callx402 is not

- It is not the flagship product name. The flagship brand is separate and
  forthcoming; callx402 is how you access it.
- It is not a broker, negotiator, or custodian. It dispatches to subsystems;
  it does not hold funds or negotiate terms.
- Behavioral phrases like "Need to diagnose x402? callx402." are usage
  language, not trademark or exclusivity claims. See `docs/ACTION_LANGUAGE.md`.
- The permanent MCP identifier is deferred until the flagship brand is
  chosen. See `docs/MCP_IDENTITY.md`.
