# callx402 documentation

**callx402 is the action, not the product name.** callx402 is the universal
action and entry-point layer for x402 infrastructure: you state an intent in
plain language (or call an HTTP endpoint), and callx402 dispatches into the
existing x402 subsystems that do the real work. It dispatches only. It never
moves money by itself. The flagship product keeps a separate, forthcoming
brand; callx402 is how you access it.

Status of this docs set: landing index is live. Pages and assets marked
"planned" below are not published yet. Nothing here is aspirational: every
claim about callx402 is verified against the current build or its test suite.

## 1. What it is

What callx402 is, what it can do, what it cannot do, its architecture
position, its relationship to the flagship product, all verified actions,
CLI/HTTP/SDK usage, inputs and outputs, failure and safety behavior, and
limitations. Infrastructure-documentation tone, no hype.

**[what-is-callx402.md](what-is-callx402.md)** — planned

## 2. Action map

A visual capability map of every action and the subsystem behind it, with a
Need → Action matrix underneath. Built from real terminal output of the
current build, not from prose descriptions.

**[visuals/01-action-map.png](visuals/01-action-map.png)** — planned
(raw terminal captures are staged in `visuals/raw/`)

## 3. Quick start

Install from GitHub (zero dependencies):

```sh
git clone https://github.com/Payloadhq/callx402
cd callx402
npm install
npm link        # exposes the `callx402` command
```

Check subsystem reachability and feature flags:

```sh
callx402 status
```

Run an intent in plain language:

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

Plan without executing (nothing runs, nothing is charged):

```sh
callx402 execute --intent "sync invoices" --max-budget 2.00 --dry-run
```

Global flags: `--json` (machine-readable envelope on stdout),
`--timeout <ms>`, `--approve` (authorize costs above the approval threshold),
`--force-retry` (rejected when prior settlement is UNKNOWN),
`--dry-run` (plan only), `--speed fast|balanced|cheap`,
`--max-budget <usd>`, `--idempotency-key <k>`.

Exit codes: 0 ok, 1 failure, 2 usage, 3 disabled/unreachable, 4 budget
refused, 5 settlement unknown (never auto-retried, never repaid).

## 4. Action reference

Per action: purpose, when to use, input, output, side effects, whether it can
move money, whether it can create or retry an authorization, fail-closed
conditions, example, limitations, verification status. Updated when the
surface changes.

**[action-reference.md](action-reference.md)** — planned

Current action surface (verified 2026-10-06, see §10):

`diagnose` (alias `doctor`), `rescue`, `route`, `resolve`, `execute`,
`monitor`, `status`, `preflight`, `inspect`, `evidence`, `explain`,
`recover`, plus client-side `config` (list | get | set). Natural-language
intents (`callx402 "..."`) route through the same actions via the intent
pipeline.

## 5. Troubleshooting

Problem-first articles for x402 failure conditions. Each follows the same
structure: problem, why it happens, how to diagnose it, the safe and correct
response, how to verify the fix, where callx402 applies, and the sources and
verification scope. Each stands alone and helps even if you never install
callx402. All eight articles below are live.

1. [troubleshooting/cx402-402afterfail-001-402-after-failed-settle.md](troubleshooting/cx402-402afterfail-001-402-after-failed-settle.md) — Ambiguous settlement after a failed settle: reconcile before authorizing another payment.
2. [troubleshooting/cx402-agentcap-001-agent-spending.md](troubleshooting/cx402-agentcap-001-agent-spending.md) — Agent auto-pay with no spending cap: budgets, thresholds, and kill switches.
3. [troubleshooting/cx402-eip3009-001-authorization-checklist.md](troubleshooting/cx402-eip3009-001-authorization-checklist.md) — EIP-3009 authorization rejected at verify: the field-level checklist.
4. [troubleshooting/cx402-paidnores-001-paid-no-result.md](troubleshooting/cx402-paidnores-001-paid-no-result.md) — Paid but the tool never executed: the lost-result problem and recovery.
5. [troubleshooting/cx402-safretry-001-retry-after-payment.md](troubleshooting/cx402-safretry-001-retry-after-payment.md) — Retry after payment: when it is safe and when it double-pays.
6. [troubleshooting/cx402-settlepend-001-settlement-pending.md](troubleshooting/cx402-settlepend-001-settlement-pending.md) — What `settlement_pending` means and why retrying in that state risks a double payment.
7. [troubleshooting/cx402-solanafail-001-solana-settlement.md](troubleshooting/cx402-solanafail-001-solana-settlement.md) — Solana settlement failures: blockhash expiry, phantom pending, and Token-2022.
8. [troubleshooting/cx402-verset-001-verify-ok-settle-fails.md](troubleshooting/cx402-verset-001-verify-ok-settle-fails.md) — Verify succeeds but settle fails: the trust gap between the two calls.

## 6. Recipes and use cases

Practical "how would I..." walkthroughs answered generally first, with
callx402 shown only where it implements part of the workflow. Passes the
editorial test: each recipe must be worth reading if callx402 did not exist.

Planned. No recipes published yet.

## 7. Architecture

The subsystem tree callx402 dispatches into: Sentinel, Rescue, Doctor,
Router, Valuator, SpendGuard, Settlement Resolver, Intent Engine, Capability
Graph, Economic Planner, MCP fabric, and RevRule. Every dispatch goes
through the real subsystem in the x402 paid API starter kit v2.0.0 tree,
which callx402 imports but never modifies. If a subsystem is disabled or
unreachable, callx402 reports that plainly and fails closed. It never fakes
success.

**[visuals/08-architecture.svg](visuals/08-architecture.svg)** — planned

## 8. Safety model

Hard invariants, enforced in the core and honored by the CLI, SDKs, and HTTP
server:

- **Settlement UNKNOWN is never auto-retried and never repaid.** It is
  surfaced for manual resolution. An explicit retry flag is refused when the
  prior settlement state is UNKNOWN.
- **Over-budget intents are refused with zero execution side effects.**
  SpendGuard checks the budget before anything runs.
- **Approval threshold fails closed.** Spend above the threshold requires
  explicit approval; without it, the request does not proceed.
- **Idempotency keys are honored.** Repeating a key returns the original
  stored result with `deduped: true`; nothing re-executes.
- **Disabled or unreachable subsystems fail closed.** A 503 (HTTP) or
  non-zero exit names the subsystem and its flag; success is never faked.
- **Rescue is auth-gated** and read-only without authorization.

callx402 is not a broker, negotiator, or custodian. It does not hold funds or
negotiate terms. See [ACTION_LANGUAGE.md](ACTION_LANGUAGE.md) for approved
usage language, and [MCP_IDENTITY.md](MCP_IDENTITY.md) on the deferred MCP
identifier.

## 9. API, SDK, and CLI reference

### Result envelope

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
`AUTHORIZED_NOT_SETTLED`, `SETTLEMENT_PENDING`, `CONFLICT`, `UNKNOWN`, or
null. `error` is null on success; `ok` is false whenever `error` is set.

### JavaScript SDK

```js
const { callx402 } = require('callx402');

const result = await callx402({
  intent: 'complete this job for under $1',
  maxBudget: 1.00,
  speed: 'balanced',
  risk: 'low',
  networks: ['base'],
  assets: ['USDC'],
  approvalThreshold: 5.00,
  idempotencyKey: 'job-42',
  timeoutMs: 30000,
  dryRun: false,
});
// result is the envelope above.
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
# result is a dict matching the envelope above.
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

HTTP surface (all documented in `server/openapi.yaml`, served live as JSON at
`GET /openapi.json` and YAML at `GET /openapi.yaml`):

| Method | Path | Maps to |
|---|---|---|
| GET | `/health` | version plus per-subsystem reachability and enabled state |
| GET | `/openapi.json` | OpenAPI document as JSON |
| GET | `/openapi.yaml` | OpenAPI document as YAML |
| POST | `/call` | intent pipeline (`runIntent`) |
| POST | `/rescue` | `runAction('rescue', ...)` |
| POST | `/route` | `runAction('route', ...)` |
| POST | `/resolve` | `runAction('resolve', ...)` |
| POST | `/diagnose` | `runAction('diagnose', ...)` |

If `CALLX402_AUTH_TOKEN` is set, all POST routes require
`Authorization: Bearer <token>`; otherwise they are open.

### CLI reference

The verified help text is pinned at
[cli-help-verified-2026-10-06.txt](cli-help-verified-2026-10-06.txt). Run
`scripts/drift-check.js` before publishing; the published help must match
the file.

### Config reference

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

Per-subsystem feature flags live in the v2.0.0 modules themselves (each
exposes `FLAG` and `enabled()`); `callx402 status` reports them. Nothing that
guards real money movement is ever force-enabled by callx402.

### Subsystem docs

callx402 dispatches into the x402 paid API starter kit v2.0.0 tree. Its docs
are the reference for subsystem behavior:

- `../x402-paid-api-starter-kit/v2.0.0/README.md` — kit overview
- `../x402-paid-api-starter-kit/v2.0.0/docs/DOCTOR.md` — Doctor
- `../x402-paid-api-starter-kit/v2.0.0/docs/INTENT_ENGINE.md` — Intent Engine
- `../x402-paid-api-starter-kit/v2.0.0/docs/ECONOMIC_PLANNER.md` — Economic Planner

callx402 never modifies that tree; it only requires from it.

## 10. Verification status

Last verified against build 0.1.0 on 2026-10-06. The pinned help text,
action registration, and HTTP surface matched the implementation on that
date. Automated drift checking runs before every publish:

```sh
node scripts/drift-check.js
```

It compares `bin/callx402.js --help` against the pinned help file, the
`ACTIONS` registration in `core/index.js` against the documented action
surface, and the route count in `server/openapi.yaml` against the documented
HTTP surface. Exit 0 is clean; exit 1 prints a drift report. Regenerate the
screenshot and capability matrix whenever the surface changes.
