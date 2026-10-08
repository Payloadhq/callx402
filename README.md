> **Payload** — Developer infrastructure for x402, agent payments, and programmable revenue.
> PAYLOAD → VEYLINE (flagship) → CALLX402 (action layer) → REVRULE (separate) → developer products → free utilities.
> This repo: **callx402 by Payload — the universal action layer into Veyline's x402 infrastructure.**

<p align="center"><img src="docs/logo.png" alt="callx402 logo" width="200"></p>
# callx402 by Payload

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![MCP stdio](https://img.shields.io/badge/MCP-stdio-blue.svg)](mcp/README.md)

**Powered by Veyline. When x402 breaks, callx402.**

callx402 is the universal action layer into Veyline's x402 infrastructure. Say what you need done in plain language (or hit an HTTP endpoint) and callx402 routes it to the production system that does the real work: diagnose a broken x402 payment, rescue a failed transaction, route an agent job to the cheapest viable path, resolve settlement state from on-chain evidence, or execute under an explicit budget with fail-closed safety rules.

**Why it exists:** x402 failures are expensive and opaque. A settlement attempt ends in `settlement_pending` and nobody knows whether the money moved. A 402 response your wallet misreads. A retry that signs a second authorization for the same intent and pays twice. callx402 exists for exactly those moments: `diagnose` pins the failure to a stage, `rescue` triages the incident, `resolve` settles the question from evidence, `route` finds the cheapest viable path, `execute` runs under a hard budget.

**Try it (two minutes, no setup, no account):**
```sh
npm install -g callx402
callx402 status
callx402 'complete this job for under $1'
```

`status` prints an honest per-subsystem reachability report, no credentials
needed. The intent line parses and plans your request, then stops before
executing anything: with no live tool endpoint wired it reports "no
executable route available", so no money moves. (Use single quotes: in
double quotes your shell would eat the `$1`.)

Free read-only checks against the live Payload rail:

```sh
curl https://payload-rail.fly.dev/v1/callx402/actions
curl 'https://payload-rail.fly.dev/v1/callx402/quote?action=diagnose'
```

The first returns the paid action catalog with prices; the second returns a
free price quote for one action. Invoking a rail action is paid per action
via checkout (see https://payloadhq.github.io/agents.json); these commands
never pay anything.

If it saves you one debugging session, star the repo and read on.

## MCP server: connect in 60 seconds

This repo ships a zero-dependency, read-only MCP server (`mcp/index.js`, node
stdlib only, stdio transport) exposing six `x402_*` diagnostic tools. Nothing
here charges, executes, retries, or repays.

```sh
git clone https://github.com/Payloadhq/callx402
# no npm install needed for the MCP server
```

Add this block to your MCP client config (replace the path), then restart the
client:

| Client | Config file |
|---|---|
| Claude Desktop | `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows) |
| Cursor | `~/.cursor/mcp.json` (user scope) or `.cursor/mcp.json` (project scope) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

```json
{
  "mcpServers": {
    "callx402": {
      "command": "node",
      "args": ["/absolute/path/to/callx402/mcp/index.js"]
    }
  }
}
```

Ask the client to list its MCP tools: the six `x402_*` tools should appear.
Per-client notes and the raw stdio test handshake:
[`integrations/mcp-clients/`](integrations/mcp-clients/).

Note: `x402_status` works with zero setup. The other five tools dispatch
into the v2.0.0 subsystem tree, so they report `subsystem_unreachable`
until `CALLX402_V2_ROOT` points at the tree (see "Full subsystem commands"
above) and the matching flag is enabled.

## The relationship

- **PAYLOAD** = the parent company.
- **VEYLINE** = production infrastructure for x402 + MCP. The flagship brand.
- **CALLX402 BY PAYLOAD** = the x402 response/action layer, powered by Veyline.
  The entry action into Veyline's production infrastructure, not the flagship
  name. Nothing here renames Veyline.

Discovery path: a developer searching for x402 finds callx402, uses it, and
learns Veyline. Payload is not affiliated with the x402 Foundation.

## What it does

- **Diagnose** an x402 or MCP failure
- **Rescue** a failed transaction (auth-gated)
- **Route** a paid agent job to the cheapest viable path
- **Resolve** settlement state from on-chain evidence
- **Execute** under an explicit budget, with fail-closed safety rules

Behavioral usage language (not trademark claims):

- "Need to diagnose x402? callx402."
- "Need to rescue a transaction? callx402."
- "Need to route a paid agent job? callx402."
- "Need settlement certainty? callx402."
- "Need to execute under a budget? callx402."

## Quickstart

### 1. Install

```sh
npm install -g callx402
```

Or locally in a project: `npm install callx402` (the binary is then at
`node_modules/.bin/callx402`).

Fallback, install direct from GitHub:

```sh
npm install Payloadhq/callx402
```

Local development:

```sh
git clone https://github.com/Payloadhq/callx402
cd callx402
npm install
npm link        # exposes the `callx402` command
```

### 2. First run: what works with zero setup

```sh
callx402 status
callx402 'complete this job for under $1'
```

`status` is the honest starting point: a per-subsystem reachability report.
On a bare npm install it reads `0/15 subsystems reachable`, which is
expected (see step 3). The intent line plans in plain language and stops
before execution, so it is always safe to run; use single quotes so your
shell does not eat `$1`.

Free read-only checks against the live Payload rail (no account, no keys):

```sh
curl https://payload-rail.fly.dev/v1/callx402/actions
curl 'https://payload-rail.fly.dev/v1/callx402/quote?action=diagnose'
```

These return the paid action catalog with prices and a free price quote for
one action. Invoking a rail action is paid per action via checkout (machine
front door: https://payloadhq.github.io/agents.json); nothing here pays
anything.

### 3. Self-hosted runtime (advanced, optional)

By default every subsystem command routes to the hosted rail — no setup needed.
If you prefer to run everything on your own machine, set `CALLX402_LOCAL=1`
and point `CALLX402_V2_ROOT` at the v2.0.0 tree (the x402 Paid API Starter Kit,
a separate product):

```sh
export CALLX402_LOCAL=1
export CALLX402_V2_ROOT=/path/to/x402-paid-api-starter-kit/v2.0.0
callx402 status    # now: 15/15 reachable, 0/15 enabled
```

Without `CALLX402_LOCAL=1`, these commands use the hosted rail instead —
that is the standard path and needs nothing installed beyond the npm package.

(The default is a `x402-paid-api-starter-kit/v2.0.0` directory sitting next
to your callx402 checkout.)

Subsystems are disabled by default; `status` names the flag that enables
each one. Set a flag, then run its command:

```sh
export PAYLOAD_MCP_DOCTOR=1
callx402 diagnose --target 'https://api.example.com/x402/pay'
```

More examples (each needs its subsystem flag enabled; run `callx402 status`
to see the flag names):

```sh
callx402 rescue --incident inc_123
callx402 route --goal 'fetch 100 product prices for under 0.50 USD'
callx402 resolve --evidence '{"txHash":"0xabc..."}'
```

Note the single quotes: the goal text contains `$`-style amounts that a
shell would expand inside double quotes.

Alternative to the local tree: run in remote mode against your own callx402
server (`server/index.js`):

```sh
export CALLX402_MODE=remote
export CALLX402_REMOTE_URL=http://127.0.0.1:8787
```

### JavaScript SDK

```js
const { callx402 } = require('callx402');

const result = await callx402({
  intent: 'complete this job for under $1',
  maxBudget: 1.00,
  networks: ['base'],
  assets: ['USDC'],
  approvalThreshold: 5.00,
  idempotencyKey: 'job-42',
});
```

### Python SDK

```python
import callx402

result = callx402.callx402(
    intent="complete this job for under $1",
    max_budget=1.00,
    networks=["base"],
    assets=["USDC"],
    approval_threshold=5.00,
    idempotency_key="job-42",
)
```

### HTTP server

```sh
CALLX402_PORT=8787 node server/index.js
curl -X POST http://127.0.0.1:8787/call \
  -H 'Content-Type: application/json' \
  -d '{"intent":"complete this job for under $1","maxBudget":1.00,"dryRun":true}'
```

Full HTTP surface: `server/openapi.yaml` (served live at `GET /openapi.json`).

## Commands

| Command | What it does |
|---|---|
| `callx402 "natural language intent"` | Intent mode: parse, plan, budget-check, route, execute |
| `callx402 status [--json]` | Subsystem reachability and flag state |
| `callx402 diagnose [--target ...]` | Diagnose an x402 / MCP failure |
| `callx402 rescue --incident <id>` | Rescue a transaction (auth-gated) |
| `callx402 route --goal <text>` | Route a paid job to the cheapest viable path |
| `callx402 resolve --evidence <json\|@file>` | Resolve settlement state from evidence |
| `callx402 doctor` | Run the MCP doctor checks |
| `callx402 execute --intent <text> [--max-budget N] [--dry-run]` | Execute under an explicit budget |
| `callx402 monitor [--once\|--watch]` | Watch subsystem/incident state |
| `callx402 preflight` | Preflight checks before a paid run |
| `callx402 inspect [--query <text>]` | Inspect capability graph / state |
| `callx402 evidence <operationId> [--dir <path>]` | Show recorded evidence for an operation (read-only) — MCP/rail only in 1.0.1, not a published CLI command |
| `callx402 explain <operationId> [--dir <path>]` | Plain-language state assessment for an operation (read-only) — MCP/rail only in 1.0.1, not a published CLI command |
| `callx402 recover <operationId> [--identity <id> \| --evidence <json>]` | Safe recovery decision: RECOVERABLE / SAFE_RETRY / HUMAN_REVIEW (read-only) — MCP/rail only in 1.0.1, not a published CLI command |
| `callx402 config list \| get <k> \| set <k> <v>` | Manage local config |

Subsystem commands (`diagnose`, `rescue`, `route`, `resolve`, `doctor`,
`monitor`, `preflight`, `inspect`) need the v2.0.0 tree plus the matching
feature flag (see "Full subsystem commands" above); without them they exit 3
and do nothing. `status`, intent mode, and `config` work with zero setup.

## Execution modes

callx402 works out of the box. There are two modes:

| Mode | What it is | Cost | Setup | What you get |
|---|---|---|---|---|
| **callx402 CLI — Hosted** (default) | The npm package as a lightweight client to the hosted Payload Rail | Free quote, then pay per action (e.g. `diagnose` $0.10, `resolve` $0.25 on the x402 path) | `npm install callx402` — zero setup | `diagnose`, `resolve`, `recover`, `preflight`, `evidence`, `explain` and more, executed server-side: free quote first, payment verified exactly once on-chain, invocation metered and auditable, result returned. |
| **callx402 Runtime — Self-hosted** (advanced) | CLI + the v2.0.0 runtime tree (`CALLX402_LOCAL=1`, `CALLX402_V2_ROOT` set) | Free | Point `CALLX402_V2_ROOT` at the x402 Paid API Starter Kit v2.0.0 tree + enable feature flags | Full local execution on your machine against evidence you supply. Read-only analysis; never signs, never retries, never moves money. |

A bare `npm install callx402` gives you the hosted mode — no separate tree,
no config, no keys. The v2 tree is never required for standard use.

## Paid one-off diagnostics (no subscription)

The CLI and MCP tools above are the **free local tier**: read-only
diagnostics that never charge, never execute, and never move money. When a
free diagnostic is not enough — you need a paid, metered, auditable invocation
with quote-before-payment and exactly-once payment semantics — each action is
also available as a **paid one-off rail action**. No subscription, no account:
quote, then pay deliberately.

What paying buys: the rail authorizes the action, validates the payment
exactly once on-chain, meters the invocation against your org, records it for
audit, enforces governor/quota rules for subscribers — and then **executes the
read-only diagnostic server-side and returns the result**. No local setup, no
separate tree, no keys. The rail never fakes execution: every result is
produced by the diagnostic modules over the evidence you supply.

The quote-before-payment flow, verified live:

```sh
# 1. Free quote: exact price before anything is paid
curl "https://payload-rail.fly.dev/v1/callx402/quote?action=resolve&path=x402"
# -> {"quote_id":"...","quoted_price_usd":"0.25", ...}

# 2. Invoke unauthenticated -> x402 v2 402 with the exact payment terms
curl -X POST https://payload-rail.fly.dev/v1/callx402/actions/resolve \
  -H 'Content-Type: application/json' -d '{"evidence":"{...}"}'
# -> HTTP 402: exact USDC amount on Base, pay-to address, 300s window, quote_id

# 3. Pay deliberately from an authorized wallet, then retry with {txHash, quote_id}
```

Live fee schedule: `GET https://payload-rail.fly.dev/v1/callx402/actions`
(responds `"model":"paid on-demand per action; no subscription required"`).
The x402-path price is the Stripe-path fee divided by 20 — for example
`resolve` is $5.00 via Stripe, $0.25 via the x402 path. Never blind-retry a
payment to reach a paid action: get the quote first.

Problem to action map (which paid action answers which failure, with the free
CLI/MCP path for each): [`docs/problem-map.md`](docs/problem-map.md).

## Integrations

Working entry points for agent frameworks, automation, MCP clients, and x402
facilitators — all in [`integrations/`](integrations/) and tested against the
live rail:

- **LangChain** — 9 tools (`integrations/langchain/`): diagnose, recover,
  resolve, evidence, explain, safe-retry, duplicate-payment risk, preflight,
  plus the free live fee schedule
- **CrewAI** — the same actions as CrewAI Tools (`integrations/crewai/`)
- **n8n** — importable incident-guard workflow (`integrations/n8n/`): maps an
  incident to a callx402 action, fetches the free live quote, invokes when
  credentialed, otherwise emits payment instructions — never auto-pays
- **MCP clients** — Claude Desktop / Cursor / Windsurf setup for the free
  read-only MCP server (`integrations/mcp-clients/`)
- **x402 facilitators** — `settle-guard.js` (`integrations/facilitator/`):
  resolve settlement state from evidence *before* re-broadcasting a payment

Problem → action map: [`docs/problem-map.md`](docs/problem-map.md).
Machine front door for agents: https://payloadhq.github.io/agents.json.

## Money-safety rules

- **Settlement UNKNOWN is never auto-retried and never repaid.**
- **Over-budget intents are refused with zero side effects.**
- **Approval thresholds fail closed.**
- **Idempotency keys dedupe** — repeats return the original, never re-execute.
- **Disabled or unreachable subsystems fail closed** — success is never faked.
- **Non-custodial** — callx402 dispatches work; it never holds funds or private keys.

## What callx402 is not

- Not the flagship product name. The product is **Veyline**.
- Not a broker, negotiator, or custodian. It dispatches; it never holds funds.
- The phrases above are usage language, not exclusivity claims.

## Links

- Canonical docs: https://payloadhq.github.io/
- Payload org profile: https://github.com/Payloadhq/Payloadhq
- RevRule by Payload (separate product): https://github.com/Payloadhq/revrule-console

Full subsystem reference: `docs/README.md`. Behavioral language: `docs/ACTION_LANGUAGE.md`.
Design spec: `SPEC.md`.

## License

MIT. See `LICENSE`.

---

**More from Payload** · [payloadhq.github.io](https://payloadhq.github.io/) · [all Payload repos](https://github.com/Payloadhq)

Related: [x402-manifest-check](https://github.com/Payloadhq/x402-manifest-check) · [x402-observatory](https://github.com/Payloadhq/x402-observatory) · [flow-agentic-demo](https://github.com/Payloadhq/flow-agentic-demo)
