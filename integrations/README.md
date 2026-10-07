# callx402 integrations

Working entry points for agent frameworks, automation platforms, MCP clients,
and x402 facilitators. All of them talk to the **live** callx402 action API on
the Payload rail (`https://payload-rail.fly.dev`) or the **free** local
read-only surfaces. Real code, no mocks.

Machine front door for agents: https://payloadhq.github.io/agents.json
Problem → action map: [docs/problem-map.md](../docs/problem-map.md)

## Agent frameworks

| Integration | What it is | Run |
|---|---|---|
| [langchain/](langchain/) | 9 LangChain tools (`callx402_diagnose`, `callx402_recover`, `callx402_resolve`, `callx402_evidence`, `callx402_explain`, `callx402_safe_retry`, `callx402_duplicate_payment_risk`, `callx402_preflight`, `callx402_fee_schedule`) | `pip install langchain-core`, `from callx402_tools import CALLX402_TOOLS` |
| [crewai/](crewai/) | Same actions as CrewAI `Tool`s via `Tool.from_func` | `pip install crewai`, `from callx402_crewai import CALLX402_CREWAI_TOOLS` |
| [core.py](core.py) | Framework-free shared client (stdlib only): `list_actions()`, `quote()`, `invoke()`, plus the `PROBLEM_MAP` table. Wrap it for AutoGen (`register_function`), raw agents, or anything else | `python3 core.py map` |

AutoGen sketch (uses `core.py`, no extra file needed):

```python
from autogen import ConversableAgent
import sys; sys.path.insert(0, "integrations")
from core import invoke

agent = ConversableAgent("payments", llm_config={...})
agent.register_function(
    {"diagnose_x402": lambda evidence: invoke("diagnose", {"evidence": evidence})},
    caller=agent, executor=agent,
)
```

## Automation

| Integration | What it is |
|---|---|
| [n8n/](n8n/) | `callx402-incident-guard.json` — importable n8n workflow. Webhook receives an incident, maps it to a callx402 action, fetches the **free** live quote, then either invokes (when `VEYLINE_API_KEY` / `CALLX402_CREDIT_ID` is set) or emits payment instructions. Never auto-pays. |

## MCP clients (free, read-only diagnostics)

| Integration | What it is |
|---|---|
| [mcp-clients/](mcp-clients/) | Setup guide for the callx402 MCP server (`mcp/index.js`): Claude Desktop, Cursor, Windsurf, any stdio client, plus the smoke test. Zero dependencies. |

## x402 facilitators

| Integration | What it is | Run |
|---|---|---|
| [facilitator/](facilitator/) | `settle-guard.js` — guard the settle path: resolve settlement state from evidence **before** re-broadcasting a payment. Prints the 402 payment envelope when unpaid; prints the verdict when credentialed. Fail-closed on transport errors. | `node settle-guard.js --tx 0x... --network base` |

## Payment model (all integrations)

- `GET /v1/callx402/actions` and `GET /v1/callx402/quote` are **free**.
- `POST /v1/callx402/actions/{action}` without credentials → x402 v2 **402**
  (exact USDC on Base, pay-to, 300s window). The integrations surface that
  envelope for deliberate payment — they never auto-pay, auto-retry, or
  auto-repay.
- With `VEYLINE_API_KEY` (Bearer) the call is metered to the subscription;
  with `CALLX402_CREDIT_ID` (from `POST /v1/callx402/checkout`) it consumes
  the single-use credit.
- The local CLI and MCP-stdio server are the free read-only diagnostic
  surface — no payment, no auth, never Veyline-gated.
