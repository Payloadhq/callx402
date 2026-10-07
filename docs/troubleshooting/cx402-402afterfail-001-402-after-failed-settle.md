---
id: CX402-402AFTERFAIL-001
title: "Ambiguous x402 settlement? Reconcile before authorizing another payment"
category: safe-retry
severity: critical
economic_risk: "Generating a new payment authorization while a previous authorization's outcome is unresolved can produce two on-chain transfers for one intent."
search_phrases: ["x402 ambiguous settlement", "x402 settlement reconcile before retry", "x402 double payment new authorization", "x402 settlement_pending reconcile"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md", "https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/shared/settleReceipt.ts", "https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/facilitator/pendingSettlementStore.ts", "https://github.com/ultravioletadao/uvd-x402-sdk-python/commit/86dbb568c87b0e48f170b5c2454e30d27ee6497a"]
related: ["CX402-SETTLEPEND-001", "CX402-SAFFRETRY-001"]
updated: 2026-10-06
---

# Ambiguous x402 settlement? Reconcile before authorizing another payment

## THE PROBLEM

A settlement attempt ends ambiguously: a timeout, an opaque facilitator error,
or `settlement_pending`. The money may have moved; it may not have. The most
expensive mistake now is generating a **new payment authorization** for the
same intent before the first one's outcome is known. If the original
settlement confirms, you have paid twice.

## WHY IT HAPPENS

Three different layers get confused as one. Keep them separate:

1. **HTTP response status.** What the wire said: 402, 500, a timeout. This is
   transport signaling, not economic fact. [protocol]
2. **x402 settlement state.** What the protocol knows: `success: true`,
   `success: false` with a terminal reason, or `settlement_pending` —
   broadcast but confirmation unestablished, explicitly **non-terminal**.
   [protocol]
3. **Payment authorization / signature.** What the client signed: an EIP-3009
   authorization with a unique nonce. This is the thing that moves money, and
   only this layer creates economic effect. [protocol]

The x402 spec defines `settlement_pending` precisely: the settlement
transaction was broadcast but its confirmation could not be established, and
the response MUST carry the broadcast hash and network so the caller can
reconcile on chain before deciding anything. [protocol] The reference
TypeScript facilitator implements exactly this: a failed receipt wait returns
`settlement_pending` with the transaction hash; a reverted receipt returns
the terminal `invalid_transaction_state`. [reference implementation]

A retry becomes dangerous when it causes the client to generate a new
authorization while the outcome of the previous authorization remains
unresolved. Note what that does *not* say: an HTTP 402 does not by itself
require a new authorization. Settlement failures can legitimately surface as
402 — for instance, when the facilitator rejected the request before running
anything — and the spec treats "Payment Required" as ordinary protocol
signaling, not an instruction to sign again. [protocol] The danger is
interpretive: reading a settlement-related response as permission to sign
fresh while the previous authorization may already have settled.

There is also a safe kind of retry that must not be confused with a new
authorization. The reference implementation keeps a pending-settlement store
keyed by the payment payload: when a subsequent settle arrives for the
*identical* payload, the facilitator reconciles against the already-broadcast
transaction instead of broadcasting a second one. [reference implementation]
Same-payload retry and second authorization are different actions. Never
conflate them.

## DO NOT DO THIS

Do not generate a new payment authorization for an intent whose settlement
state is ambiguous. The ambiguity lives in layer 2 (settlement state); the
damage happens in layer 3 (a second signed authorization). No HTTP status code
in layer 1 changes that.

Do not assume a 402 after a settle attempt means "the payment failed, sign
again." It may mean the request was refused before anything ran — or it may
be arriving while the original transaction is still confirming. The status
code alone cannot tell you which.

## THE SAFE FIX

Work the state, not the status code:

1. **AMBIGUOUS / SETTLEMENT_PENDING:** preserve the original payment
   identity. Keep the broadcast transaction hash, the network, and the exact
   payment payload. Sign nothing new.
2. **Reconcile using the transaction hash or payment payload.** Look up the
   broadcast hash on chain (or via the facilitator's pending-settlement
   record). Three outcomes: confirmed, provably failed, or still unknown.
3. **Do not generate a new authorization** while the outcome is unknown. An
   unknown is not a failure; it is a "keep looking."
4. **Retry the identical settlement only where the scheme permits it** —
   resubmitting the same signed payload for reconciliation is not the same as
   signing again.
5. **Issue a genuinely new payment authorization only after a terminal
   outcome** (confirmed failure, expired authorization, provably dead
   transaction) establishes that doing so is safe.

One implementation's approach, labeled as what it is: the UVD Python SDK
answers failures that name a transaction with 500 ("do not sign another,
check the transaction first") while keeping 402 for verify rejections and
requests refused before anything ran. That is a third-party SDK's safety
decision, not a protocol rule. [third-party SDK]

## VERIFY

For one intent, exactly one authorization exists until a terminal outcome is
established. Simulate an ambiguous settle: confirm no code path generates a
second signature, and the broadcast hash reconciles to exactly one on-chain
transfer. Then simulate a provably failed settle and confirm a new
authorization is permitted exactly once.

## Using Callx402 for this condition

For an ambiguous settle, the relevant action is `resolve`. It accepts
settlement evidence as JSON (`callx402 resolve --evidence '<json>'` or
`--evidence @file`): the broadcast transaction hash, the network, the
facilitator's settle and verify responses, and any chain state you have
already looked up. From that evidence it determines which of six
settlement states the operation is in; on anything it cannot decide it
returns UNKNOWN and holds fail-closed — no retry is scheduled, no payment
is repaid, and the process exits non-zero so automation cannot blunder
past it. [tested] The code path has no signing and no broadcast
capability, so there is no route through it to a second authorization;
it works from the original payment identity you supplied. [tested]

Live on-chain reconciliation inside `resolve` was not exercised here: the
resolver reasons over the evidence you hand it — chain state included —
rather than querying the chain itself, and it does not poll a pending
transaction on your behalf. [unproven] The resolver module is also
env-gated (it needs to be enabled before you script against it) and
returns an unreachable result rather than guessing when it is off.

## SOURCES AND VERIFICATION SCOPE

- Protocol claims (three settlement layers, `settlement_pending` semantics,
  402 as ordinary signaling) verified against the x402 specification v2 and
  the reference TypeScript facilitator's pending-settlement store and
  settle receipt handling, current as of 2026-10-06.
- The third-party SDK safety decision is cited from the UVD Python SDK
  commit linked in the front matter, not from the protocol.
- callx402 claims cite the current implementation: `resolve` fail-closed
  behavior and no-signing code path verified against the test suite
  (`test/safety.test.js`, `test/cli-dispatch.test.js`), which runs with
  the resolver module enabled; live chain reconciliation noted as
  unexercised because the resolver is mocks/local-only in this build.
- Problem and fix content verified independently of callx402.
