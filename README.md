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

**Try it (one minute):**
```sh
git clone https://github.com/Payloadhq/callx402
cd callx402 && npm install && npm link
callx402 diagnose --target "https://api.example.com/x402/pay"
```

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

**Current install route** (direct from GitHub; this path keeps working after the npm registry release):

```sh
npm install Payloadhq/callx402
```

Once the package is published, the canonical path will be `npm install callx402`.

Alternative — clone and link for local development:

```sh
git clone https://github.com/Payloadhq/callx402
cd callx402
npm install
npm link        # exposes the `callx402` command
```

```sh
callx402 status
callx402 "complete this job for under $1"
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
| `callx402 config list \| get <k> \| set <k> <v>` | Manage local config |

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
