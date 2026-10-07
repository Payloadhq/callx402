---
id: CX402-SOLANAFAIL-001
title: "x402 settlement on Solana: blockhash expiry, phantom pending, and Token-2022"
category: solana-settlement
severity: high
economic_risk: "Authorizations expire mid-operation on Solana's ~90s blockhash window; terminal on-chain failures misreported as pending cause infinite reconciliation loops; Token-2022 mints break classic-SPL settlement code."
search_phrases: ["x402 solana settlement failed", "x402 solana blockhash expired", "x402 settlement_pending solana", "x402 token-2022 settlement"]
reading_minutes: 4
sources: ["https://github.com/x402-foundation/x402/issues/646", "https://github.com/x402-foundation/x402/issues/3644", "https://github.com/nirholas/three.ws/commit/624e1a6"]
related: ["CX402-SETTLEPEND-001", "CX402-SAFFRETRY-001"]
updated: 2026-10-06
---

# x402 settlement on Solana: blockhash expiry, phantom pending, and Token-2022

## THE PROBLEM

x402 settlement on Solana fails in ways EVM experience does not prepare you
for. Three distinct ones: payments die after a minute or two no matter what
timeout you configure; a transaction the chain already killed comes back
labeled `settlement_pending`; and settlement code that works fine for USDC
builds transactions that cannot execute against Token-2022 mints.

## WHY IT HAPPENS

**1. Blockhash expiry is a hard wall.** Solana transactions reference a recent
blockhash valid for roughly 80–90 seconds. As
[x402-foundation/x402#646](https://github.com/x402-foundation/x402/issues/646)
documents, `maxTimeoutSeconds` cannot be enforced on Solana past that window —
production settlements fail after 1–2 minutes regardless of configured
timeout. Long-running operations (AI inference, data processing) cannot use
the standard flow: the authorization's blockhash dies before settlement is
attempted.

**2. Terminal failures wear a pending mask.** In Go SDK v2.27.0, the exact-SVM
settlement path reported a confirmed on-chain execution failure as
`settlement_pending`. The issue is blunt: "This transaction is not pending:
the chain confirmed that instruction 2 failed" — an SPL `OwnerMismatch` on
devnet, terminal, reported as pending, causing "callers to retry
reconciliation for a terminal transaction"
([x402-foundation/x402#3644](https://github.com/x402-foundation/x402/issues/3644)).
On Solana, `settlement_pending` from an affected SDK version means less than
it says.

**3. Token-2022 is not classic SPL.** Settlement code that assumes the classic
token program builds a transaction that cannot execute against a Token-2022
mint: the derived source ATA does not exist and the instruction targets a
program that does not own the mint. A real production fix for exactly this
([three.ws@624e1a6](https://github.com/nirholas/three.ws/commit/624e1a6)).
USDC is classic SPL; assuming every mint behaves like USDC is the bug.

## DO NOT DO THIS

Do not treat Solana `settlement_pending` as "wait longer" without checking
the chain — on affected SDK versions it may be a terminal failure in disguise,
and waiting just burns your reconciliation budget.

Do not retry a failed Solana settle with the same transaction. The blockhash
is expired; the retry is dead on arrival. Build fresh.

Do not assume mint behavior from the token symbol. Check which token program
owns the mint before constructing the transfer.

## THE SAFE FIX

1. **Fit inside the blockhash window.** Pre-simulate the settlement
   transaction, then submit promptly. For operations longer than ~60 seconds,
   restructure the flow: settle first, or split authorization from the long
   operation so the blockhash is fresh at submit time.
2. **On `settlement_pending`, look the signature up immediately** on an
   explorer or RPC. If the chain shows a failed instruction, the transaction
   is terminal — stop reconciling and treat it as failed, not pending.
3. **Check the token program before building the transfer.** Query the mint's
   owner program: classic SPL Token vs Token-2022. Derive associated token
   accounts against the correct program id.
4. **Pin and audit your SDK version.** If you run the Go SDK's exact-SVM
   path, confirm you are past the v2.27.0 misreporting fix before trusting
   `settlement_pending` at all.

## VERIFY

Settlements confirm on-chain inside the blockhash window; a terminally failed
transaction is classified terminal (never "pending"); Token-2022 mints
settle end to end on devnet before mainnet. Re-run the #3644 repro (SPL
`OwnerMismatch`) and confirm your stack reports failure, not pending.

## Using Callx402 for this condition

The condition above is exactly what `resolve` is for on Solana: it takes
the broadcast signature and the chain state you looked up yourself and
judges which of them to believe. Supply the facilitator's response and
your own RPC or explorer result as separate evidence items; the resolver
applies a fixed precedence where on-chain state is ground truth for
whether money moved. A facilitator that reports pending while the chain
shows a failed instruction resolves as a terminal failure or a conflict —
never as an instruction to keep waiting. This is unexercised against live
Solana RPC in this build; the resolver works from the chain state you
hand it, not from a call it makes itself.

It does not build Solana transactions, refresh expired blockhashes, or
correct a Token-2022 program mismatch; those stay manual. It will not
retry or repay on your behalf — on evidence it cannot decide it returns
UNKNOWN and stays fail-closed, a behavior the test suite covers. For the
#3644 pattern, the practical use is feeding the facilitator's
`settlement_pending` alongside the explorer's failed-instruction record
and letting the classifier weigh the two instead of trusting the label.

## SOURCES AND VERIFICATION SCOPE

- The blockhash window limit, the terminal-failure-reported-as-pending bug
  (Go SDK v2.27.0, SPL `OwnerMismatch` on devnet), and the Token-2022 mint
  fix are cited from the x402-foundation issues and the three.ws commit
  linked in the front matter, current as of 2026-10-06.
- callx402 claims cite the current implementation: the resolver's
  on-chain-as-ground-truth precedence from
  `lib/settlement-resolver.js`, and its fail-closed UNKNOWN behavior from
  the test suite; live Solana RPC reconciliation is noted as unexercised
  because the resolver is mocks/local-only in this build.
- Problem and fix content verified independently of callx402.
