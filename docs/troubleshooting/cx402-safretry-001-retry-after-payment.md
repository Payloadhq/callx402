---
id: CX402-SAFFRETRY-001
title: "x402 retry after payment: when it's safe and when it double-pays"
category: safe-retry
severity: critical
economic_risk: "Retrying after an ambiguous failure can double-charge the buyer; not retrying can abandon a paid result. Both directions cost money."
search_phrases: ["x402 retry after payment", "x402 safe retry", "x402 duplicate payment retry", "x402 timeout after paying", "x402 AuthorizationUsed retry"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/452", "https://github.com/x402-foundation/x402/issues/831"]
related: ["CX402-SETTLEPEND-001", "CX402-DUPPAY-001"]
updated: 2026-10-06
---

# x402 retry after payment: when it's safe and when it double-pays

## THE PROBLEM

Your request timed out after payment was prepared or sent. Or `/settle`
returned an error you can't interpret. The payment may have gone through; it
may not have. Every instinct says "just try again" — and that instinct is
exactly what causes duplicate payments in x402.

## WHY IT HAPPENS

Two protocol facts combine into this trap:

1. **Duplicate submissions are ambiguous.** The x402 spec doesn't define how
   facilitators handle the same payload submitted twice. In practice, retrying
   the same EIP-3009 authorization after a transient failure can trigger an
   `AuthorizationUsed` revert in the token contract, surfaced as
   `success: false` — which is indistinguishable from a genuine failure
   ([x402-foundation/x402#452](https://github.com/x402-foundation/x402/issues/452)).
   You can't tell "already settled, stop" from "actually failed, try again."

2. **Timeouts don't mean failures.** x402 integrations commonly run behind
   edge networks, serverless functions, and proxies with strict timeouts. A
   timeout after the payment was sent tells you nothing about whether the
   facilitator processed it
   ([x402-foundation/x402#831](https://github.com/x402-foundation/x402/issues/831)).
   The issue text is blunt: without guidance, "clients may retry in unsafe
   ways, potentially leading to duplicate payments."

So the retry decision is being made with systematically incomplete information,
and both wrong answers cost money: retry into a double-pay, or don't retry and
abandon a result you already paid for.

## DO NOT DO THIS

Do not blindly re-sign and resubmit after any ambiguous failure — timeout,
`settlement_pending`, `AuthorizationUsed`, or an opaque `invalid_payload`.
Each fresh signature is a fresh authorization to move funds. If the first one
settled, you've now paid twice.

Do not assume an error response means "no money moved." In async settlement,
error responses describe the facilitator's knowledge, not the chain's state.

## THE SAFE FIX

Retry is safe only when one of these is true:

1. **You can prove the first attempt is dead.** For `settlement_pending`, the
   spec requires the broadcast hash — check it on chain. Only re-sign after
   the original is provably failed or dropped.
2. **The failure is pre-broadcast.** If `/verify` rejected the payload
   (invalid signature, insufficient balance, malformed), nothing went on
   chain. Fix the payload and submit — but reuse the same idempotency key if
   your client supports one, so a delayed duplicate is deduped.
3. **You have an idempotency mechanism.** If your integration keys retries by
   the EIP-3009 nonce (proposed upstream in #452), a duplicate submission
   resolves to "already settled" instead of a second charge. Until the
   ecosystem standardizes this, implement it client-side: one nonce per
   intent, never mint a second authorization for the same intent while the
   first is unresolved.

The decision tree is: **evidence first, signature second.** Never sign before
you've checked what the first signature did.

## VERIFY

Reconcile exactly one on-chain transfer per intent: one transaction hash,
correct recipient, correct amount, confirmed. If your retry produced a second
confirmed transfer for the same intent, the retry logic is unsafe — fix it
before it runs in production again. Log every retry decision with the evidence
that justified it; "we retried because the timeout expired" is not evidence.

## AUTOMATED

The evidence-first decision tree above is what callx402's `explain` and
`recover` actions encode: `callx402 explain op_abc123` classifies the state,
and `callx402 recover` gives a read-only safe-retry verdict. Nothing charged,
nothing executed, either way.
