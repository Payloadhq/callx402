---
id: CX402-EIP3009-001
title: "EIP-3009 authorization rejected at verify: the field-level checklist"
category: eip3009
severity: high
economic_risk: "Malformed authorizations fail closed at verify (no funds move), but each wrong field costs a debugging cycle; 'fixing' nonce reuse by minting a fresh authorization can double-pay."
search_phrases: ["x402 EIP-3009 invalid signature", "x402 token_name_mismatch", "x402 authorization_valid_before", "x402 nonce_already_used"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/961", "https://github.com/hummusonrails/x402-facilitator/blob/HEAD/README.md", "https://github.com/x402-foundation/x402/raw/refs/heads/main/contracts/evm/audits/cantina_x402_may2026.pdf"]
related: ["CX402-VERSET-001", "CX402-SAFFRETRY-001"]
updated: 2026-10-06
---

# EIP-3009 authorization rejected at verify: the field-level checklist

## THE PROBLEM

`/verify` rejects your authorization and the reason reads like alphabet soup:
`invalid_exact_evm_payload_signature`, `invalid_exact_evm_token_name_mismatch`,
`invalid_exact_evm_payload_authorization_valid_before`,
`invalid_exact_evm_nonce_already_used`. The signature is real — your wallet
signed it — but the facilitator will not accept it.

## WHY IT HAPPENS

EIP-3009 authorizations are exact-match instruments. Every field must match
what the token contract expects, and the failure modes are field-specific:

**EIP-712 domain.** The `name` and `version` must match the token's on-chain
EIP-712 domain. For USDC the domain is `name: "USD Coin"`, `version: "2"` —
not `"USDC"`. Signing with the wrong domain produces a signature that
recovers to the wrong address, which surfaces as an invalid signature. This
is the single most common "my signature is valid but the facilitator rejects
it" cause, called out independently across facilitator docs and integrations
([x402-foundation/x402#961](https://github.com/x402-foundation/x402/issues/961)).

**Validity window.** `validAfter` and `validBefore` are unix timestamps, both
required. Quote at T, sign, submit after `validBefore` — a slow agent, a
queued retry, clock skew — and verify rejects it as expired. Re-signing the
same expired payload never succeeds.

**Nonce.** Each authorization carries a unique 32-byte nonce; reuse is
rejected on-chain and at verify. Replay is structurally blocked, which is a
security property — until your retry logic fights it.

**Amount, recipient, encoding.** `authorization.value` must exactly equal the
quoted `amount`; `authorization.to` must equal `payTo`; `amount` is a string
in atomic units; the asset address is lowercase hex.

**Type ordering.** The Cantina audit of the batch-settlement contracts found
EIP-712 type strings built with struct types in the wrong order, violating
the alphabetical-ordering rule — standard wallets (ethers, viem, MetaMask,
hardware) sort alphabetically and sign a different digest than the contract
expects
([cantina_x402_may2026.pdf](https://github.com/x402-foundation/x402/raw/refs/heads/main/contracts/evm/audits/cantina_x402_may2026.pdf),
finding 3.1.1).

## DO NOT DO THIS

Do not re-sign with the same parameters hoping it passes. If the domain is
wrong, every signature you produce is wrong — the fix is the domain, not the
signing.

Do not "fix" `nonce_already_used` by minting a fresh authorization for the
same intent without checking whether the first one settled. That converts a
replay rejection into a double payment.

Do not reconstruct the quote client-side. Feed the server's returned terms
straight into the signer; a reconstructed quote that differs by one field
fails `value_mismatch` or `recipient_mismatch`.

## THE SAFE FIX

Walk the checklist in order — the first failure you find is almost always the
cause:

1. **Domain:** `name` and `version` match the token's actual on-chain EIP-712
   domain. For USDC: `"USD Coin"` / `"2"`. Never guess; read the contract.
2. **Type ordering:** EIP-712 struct types alphabetical. If wallet signatures
   and contract expectations disagree, this is the seam.
3. **Window:** `validAfter` <= now <= `validBefore`, with margin for
   submission latency. If expired, sign fresh — never reuse.
4. **Nonce:** fresh 32-byte nonce per authorization. Never re-send a signed
   payload.
5. **Value and recipient:** `value` == quoted `amount` exactly (string,
   atomic units); `to` == `payTo`; asset address lowercase hex.
6. **Quote fidelity:** sign the server's returned quote verbatim.

## VERIFY

`/verify` returns `isValid: true` for the corrected payload. Then confirm
`/settle` succeeds — verify is read-only and proves nothing about payment.
Regression-test each checklist item: wrong domain, expired window, reused
nonce, mismatched value, one at a time.

## Using Callx402 for this condition

For a verify rejection, the applicable action is `diagnose`. Give it a
target and the failure evidence — the rejected payload, the /verify
response, and the facilitator's reason string — and it runs deterministic
stage classifiers over what you supplied: it pins the rejection to the
verify stage and surfaces the facilitator's reason verbatim, so you stop
guessing whether the failure is transport, payload, or verification.

What it does not do matters here. It performs no field-level signature
analysis: it cannot tell you whether the EIP-712 domain, the validity
window, the nonce, or the value field is the wrong one. That narrowing is
what the checklist above is for, and `diagnose` is not a substitute for
it. It also refuses to act on its own finding — no re-signing, no fresh
authorization, no retry of the payload. Stage classification over supplied
evidence is covered by the test suite; field-level EIP-3009 diagnosis is
not an implemented capability.

## SOURCES AND VERIFICATION SCOPE

- Protocol claims (EIP-3009 exact-match fields, domain name/version for
  USDC, nonce uniqueness, validity-window semantics) verified against the
  x402 spec, the facilitator docs, and the Cantina audit finding 3.1.1,
  all linked in the front matter, current as of 2026-10-06.
- callx402 claims cite the current implementation: the doctor subsystem
  classifies failures from supplied evidence only
  (`lib/mcp/doctor.js`); no EIP-3009 field-level classifier exists in the
  diagnose path, which is stated as a limitation rather than a capability.
- Problem and fix content verified independently of callx402.
