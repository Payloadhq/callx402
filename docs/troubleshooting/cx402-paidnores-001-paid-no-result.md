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

## Using Callx402 for this condition

The three-plane check in the SAFE FIX section maps to a three-step sequence. Start with `evidence`:

```
callx402 evidence <operationId>
```

It accepts an operation id (and optionally `--dir` to point at a different ledger store). It evaluates the operation ledger's recorded events: the latest per-plane states (payment, execution, delivery), the protocols involved, and an event trail. It returns those states, the trail, and a plain statement of basis — including "no events recorded for this operation," stated plainly rather than hidden.

The follow-on sequence: `explain <operationId>` classifies the recorded state — NO_BASIS, INCOMPLETE (any UNKNOWN plane means do not retry, do not repay), KNOWN_SAFE, RECOVERY_CANDIDATE, or PARTIAL — and a RECOVERY_CANDIDATE verdict points you to `recover <operationId>`, which returns the read-only safe-recovery verdict described in the companion retry article (`cx402-safretry-001-retry-after-payment.md`).

When the free read-only verdict is not enough and you need the production rail to recover the incident, the paid one-off `recover` rail action follows the quote-then-pay shape: free quote at `GET /v1/callx402/quote?action=recover&path=x402` ($0.50 on the x402 path), then `POST /v1/callx402/actions/recover` returns HTTP 402 with the exact USDC terms — pay deliberately from an authorized wallet and retry with `{txHash, quote_id}`. See `docs/problem-map.md` for the full problem-to-action map.

What the sequence deliberately refuses to do: all three steps are read-only. None of them re-executes the tool, re-settles the payment, or triggers a retry. `recover` states its verdict and stops there.

Tested: yes. The veyline command suite covers evidence reporting (including the honest no-basis case), explain assessments, and the read-only recover decisions.

Limitation: everything here answers from the ledger's recorded events. If the operation was never recorded — or the execution record lives only with the resource operator — `evidence` reports no basis, and the remaining steps can only tell you what is missing, not fill it in.

## SOURCES / VERIFICATION SCOPE

Protocol claims cite the x402 v2 spec and the issue tracker link in the frontmatter, independently of callx402. Callx402 claims above were checked against the source tree (`core/veyline.js`, `bin/callx402.js`) and the veyline command test suite (`test/veyline-commands.test.js`) as of 2026-10-06. The tool was not exercised live against a mainnet facilitator for this article.
