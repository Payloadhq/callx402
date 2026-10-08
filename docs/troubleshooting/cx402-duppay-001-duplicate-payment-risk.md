---
id: CX402-DUPPAY-001
title: "x402 duplicate-payment risk: one intent, two authorizations"
category: duplicate-payment-risk
severity: critical
economic_risk: "A retry that signs a second authorization for the same intent produces two on-chain transfers for one purchase. No error message, no warning."
search_phrases: ["x402 duplicate payment", "x402 paid twice", "x402 double payment", "x402 retry double charge", "x402 second authorization same intent"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/452", "https://github.com/x402-foundation/x402/issues/831", "https://github.com/x402-foundation/x402 (v2 spec, section 9)"]
related: ["CX402-SAFFRETRY-001", "CX402-SETTLEPEND-001", "CX402-PAIDNORES-001"]
updated: 2026-10-07
---

# x402 duplicate-payment risk: one intent, two authorizations

## THE PROBLEM

You have one intent — pay for one thing — but the payment path may have
already produced an authorization. A retry that mints a *second*
authorization for the same intent can settle twice: two on-chain transfers,
one purchase. The protocol does not stop you; the second signature is a
fresh, valid instruction to move funds.

## WHY IT HAPPENS

Three protocol facts combine:

1. **Authorizations are bearer-like.** An EIP-3009 authorization, once
   signed, instructs the token contract to move funds. Signing a second
   one for the same intent creates a second independent instruction — the
   chain cannot know you meant them as alternatives.
2. **Ambiguous states invite the second signature.** `settlement_pending`
   ("broadcast but unconfirmed"), timeouts after payment was sent, and
   `AuthorizationUsed` reverts (which look like genuine failures) all leave
   the operator unsure whether the first authorization settled. The
   instinct is to sign again — exactly the wrong move while the first
   authorization may still be live
   ([x402-foundation/x402#452](https://github.com/x402-foundation/x402/issues/452),
   [x402-foundation/x402#831](https://github.com/x402-foundation/x402/issues/831)).
3. **Duplicate submission is undefined.** The x402 spec does not define how
   facilitators handle the same payload twice, so there is no standard
   "already settled" dedupe to save you.

## DO NOT DO THIS

Do not sign a second authorization for the same intent while the first
one's fate is unknown. "Unknown" is not "failed." A second signature is
never a status check — it is a second payment instruction.

Do not treat a retry as safe because the first attempt "probably" failed.
Probably is not evidence, and the cost of being wrong is a full second
payment.

## THE SAFE FIX

1. **Prove the first authorization dead before minting a second.** For
   `settlement_pending`, the spec requires the broadcast hash — reconcile
   it on chain. Confirmed means stop. Failed/dropped means (and only means)
   it is safe to sign again.
2. **Separate the questions.** "Did the money move?" is answered by
   settlement evidence, not by retrying. "Is this specific retry safe to
   sign?" is answered only after the first question is settled.
3. **One nonce per intent, client-side.** Until the ecosystem standardizes
   retry-by-nonce, never mint a second authorization for an intent while
   the first is unresolved. Key retries by the EIP-3009 nonce where your
   client supports it.

## VERIFY

Reconcile exactly one on-chain transfer per intent: one transaction hash,
correct recipient, correct amount, confirmed. If a retry produced a second
confirmed transfer for the same intent, the retry logic is unsafe — fix it
before it runs again. Log every retry decision with the evidence that
justified it.

## Using Callx402 for this condition

Start free and read-only. First, settle the money question with `resolve`:

```
callx402 resolve --evidence '{"txHash":"0x...","network":"base"}'
```

Then get the read-only retry verdict with `recover`:

```
callx402 recover <operationId> --identity <id>
```

A SAFE_RETRY verdict is the free, read-only answer. If the settlement
behind the operation is UNKNOWN, `recover` refuses outright
(SETTLEMENT_UNKNOWN -> HUMAN_REVIEW) — no retry, no repay, no bypass.

When you need the production rail to judge the duplicate-payment risk of a
*specific* retry plan, use the paid one-off `duplicate_payment_risk`
action. Quote first (free), then pay deliberately — never blind-retry a
payment to reach it:

```sh
# 1. Free quote: $0.25 on the x402 path
curl "https://payload-rail.fly.dev/v1/callx402/quote?action=duplicate_payment_risk&path=x402"

# 2. Invoke unauthenticated -> HTTP 402 with exact USDC terms (Base, 300s window)
curl -X POST https://payload-rail.fly.dev/v1/callx402/actions/duplicate_payment_risk \
  -H 'Content-Type: application/json' -d '{"intent_summary":"..."}'

# 3. Pay from an authorized wallet, then retry with {txHash, quote_id}
```

The action's fail-closed rule: an ambiguous authorization state blocks the
retry rather than blessing it. For the adjacent narrowed question — "is
THIS specific retry safe to sign?" — the paid `safe_retry` action follows
the same quote-then-pay shape. Both are rail-only paid actions: there is no
CLI command or MCP tool for them (typing one at the CLI prints a usage
error that points to `docs/problem-map.md`). Start with the free
`resolve`/`recover` sequence above before spending.

Tested: the free sequence (`resolve` UNKNOWN -> exit 5, `recover`
read-only verdicts) is covered by the dispatch and veyline command suites.
The paid action's quote endpoint and 402 payment terms were verified live
against the rail on 2026-10-07; the paid verdict itself was not executed
(no payment was made).

Limitation: the free verdicts reason from recorded evidence only. If the
operation was never recorded, they say so instead of inventing a basis —
gather the settlement evidence first.

## SOURCES / VERIFICATION SCOPE

Protocol claims cite the x402 v2 spec and the issue tracker links in the
frontmatter, independently of callx402. Callx402 claims above were checked
against the source tree (`core/veyline.js`, `core/index.js`, `bin/callx402.js`),
the dispatch and veyline command test suites, and live rail responses
(quote endpoint, 402 terms, fee schedule) as of 2026-10-07. No payment was
made and no paid verdict was executed for this article.
