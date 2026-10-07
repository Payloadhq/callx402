#!/usr/bin/env python3
"""Shared zero-dependency HTTP client for the live callx402 action API.

Plain functions (no framework imports) so LangChain, CrewAI, AutoGen, or any
agent framework can wrap them directly. stdlib only.

The rail's public endpoints:
  GET  /v1/callx402/actions            free — live 13-action fee schedule
  GET  /v1/callx402/quote              free — deterministic pre-execution quote
  POST /v1/callx402/actions/{action}   paid — unauthenticated -> x402 v2 402
                                       (USDC on Base); credit_id / txHash /
                                       Veyline Bearer key -> executes

Fail-closed contract: a 402 is NEVER retried blindly. invoke() surfaces the
machine-readable payment requirements so the agent's wallet layer (or a human)
can pay deliberately. This module never holds funds or private keys.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request

RAIL = os.environ.get("CALLX402_RAIL", "https://payload-rail.fly.dev").rstrip("/")

# Canonical action names (snake_case), verified live 2026-10-07.
# Hyphenated aliases are also accepted by the rail; these are canonical.
ACTIONS = (
    "diagnose", "explain", "evidence", "recover", "resolve", "preflight",
    "monitor", "execute", "rescue", "settlement_interpretation", "safe_retry",
    "failure_classification", "duplicate_payment_risk",
)


USER_AGENT = "callx402-integrations/0.1.0 (+https://github.com/Payloadhq/callx402)"


def _request_once(method, path, body=None, headers=None):
    req = urllib.request.Request(
        RAIL + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": USER_AGENT,
                 **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}"), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"raw": raw[:2000]}
        return exc.code, payload, dict(exc.headers)


def _request(method, path, body=None, headers=None):
    """One retry on truncated transport reads; then fail closed (error dict),
    never a fabricated response."""
    try:
        return _request_once(method, path, body, headers)
    except (http.client.IncompleteRead, http.client.RemoteDisconnected,
            urllib.error.URLError, TimeoutError) as first:
        try:
            return _request_once(method, path, body, headers)
        except Exception as second:
            return 0, {"error": "transport_failed_fail_closed",
                       "detail": f"{type(first).__name__}; retry: {type(second).__name__}. "
                                 "Do not treat as a verdict; do not retry a payment."}, {}


def list_actions():
    """Free. Return the live fee schedule for all 13 callx402 actions."""
    status, payload, _ = _request("GET", "/v1/callx402/actions")
    if status != 200:
        return {"status": "error", "http": status, "detail": payload}
    return {"status": "ok", "actions": payload.get("actions", [])}


def quote(action, path="stripe", exposure_usd=0.0):
    """Free. Deterministic pre-execution quote for one action."""
    qs = urllib.parse.urlencode(
        {"action": action, "path": path, "exposure_usd": exposure_usd}
    )
    status, payload, _ = _request("GET", f"/v1/callx402/quote?{qs}")
    if status != 200:
        return {"status": "error", "http": status, "detail": payload}
    return {"status": "ok", "quote": payload}


def _payment_required_envelope(action, payload402, headers):
    """Parse a 402 into the actionable payment envelope an agent can route
    to its wallet layer. Never fabricates amounts: everything comes from the
    rail's response."""
    accepts = (payload402.get("accepts") or [{}])[0]
    ext = (payload402.get("extensions") or {}).get("payload", {})
    return {
        "status": "payment_required",
        "action": action,
        "x402_version": payload402.get("x402Version"),
        "network": accepts.get("network"),
        "asset": accepts.get("asset"),
        "amount_atomic": accepts.get("amount"),
        "quoted_price_usd": ext.get("quoted_price_usd"),
        "pay_to": accepts.get("payTo"),
        "max_timeout_seconds": accepts.get("maxTimeoutSeconds"),
        "quote_id": ext.get("quote_id"),
        "quote_expires": ext.get("expires_at"),
        "how_to_redeem": {
            "method": "POST",
            "url": f"/v1/callx402/actions/{action}",
            "body": {
                "txHash": "0x... (Base USDC payment to pay_to)",
                "quote_id": ext.get("quote_id"),
                "note": "payment must reference quote_id; rail re-derives the "
                        "quote server-side and rejects underpayment, expired "
                        "quotes, and quote_id mismatch. Each txHash is "
                        "single-use; replays are rejected 409.",
            },
        },
        "alternatives": {
            "stripe_checkout": f"POST /v1/callx402/checkout {{\"action\": \"{action}\"}} "
                               "-> one-time checkout -> single-use credit",
            "veyline": "Veyline subscribers: Authorization: Bearer <veyline-key> "
                       "instead of paying per action (metered to subscription)",
        },
    }


def invoke(action, payload=None, api_key=None, credit_id=None, tx_hash=None,
           quote_id=None):
    """Invoke a live callx402 action.

    Returns one of:
      {"status": "ok", ...}               — action executed
      {"status": "payment_required", ...} — x402 402: pay deliberately, never
                                            auto-retry or auto-repay
      {"status": "error", ...}             — 4xx/5xx: fail closed, do not retry

    Auth precedence: explicit api_key (Veyline Bearer) > credit_id/tx_hash
    in the body > unauthenticated (402 expected for paid actions).
    """
    if action not in ACTIONS:
        return {"status": "error", "detail": f"unknown action {action!r}"}
    body = dict(payload or {})
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if credit_id:
        body["credit_id"] = credit_id
    if tx_hash:
        body["txHash"] = tx_hash
    if quote_id:
        body["quote_id"] = quote_id
    status, data, headers_out = _request(
        "POST", f"/v1/callx402/actions/{action}", body, headers
    )
    if status == 402:
        return _payment_required_envelope(action, data, headers_out)
    if 200 <= status < 300:
        return {"status": "ok", "action": action, "result": data}
    return {"status": "error", "action": action, "http": status, "detail": data}


# ---------------------------------------------------------------------------
# Problem -> action mapping (Task: map developer/agent problems to live actions)
# ---------------------------------------------------------------------------
# Each entry: the symptom an agent/developer sees, the canonical action to
# invoke, and the fail-closed rule that governs it. Fee schedule verified
# live against GET /v1/callx402/actions on 2026-10-07.

PROBLEM_MAP = [
    {
        "problem": "Settlement uncertainty — a payment/operation whose "
                   "settlement state cannot be determined from current info.",
        "action": "resolve",
        "fee_usd": 5.00,
        "when": "Settlement pending and you need it resolved from evidence "
                "(e.g. was the broadcast tx confirmed on chain?). Use INSTEAD "
                "OF blind retry.",
        "fail_closed": "Unknown stays unknown; never auto-retry, never repay.",
    },
    {
        "problem": "Lost result after payment — paid, but the result never arrived.",
        "action": "recover",
        "fee_usd": 10.00,
        "when": "Payment succeeded but the result was lost. Returns the safe "
                "recovery decision, or the prior result where proven — never a "
                "blind re-execution.",
        "fail_closed": "READ-ONLY: nothing charged, nothing executed.",
    },
    {
        "problem": "Retry uncertainty — something went wrong and you need to "
                   "know what before deciding whether a retry is safe.",
        "action": "diagnose",
        "fee_usd": 2.00,
        "when": "Something went wrong with an x402 payment or MCP/x402 "
                "interaction; get the diagnosis (what failed, why, retry-safe?) "
                "from failure evidence.",
        "fail_closed": "If the failure class is unknown, the verdict is "
                       "UNKNOWN — do not retry.",
    },
    {
        "problem": "Retry uncertainty, narrowed: is THIS specific retry safe?",
        "action": "safe_retry",
        "fee_usd": 5.00,
        "when": "You have a candidate retry and need a go/no-go verdict on "
                "that exact retry before signing anything.",
        "fail_closed": "No verdict without evidence; a retry that would "
                       "double-pay is refused.",
    },
    {
        "problem": "Duplicate-payment risk — a retry might sign a second "
                   "authorization for the same intent and pay twice.",
        "action": "duplicate_payment_risk",
        "fee_usd": 5.00,
        "when": "Before any retry that touches money: check whether the "
                "original intent already settled or authorized.",
        "fail_closed": "Ambiguous authorization state blocks the retry.",
    },
    {
        "problem": "Need proof — establish ground truth before acting on an incident.",
        "action": "evidence",
        "fee_usd": 2.00,
        "when": "FIRST step in any incident: event trail + latest per-plane "
                "states (payment/execution/delivery).",
        "fail_closed": "No evidence, no action: returns what is recorded, "
                       "nothing invented.",
    },
    {
        "problem": "Need explanation — plain-language assessment of an "
                   "operation's state before deciding retry/refund/escalate.",
        "action": "explain",
        "fee_usd": 1.00,
        "when": "You need a state assessment (NO_BASIS / INCOMPLETE / "
                "KNOWN_SAFE / RECOVERY_CANDIDATE / PARTIAL) plus the safe next "
                "step.",
        "fail_closed": "INCOMPLETE means do not retry, do not repay.",
    },
    {
        "problem": "Pre-commit check — verify intent, payment readiness, and "
                   "risk before an economic operation commits.",
        "action": "preflight",
        "fee_usd": 3.00,
        "when": "Before any economic operation: verdict is safe-to-proceed, "
                "blocked-with-reasons, or needs-changes.",
        "fail_closed": "Blocked stays blocked until the reasons clear.",
    },
    {
        "problem": "Failure triage — classify what kind of failure this is "
                   "so the right playbook runs.",
        "action": "failure_classification",
        "fee_usd": 2.00,
        "when": "Route an incident to the correct playbook from its evidence.",
        "fail_closed": "Unclassifiable failures escalate to human review.",
    },
    {
        "problem": "Settlement-record interpretation — read a raw settlement "
                   "record and state what it means.",
        "action": "settlement_interpretation",
        "fee_usd": 3.00,
        "when": "You have on-chain or facilitator settlement records and need "
                "them interpreted, not guessed at.",
        "fail_closed": "Ambiguous records are reported ambiguous.",
    },
    {
        "problem": "Rescue a failed transaction — triage and recover an "
                   "incident end to end.",
        "action": "rescue",
        "fee_usd": 15.00,
        "when": "A transaction failed and needs triage plus recovery routing.",
        "fail_closed": "Rescue never fabricates success; unreachable "
                       "subsystems fail closed.",
    },
    {
        "problem": "Watch an operation or workload for state changes, "
                   "failures, or anomalies.",
        "action": "monitor",
        "fee_usd": 5.00,
        "when": "Continuous or one-shot watch over an operation/workload.",
        "fail_closed": "An unwatched gap is reported as a gap, not as healthy.",
    },
    {
        "problem": "Run an economic operation through the protected path "
                   "with exactly-once semantics.",
        "action": "execute",
        "fee_usd": 10.00,
        "when": "Execute under explicit budget with idempotency; on-demand, "
                "never requires a Veyline subscription.",
        "fail_closed": "Over-budget intents are refused with zero side effects.",
    },
]

FREE_LOCAL_ALTERNATIVE = (
    "Local CLI / MCP-stdio diagnostics are free and read-only "
    "(git clone https://github.com/Payloadhq/callx402; "
    "node mcp/index.js as an MCP server). The paid rail actions above are "
    "for hosted on-demand invocation with payment."
)


if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "actions"
    if cmd == "actions":
        print(json.dumps(list_actions(), indent=2)[:4000])
    elif cmd == "map":
        for entry in PROBLEM_MAP:
            print(f"- {entry['problem']}\n  -> {entry['action']} "
                  f"(${entry['fee_usd']:.2f}) — {entry['when']}\n")
    elif cmd == "invoke":
        action = sys.argv[2]
        payload = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        print(json.dumps(
            invoke(action, payload,
                   api_key=os.environ.get("VEYLINE_API_KEY"),
                   credit_id=os.environ.get("CALLX402_CREDIT_ID")),
            indent=2)[:4000])
    else:
        sys.exit(f"unknown command {cmd!r}; use: actions | map | invoke <action> [json]")
