# callx402 by Payload

**Powered by Veyline. When x402 breaks, callx402.**

callx402 is the universal action layer into Veyline's x402 infrastructure. You say
what you need done in plain language (or hit an HTTP endpoint), and callx402
routes it to the production system that does the real work.

## The relationship

- **PAYLOAD** = the parent company.
- **VEYLINE** = production infrastructure for x402 + MCP. The flagship brand.
- **CALLX402** = the x402 response/action layer. The entry action, not a separate
  product name. Nothing here renames Veyline.

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

Install from GitHub (zero dependencies):

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
