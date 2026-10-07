---
id: CX402-SETTLEPEND-001
title: "x402 settlement_pending: what it means and why retrying can double-pay"
category: settlement-pending
severity: critical
economic_risk: "Blind retry after settlement_pending signs a second authorization; two on-chain transfers for one intent."
search_phrases: ["x402 settlement_pending", "x402 settlement pending what to do", "x402 settle retry pending", "x402 broadcast but not confirmed"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402 (v2 spec, section 9)", "https://github.com/hummusonrails/x402-facilitator/blob/HEAD/README.md", "https://github.com/x402-foundation/x402/issues/452"]
related: ["CX402-SAFFRETRY-001", "CX402-DUPPAY-001"]
updated: 2026-10-06
---

# x402 `settlement_pending`: what it means and why retrying can double-pay

## THE PROBLEM

Your `/settle` call returned `success: false` with `errorReason: "settlement_pending"`.
The payment isn't confirmed, but it isn't failed either. You're staring at an
ambiguous state: did the money move or not?

## WHY IT HAPPENS

In the x402 v2 spec (§9), `settlement_pending` means exactly this: "the settlement
transaction was broadcast but its confirmation could not be established." The
facilitator put your transaction on chain, but couldn't confirm it made it into
a block — RPC timeout, congestion, or the facilitator gave up waiting.

Critically, the spec marks this code **non-terminal**: the transaction may still
confirm on chain after the facilitator stopped watching. A `SettleResponse`
carrying this code MUST include the broadcast transaction hash and network, so
you can reconcile on chain before deciding anything.

This is the fundamental ambiguity of async settlement: "I don't know yet" is a
valid, expected state, not an error in the usual sense.

## DO NOT DO THIS

Do not treat `settlement_pending` as failure and sign a fresh authorization.
This is the single most expensive mistake in this state: your first transaction
may confirm minutes later, and now you've authorized two transfers for one
intent. Double payment, no error message, no warning.

Also do not hammer `/settle` with the same payload in a tight loop. The x402
issue tracker documents that duplicate submissions can surface as
`AuthorizationUsed` reverts, which look like genuine failures — so now you have
two indistinguishable problems instead of one
([x402-foundation/x402#452](https://github.com/x402-foundation/x402/issues/452))..

## THE SAFE FIX

1. **Extract the broadcast hash** from the `SettleResponse` (`transaction` and
   `network` fields — the spec requires them on this code).
2. **Reconcile on chain first.** Look up the transaction hash on a block
   explorer or via RPC for the reported network. Three outcomes:
   - **Confirmed:** settlement happened. Record it, move on. Do not retry.
   - **Failed/dropped:** the transaction provably did not go through. Now —
     and only now — is it safe to sign a fresh authorization.
   - **Still unconfirmed:** wait and re-check. Set a deadline (e.g., 10 minutes
     past broadcast); only sign again after the deadline with no confirmation.
3. **Never sign a second authorization for the same intent** while the first
   hash is still potentially live.

## VERIFY

The issue is resolved when exactly one of these is true: the original broadcast
hash shows a confirmed on-chain transfer to the correct recipient for the
correct amount — or a replacement authorization was signed only after the
original was proven dead, and the replacement confirmed. Check your ledger:
one intent, one transfer. If you see two, the retry was unsafe.

## Using Callx402 for this condition

The `resolve` action runs the same reconciliation logic from one place. Feed it the evidence bundle you gathered above:

```
callx402 resolve --evidence '{"txHash":"0x...","network":"base","chainState":"pending"}'
```

It accepts a JSON string (or `@file`) describing what you know: typically the broadcast transaction hash, the network, the on-chain state you observed, and any facilitator responses. It evaluates the bundle through the settlement resolver, which deterministically maps it to one of six certainty states — DEFINITELY_PAID, DEFINITELY_NOT_PAID, AUTHORIZED_NOT_SETTLED, SETTLEMENT_PENDING, CONFLICT, UNKNOWN — and attaches a retry policy, a confidence level, and the basis for the verdict.

It returns a disposition statement, the settlement state, the transaction hash, and the full resolution record. When the evidence is too thin to decide, the state is UNKNOWN and the command exits 5 rather than guessing.

What it deliberately refuses to do: the resolver is read-only analysis. It never queries the chain itself, never signs, never retries, and never repays. An UNKNOWN state stays UNKNOWN unless an operator records an explicit, auditable override — it will not silently become a repay.

Tested: yes. Dispatch tests cover the UNKNOWN path (exit 5) and the disabled-subsystem refusal (exit 3).

Limitation: the verdict is only as good as the evidence you supply. It organizes what you found; it does not do the chain lookup for you, and it cannot improve on a hash you never reconciled.

## SOURCES / VERIFICATION SCOPE

Protocol claims cite the x402 v2 spec and the issue tracker links in the frontmatter, independently of callx402. Callx402 claims above were checked against the source tree (`core/index.js`, `core/subsystems.js`, `bin/callx402.js`, the settlement resolver) and the dispatch test suite (`test/cli-dispatch.test.js`) as of 2026-10-06. The tool was not exercised live against a mainnet facilitator for this article.
