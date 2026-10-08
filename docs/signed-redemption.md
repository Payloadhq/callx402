# Secure, on-demand callx402 redemption

A publicly visible on-chain transaction hash is **never** sufficient to redeem
a paid callx402 action. The payer must produce an EIP-191 `personal_sign`
signature, outside Payload, over the exact action, transaction hash, quote,
action inputs, wallet, Base network, Payload recipient, nonce and expiration.

**Never provide your seed phrase or private key to Payload or the CLI.**
The CLI does not ask for or store wallet secrets.

## Human use

```bash
callx402 diagnose --evidence '{"error":"settlement timeout"}'
```

The CLI displays a free **USDC** quote before asking permission to spend.
For USDC it presents the payment details, then asks for the paying wallet
address and a signature created by your wallet over the canonical message.
For Stripe card checkout it explicitly confirms the separate card price.

Only actions supported by the hosted service are presented as paid services.
Some advanced commands require an optional local runtime and must not be
misrepresented as completed hosted executions.

## Non-interactive agent use

An agent must obtain a free quote **before** payment:

```text
GET https://payload-rail.fly.dev/v1/callx402/quote?action=resolve&path=x402
```

Preserve both `quote_id` and `quote_inputs` from this exact quote response.
Quote IDs include issuance time; requesting a fresh quote after signing will
produce a different ID. Use the original quote before it expires.

Use `actionRequestHash(action, body)` from `core/payer-auth.js` for the exact
input the agent will redeem. For example, if the CLI will send
`{evidence: "{\\"error\\":\\"settlement timeout\\"}"}`, pass that exact evidence
**string** to the hash function; do not hash a parsed object instead.

The owner’s wallet must sign the canonical
`buildAuthMessage({wallet, action, txHash, quote_id, request_hash, network, recipient, nonce, expiry})`
via EIP-191 `personal_sign` with expiry no further than 15 minutes ahead.
The resulting JSON file should include:

```json
{
  "wallet": "0x...",
  "action": "resolve",
  "txHash": "0x...",
  "quote_id": "the original quote ID",
  "quote_inputs": {"action":"resolve","path":"x402","...":"other exact canonical inputs"},
  "quoted_price_usd": "0.25",
  "request_hash": "0x...",
  "network": "eip155:8453",
  "recipient": "0x...",
  "nonce": "an unpredictable unique value",
  "expiry": 1790000000,
  "signature": "0x...65-byte EIP-191 signature"
}
```

The example is illustrative, not a usable authorization; use the exact returned
canonical `quote_inputs`. Run:

```bash
callx402 resolve --evidence @evidence.json --tx-hash 0xYOUR_TX_HASH \
  --payer-auth @signed-auth.json --approve
```

The CLI verifies that the signed action, transaction, quote and request
digest match what it is about to submit. The Rail independently re-derives
the quote, recovers the signer, matches the chain payer, checks recipient
and network, and atomically enforces one-time use. A rejected request
does not authorize execution.

**Contract wallets:** EIP-1271 is **not yet exposed on this redemption
path**. The current secured release supports EOA EIP-191 signatures only.
Do not claim contract-wallet redemption support until integration tests pass.

**No live-money tests:** Developers must use mocked verifier / Stripe
clients or pre-existing read-only evidence for automated tests.
