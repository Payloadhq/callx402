---
id: CX402-PAIDNORES-001
title: "x402 paid but the tool didn't execute: the lost-result problem"
category: paid-no-result
severity: critical
economic_risk: "Payment settles but the result never arrives; buyer has no recourse artifact. Blind retry risks double payment AND double execution."
search_phrases: ["x402 paid but no response", "x402 payment settled but no response", "x402 paid but tool didn't execute", "x402 did it deliver", "x402 lost result after payment"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/1195", "https://github.com/x402-foundation/x402 (v2 spec, section 6.1)"]
related: ["CX402-SAFFRETRY-001", "CX402-SETTLEPEND-001"]
updated: 2026-10-06
---

# x402 paid but the tool didn't execute: the lost-result problem

## THE PROBLEM

The payment settled — you can see it on chain. But the tool never executed, or
it executed and the response never came back. You paid for a result you don't
have, and nothing in the protocol proves what happened after the money moved.

## WHY IT HAPPENS

The x402 payment lifecycle has an ordering the spec defines but can't enforce
for you: verify → resource executes → settle → respond (spec §6.1). Two crash
windows fall out of that ordering:

1. **Settle succeeds, response is lost.** Network drop, proxy timeout, server
   crash after settlement — the client paid for a result it never received.
2. **The ecosystem has no delivery proof layer.** As the most-discussed issue
   in the x402 tracker puts it: "x402 solves how agents pay... None of these
   layers prove delivery" — escrow, reputation, and orchestration systems all
   need to answer "did the agent actually deliver what was paid for," and
   right now each either skips the check or trusts self-reporting
   ([x402-foundation/x402#1195](https://github.com/x402-foundation/x402/issues/1195),
   103 comments).

So the protocol gets your money to the seller reliably, and then goes quiet
about whether you got anything back.

## DO NOT DO THIS

Do not re-pay and re-execute blindly. This is the double-jeopardy state: a
fresh payment risks double payment, and a fresh execution risks double
execution (the first one may have run — you just never saw the result). Both
failure modes from one retry.

Do not accept "the transaction confirmed" as proof of delivery. On-chain
settlement proves payment, not execution. They are different planes; conflating
them is how paid-no-result becomes undetectable.

## THE SAFE FIX

1. **Separate the planes.** Ask three distinct questions: did payment settle?
   (check the chain) — did execution happen? (check the server's records, or
   ask) — did delivery happen? (do you hold the result?). Most "paid but
   nothing happened" incidents are a delivery failure, not an execution
   failure — and re-execution is the wrong fix for a delivery failure.
2. **Request the settlement receipt.** The spec's `PAYMENT-RESPONSE` carries
   the transaction hash. Keep it: it's your proof of payment, and it's what
   lets you or the seller reconcile without paying again.
3. **If execution is unproven, ask before re-executing.** Contact the resource
   operator with the settlement hash and ask whether execution occurred. Only
   re-execute when execution is proven not to have happened — or when the
   operation is provably idempotent.
4. **For agents:** never auto-retry a paid-no-result. Park the operation for
   human review or evidence-gated recovery. An agent that retries paid
   operations on its own is a double-spend machine.

## VERIFY

Resolved when you can answer all three planes from evidence: payment settled
(tx hash, confirmed), execution state known (executed / not executed, from the
operator or logs), delivery confirmed (result in hand). If any plane is still
UNKNOWN, the incident is open — do not close it by retrying.

## AUTOMATED

The three-plane check above is what callx402's `evidence`, `explain`, and
`recover` actions do from recorded data: `callx402 evidence op_abc123` answers
per plane, `explain` classifies, `recover` gives the read-only verdict on
whether retry is safe.
