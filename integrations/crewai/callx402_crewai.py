"""callx402 tools for CrewAI crews.

Same live callx402 action API as the LangChain integration, wrapped as
CrewAI Tools via Tool.from_func. Import CALLX402_CREWAI_TOOLS and hand them
to your agents:

    from callx402_crewai import CALLX402_CREWAI_TOOLS
    agent = Agent(role="Payments incident responder",
                 goal="Resolve x402 payment incidents without double-paying",
                 tools=CALLX402_CREWAI_TOOLS, ...)

Payment model: paid on-demand per action on the Payload rail. Without
VEYLINE_API_KEY or CALLX402_CREDIT_ID the rail answers 402 and the tool
returns the machine-readable payment requirements — the crew's wallet layer
or a human pays deliberately. Tools never auto-pay, auto-retry, or auto-repay.

Requires: crewai (pip install crewai)
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core import invoke  # noqa: E402

from crewai.tools import Tool  # noqa: E402


def _auth():
    return {
        "api_key": os.environ.get("VEYLINE_API_KEY"),
        "credit_id": os.environ.get("CALLX402_CREDIT_ID"),
    }


def _render(result: dict) -> str:
    import json

    status = result.get("status")
    if status == "ok":
        return json.dumps(result["result"], indent=2)[:6000]
    if status == "payment_required":
        how = result["how_to_redeem"]
        return (
            "PAYMENT_REQUIRED — paid on-demand callx402 action, no credential "
            "supplied. Do NOT retry blindly. "
            f"Action={result['action']} amount={result['quoted_price_usd']} USD "
            f"({result['amount_atomic']} atomic {result['asset']} on "
            f"{result['network']}) pay_to={result['pay_to']} "
            f"quote_id={result['quote_id']} expires={result['quote_expires']}. "
            f"Redeem: {how['method']} {how['url']} body={json.dumps(how['body'])}. "
            "Alternative: VEYLINE_API_KEY (Bearer) meters to subscription."
        )
    return f"ERROR (fail-closed, do not retry): {json.dumps(result)[:2000]}"


def _mk(name, description, action, arg_name="input"):
    def _run(text: str) -> str:
        return _render(invoke(action, {arg_name: text}, **_auth()))

    _run.__name__ = name
    return Tool(name=name, description=description, func=_run)


CALLX402_CREWAI_TOOLS = [
    _mk(
        "callx402_diagnose",
        "Diagnose an x402 payment or MCP/x402 failure: WHAT failed and WHY, "
        "before deciding whether a retry is safe. Paid on-demand ($2.00). "
        "Input: JSON evidence string describing the failure.",
        "diagnose", "evidence",
    ),
    _mk(
        "callx402_recover",
        "Recover a lost result after payment (paid but no result) — the "
        "situation where blind retry would double-pay. READ-ONLY. Paid "
        "on-demand ($10.00). Input: operation ID.",
        "recover", "operationId",
    ),
    _mk(
        "callx402_resolve",
        "Resolve settlement uncertainty from evidence INSTEAD OF blind retry "
        "(e.g. was the tx confirmed on chain?). Paid on-demand ($5.00). "
        'Input: JSON like {"txHash":"0x...","network":"base"}.',
        "resolve", "evidence",
    ),
    _mk(
        "callx402_evidence",
        "Ground truth for an incident: event trail + per-plane states "
        "(payment/execution/delivery). Use FIRST. Paid on-demand ($2.00). "
        "Input: operation ID.",
        "evidence", "operationId",
    ),
    _mk(
        "callx402_explain",
        "Plain-language state assessment (NO_BASIS/INCOMPLETE/KNOWN_SAFE/"
        "RECOVERY_CANDIDATE/PARTIAL) plus the safe next step. Paid on-demand "
        "($1.00). Input: operation ID.",
        "explain", "operationId",
    ),
    _mk(
        "callx402_duplicate_payment_risk",
        "Check whether a retry would pay twice BEFORE any retry that touches "
        "money. Paid on-demand ($5.00). Input: summary of the payment intent.",
        "duplicate_payment_risk", "intent",
    ),
]
