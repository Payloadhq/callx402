# Problem → action map

The developer/agent problems callx402 exists for, mapped to the live
on-demand action that answers each one. Fee schedule verified live against
`GET https://payload-rail.fly.dev/v1/callx402/actions` on 2026-10-07.
Machine-readable source of truth: https://payloadhq.github.io/agents.json
(`callx402.capabilities`). Programmatic table: `integrations/core.py`
(`PROBLEM_MAP`).

Every action follows the same invocation shape:

```sh
# Unauthenticated -> x402 v2 402 (USDC on Base). Pay deliberately; never blind-retry.
curl -X POST https://payload-rail.fly.dev/v1/callx402/actions/<action> \
  -H 'Content-Type: application/json' -d '<payload>'
```

Free first: `GET /v1/callx402/quote?action=<action>&path=x402` returns the
exact deterministic quote before anything is paid.

**Two tiers.** Several actions exist in both a free local form and the paid
rail form. The free form is read-only and never charges: the CLI command (or
the matching `x402_*` MCP tool) runs against your own machine. The paid form
runs on the production rail and follows the quote-then-pay shape above. The
"Free path" column names the free equivalent; "rail only" means the action
exists only as a paid rail action — typing it as a CLI command fails with a
usage error that points here.

**Fees.** The table lists the Stripe-path fee per action. The x402 path
quoted by the free quote endpoint is exactly that fee divided by 20
(e.g. `resolve`: $5.00 Stripe path / $0.25 x402 path; `recover`: $10.00 /
$0.50). The quote endpoint is the source of truth; the division is
deterministic, not an estimate.

## The map

| # | You see this problem | Invoke this action | Fee (Stripe path) | Free path | Fail-closed rule |
|---|---|---|---|---|---|
| 1 | Settlement uncertainty — can't tell from current info whether the payment settled | `resolve` | $5.00 | `callx402 resolve --evidence ...` / `x402_resolve` | Unknown stays unknown; never auto-retry, never repay |
| 2 | Lost result after payment — paid, but the result never arrived | `recover` | $10.00 | `callx402 recover <op> --identity ...` / `x402_recover` | Read-only: nothing charged, nothing executed; returns the safe recovery decision or the proven prior result, never a blind re-execution |
| 3 | Retry uncertainty — something failed; need what/why before deciding if retry is safe | `diagnose` | $2.00 | `callx402 diagnose --evidence ...` / `x402_diagnose` | Unknown failure class returns UNKNOWN, never a guess |
| 4 | Retry uncertainty, narrowed — is THIS specific retry safe to sign? | `safe_retry` | $5.00 | rail only (start free with `recover`: a SAFE_RETRY verdict there is the read-only answer) | A retry that would double-pay is refused |
| 5 | Duplicate-payment risk — a retry might sign a second authorization for the same intent | `duplicate_payment_risk` | $5.00 | rail only (start free: `resolve` the settlement, then `recover` for the retry verdict) | Ambiguous authorization state blocks the retry |
| 6 | Need proof — ground truth before acting on any incident | `evidence` | $2.00 | `callx402 evidence <op>` / `x402_evidence` | First step in any incident; returns what is recorded, nothing invented |
| 7 | Need explanation — plain-language state assessment before retry/refund/escalate | `explain` | $1.00 | `callx402 explain <op>` / `x402_explain` | INCOMPLETE means do not retry, do not repay |
| 8 | Pre-commit check — intent, payment readiness, risk before an economic operation commits | `preflight` | $3.00 | `callx402 preflight` (local checks) | Blocked stays blocked until the reasons clear |
| 9 | Failure triage — classify the failure so the right playbook runs | `failure_classification` | $2.00 | rail only (start free with `diagnose`) | Unclassifiable failures escalate to human review |
| 10 | Settlement-record interpretation — read a raw settlement record, state what it means | `settlement_interpretation` | $3.00 | rail only (start free with `resolve --evidence ...`) | Ambiguous records are reported ambiguous |
| 11 | Rescue a failed transaction — triage and recover the incident end to end | `rescue` | $15.00 | `callx402 rescue --incident <id>` (triage and quote only, never executes) | Never fabricates success; unreachable subsystems fail closed |
| 12 | Watch an operation/workload for state changes, failures, anomalies | `monitor` | $5.00 | `callx402 monitor --once` (local sentinel snapshot) | An unwatched gap is reported as a gap, not as healthy |
| 13 | Run an economic operation through the protected path (exactly-once) | `execute` | $10.00 | `callx402 execute --intent ... --dry-run` (plans only) | Over-budget intents refused with zero side effects |

## Where each surface consumes this map

- **Agent frameworks** — tool descriptions in `integrations/langchain/` and
  `integrations/crewai/` carry the problem phrasing, so agents (and any
  tool-registration/search surface) discover the right action from the symptom.
- **Automation** — `integrations/n8n/callx402-incident-guard.json` maps
  `incident_type` values to actions (settlement_uncertain → resolve,
  paid_no_result → recover, retry_uncertain → diagnose, need_proof → evidence,
  need_explanation → explain, duplicate_payment_check →
  duplicate_payment_risk, pre_commit → preflight).
- **MCP** — the six read-only `x402_*` tools (`mcp/index.js`) cover the free
  diagnostic subset: diagnose, evidence, explain, recover, resolve, status.
- **Facilitators** — `integrations/facilitator/settle-guard.js` wires problem
  #1 (settlement uncertainty) into the settle path so uncertain payments are
  resolved, never re-broadcast blind.

## Notes

- Action names are canonical in `snake_case`. The rail also accepts the
  hyphenated aliases shown in the OpenAPI enum (`safe-retry`,
  `duplicate-payment-risk`, `settlement-interpretation`,
  `failure-classification`); both forms resolve identically (verified live).
- The x402-path quote is the valuation-layer quote, not the raw schedule;
  the fixed schedule above is the Stripe-path floor.
- Local CLI / MCP-stdio diagnostics are free and read-only — no payment, no
  auth, never Veyline-gated. Paid rail actions are for hosted on-demand
  invocation.
