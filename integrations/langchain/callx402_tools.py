"""callx402 tools for LangChain agents.

Maps the payment problems an agent actually hits to the live callx402
actions on the Payload rail, as LangChain tools. Tool descriptions carry the
problem -> action mapping so agents (and tool-registration/search surfaces)
can discover the right action from the symptom.

Payment model: tools POST to the live rail. Without credentials the rail
answers 402; the tool returns the machine-readable payment requirements as
structured text so the agent's wallet layer (or a human approver) can pay
deliberately. Tools NEVER auto-pay, auto-retry, or auto-repay.

Auth (optional, in order of precedence):
  VEYLINE_API_KEY      Veyline subscription key (metered, no per-action pay)
  CALLX402_CREDIT_ID   single-use credit from POST /v1/callx402/checkout

Free alternative: the local read-only MCP server (node mcp/index.js) or CLI
cover diagnostics at zero cost; see integrations/mcp-clients/README.md.

Requires: langchain-core (pip install langchain-core)
Usage:
    from callx402_tools import CALLX402_TOOLS
    agent = create_agent(model, tools=CALLX402_TOOLS)
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core import invoke, list_actions, quote  # noqa: E402

from langchain_core.tools import tool  # noqa: E402

_RAIL = os.environ.get("CALLX402_RAIL", "https://payload-rail.fly.dev")


def _auth():
    return {
        "api_key": os.environ.get("VEYLINE_API_KEY"),
        "credit_id": os.environ.get("CALLX402_CREDIT_ID"),
    }


def _render(result: dict) -> str:
    """Render an invoke() result as tool output text."""
    status = result.get("status")
    if status == "ok":
        return json.dumps(result["result"], indent=2)[:6000]
    if status == "payment_required":
        how = result["how_to_redeem"]
        return (
            "PAYMENT_REQUIRED — this callx402 action is paid on-demand and no "
            "credential was supplied. Do NOT retry blindly.\n"
            f"Action: {result['action']} | Amount: "
            f"{result['quoted_price_usd']} USD ({result['amount_atomic']} "
            f"atomic units of {result['asset']} on {result['network']})\n"
            f"Pay to: {result['pay_to']} | Quote: {result['quote_id']} "
            f"(expires {result['quote_expires']})\n"
            f"To redeem: {how['method']} {how['url']} with body "
            f"{json.dumps(how['body'])}\n"
            "Alternative: Veyline subscribers pass VEYLINE_API_KEY "
            "(Authorization: Bearer) and the call is metered to the subscription."
        )
    return f"ERROR (fail-closed, do not retry): {json.dumps(result)[:2000]}"


@tool
def callx402_diagnose(evidence: str) -> str:
    """Diagnose an x402 payment or MCP/x402 failure. Use when something went
    wrong and you need to know WHAT failed and WHY before deciding whether a
    retry is safe. Paid on-demand ($2.00 via Stripe; x402 path quoted live).
    Evidence: JSON string describing the failure (error strings, responses,
    tx hashes). Fail-closed: unknown failure classes return UNKNOWN, never a
    guess."""
    return _render(invoke("diagnose", {"evidence": evidence}, **_auth()))


@tool
def callx402_recover(operation_id: str, evidence: str = "") -> str:
    """Recover a lost result after payment (paid but no result). Use for the
    exact situation where a blind retry would double-pay or double-execute.
    Paid on-demand ($10.00 via Stripe). READ-ONLY: nothing is charged, nothing
    executed; returns the safe recovery decision or the proven prior result."""
    payload = {"operationId": operation_id}
    if evidence:
        payload["evidence"] = evidence
    return _render(invoke("recover", payload, **_auth()))


@tool
def callx402_resolve(tx_hash: str, network: str = "base") -> str:
    """Resolve settlement uncertainty from evidence (e.g. was the broadcast
    transaction confirmed on chain?). Use INSTEAD OF blind retry when a
    payment sits in settlement_pending. Paid on-demand ($5.00 via Stripe).
    Unknown stays unknown: never auto-retries, never repays."""
    return _render(
        invoke("resolve", {"evidence": json.dumps({"txHash": tx_hash, "network": network})},
               **_auth())
    )


@tool
def callx402_evidence(operation_id: str) -> str:
    """Establish ground truth for an incident: recorded event trail plus the
    latest per-plane states (payment / execution / delivery). Use FIRST in any
    incident, before acting. Paid on-demand ($2.00 via Stripe). Returns what is
    recorded; nothing is invented."""
    return _render(invoke("evidence", {"operationId": operation_id}, **_auth()))


@tool
def callx402_explain(operation_id: str) -> str:
    """Plain-language assessment of an operation's state from recorded
    evidence: NO_BASIS, INCOMPLETE, KNOWN_SAFE, RECOVERY_CANDIDATE, or PARTIAL,
    plus the safe next step. Use before deciding retry / refund / escalate.
    Paid on-demand ($1.00 via Stripe). INCOMPLETE means do not retry, do not
    repay."""
    return _render(invoke("explain", {"operationId": operation_id}, **_auth()))


@tool
def callx402_safe_retry(retry_plan: str) -> str:
    """Go/no-go verdict on ONE specific retry plan before anything is signed.
    Use when a retry is being considered and must be proven safe first.
    Paid on-demand ($5.00 via Stripe). A retry that would double-pay is
    refused."""
    return _render(invoke("safe_retry", {"retry_plan": retry_plan}, **_auth()))


@tool
def callx402_duplicate_payment_risk(intent_summary: str) -> str:
    """Check whether a retry would sign a second authorization for the same
    intent and pay twice. Call BEFORE any retry that touches money. Paid
    on-demand ($5.00 via Stripe). Ambiguous authorization state blocks the
    retry."""
    return _render(
        invoke("duplicate_payment_risk", {"intent": intent_summary}, **_auth())
    )


@tool
def callx402_preflight(intent: str, max_budget_usd: float) -> str:
    """Pre-commit check: intent, payment readiness, and risk BEFORE an
    economic operation commits. Returns safe-to-proceed, blocked-with-reasons,
    or needs-changes. Paid on-demand ($3.00 via Stripe). Blocked stays blocked
    until the reasons clear."""
    return _render(
        invoke("preflight", {"intent": intent, "maxBudget": max_budget_usd}, **_auth())
    )


@tool
def callx402_fee_schedule() -> str:
    """Free. Return the live per-action fee schedule for all 13 callx402
    actions. Call this before quoting costs to a user."""
    result = list_actions()
    if result.get("status") != "ok":
        return f"ERROR: {json.dumps(result)[:1000]}"
    lines = [
        f"{a['action']}: ${a['amount_cents'] / 100:.2f} {a['currency'].upper()}"
        for a in result["actions"]
    ]
    return ("Live callx402 fee schedule (paid on-demand per action, no "
            "subscription required):\n" + "\n".join(lines))


CALLX402_TOOLS = [
    callx402_diagnose,
    callx402_recover,
    callx402_resolve,
    callx402_evidence,
    callx402_explain,
    callx402_safe_retry,
    callx402_duplicate_payment_risk,
    callx402_preflight,
    callx402_fee_schedule,
]
