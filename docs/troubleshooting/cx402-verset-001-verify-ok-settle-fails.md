---
id: CX402-VERSET-001
title: "x402 verify works but settle fails: the trust gap between the two calls"
category: facilitator-settle
severity: high
economic_risk: "Verify-passing authorizations can be invalid at settle time (funds moved, nonce reused); sellers who act on verify alone do unpaid work. Opaque settle errors also stall integrations."
search_phrases: ["x402 verify works settle fails", "x402 invalid_payload settle", "x402 verify then settle", "x402 settle 400 invalid_payload"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/961", "https://github.com/x402-foundation/x402/issues/447", "https://dev.to/mkmkkkkk/x402-payment-timeouts-why-your-agent-loses-money-and-how-to-fix-it-fgk"]
related: ["CX402-SETTLEPEND-001", "CX402-SAFFRETRY-001"]
updated: 2026-10-06
---

# x402 verify works but settle fails: the trust gap between the two calls

## THE PROBLEM

`/verify` returns success. You proceed — and `/settle` fails, sometimes with an
opaque `{"errorReason":"invalid_payload"}` and a 400 that tells you nothing
about what went wrong. Or worse: you're a seller, you did the work after
verify passed, and settlement never completes.

## WHY IT HAPPENS

`/verify` and `/settle` answer different questions at different times, and the
world can change between them:

1. **Verify checks the authorization; settle moves the money.** An EIP-3009
   authorization that is valid at verify time can be invalid at settle time:
   the buyer withdrew funds between the calls, submitted the same authorization
   to two sellers at once, or reused a nonce. Circle's payments team raised
   exactly this double-spend pattern upstream
   ([x402-foundation/x402#447](https://github.com/x402-foundation/x402/issues/447)).
   Verify is a point-in-time opinion, not a guarantee.

2. **Settle has undocumented requirements.** In one documented case, verify
   passed but settle rejected every attempt with `invalid_payload`. Root cause,
   found only after days of debugging: the token `name` field had to be
   `"USD Coin"`, not `"USDC"`, and amounts had a $0.001 minimum — neither
   requirement in the spec
   ([x402-foundation/x402#961](https://github.com/x402-foundation/x402/issues/961)).

So "verify passed" means "this looked fine a moment ago," and settle failures
range from adversarial (double-spend) to bureaucratic (a string field).

## DO NOT DO THIS

**Sellers: do not perform work or deliver goods on the strength of `/verify`
alone.** The verify-then-serve pattern is the double-spend vector: by the time
you settle, the authorization may be worthless, and you've already done the
work. This isn't theoretical — it's the exact pattern in #447.

**Builders: do not loop verify→settle retries** hoping the opaque error
resolves itself. If settle rejects the payload, re-verifying the same payload
changes nothing and burns time.

## THE SAFE FIX

1. **Read the settle error literally.** `invalid_payload` at settle with a
   passing verify means the payload violates a settle-time rule. Check: exact
   token `name` string (`"USD Coin"`), amount minimums, network/asset match
   against the 402 requirements, and EIP-3009 field formatting (validAfter /
   validBefore windows, nonce encoding).
2. **Diff your payload against the 402 challenge**, field by field. The most
   common settle-only rejections are mismatches the verify step doesn't check.
3. **Sellers: settle before serving, or serve only what you'd give away.**
   If your flow must do work before settlement completes, cap the exposure
   per request and treat verify as advisory.
4. **Log both responses with timestamps.** When the gap between verify and
   settle is large, suspect state change (funds moved) rather than payload bugs.

## VERIFY

The issue is resolved when `/settle` returns success for a payload that
`/verify` accepted, with the differences between the two calls understood and
documented in your integration. For sellers: the fix is verified when no work
is performed before settlement is confirmed — test with an authorization that
you deliberately invalidate between verify and settle, and confirm your system
refuses to serve.

## AUTOMATED

callx402's `diagnose` runs the failure classifiers over both responses so you
don't diff them by hand: `callx402 diagnose --evidence
'{"verifyResponse":{...},"settleResponse":{...}}'`.
