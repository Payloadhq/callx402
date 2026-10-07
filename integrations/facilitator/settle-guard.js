#!/usr/bin/env node
'use strict';
/**
 * settle-guard.js — x402 facilitator integration example.
 *
 * The most expensive facilitator bug: re-broadcasting / re-settling a payment
 * whose settlement state is uncertain, and double-paying. This script guards
 * the settle path: given a txHash, it resolves settlement state from evidence
 * via the live callx402 action BEFORE the facilitator touches the payment again.
 *
 *   node settle-guard.js --tx 0xabc... --network base
 *
 * Without credentials the rail answers 402 and the script prints the exact
 * machine-readable payment requirements (it never pays on its own). With
 * VEYLINE_API_KEY or CALLX402_CREDIT_ID set, it executes and prints the
 * resolution verdict: confirmed / unconfirmed / unknown (fail-closed).
 *
 * Zero dependencies (node >= 18, global fetch).
 */

const RAIL = process.env.CALLX402_RAIL || 'https://payload-rail.fly.dev';

function usage() {
  console.log(`Usage: node settle-guard.js --tx <txHash> [--network base]

Env:
  VEYLINE_API_KEY     Veyline subscription key (metered, no per-action pay)
  CALLX402_CREDIT_ID  single-use credit from POST /v1/callx402/checkout
  CALLX402_RAIL       rail base URL (default https://payload-rail.fly.dev)

Exit codes: 0 = verdict printed (any verdict, including unknown),
            2 = usage error, 3 = transport error (fail closed: do NOT settle).`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tx' && argv[i + 1]) out.tx = argv[++i];
    else if (argv[i] === '--network' && argv[i + 1]) out.network = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }
  if (!args.tx) { usage(); process.exit(2); }
  const network = args.network || 'base';

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.VEYLINE_API_KEY;
  const creditId = process.env.CALLX402_CREDIT_ID;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = { evidence: JSON.stringify({ txHash: args.tx, network }) };
  if (creditId) body.credit_id = creditId;

  let res;
  try {
    res = await fetch(`${RAIL}/v1/callx402/actions/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`TRANSPORT ERROR (fail closed — do NOT settle): ${err.message}`);
    process.exit(3);
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 402) {
    const accepts = (data.accepts || [])[0] || {};
    const ext = (data.extensions || {}).payload || {};
    console.log('PAYMENT_REQUIRED — callx402 resolve is paid on-demand.');
    console.log(`  action:  resolve ($${ext.quoted_price_usd} USDC on ${accepts.network})`);
    console.log(`  pay to:  ${accepts.payTo}`);
    console.log(`  quote:   ${ext.quote_id} (expires ${ext.expires_at})`);
    console.log('  redeem:  pay from an authorized wallet, then re-run with');
    console.log('           CALLX402_CREDIT_ID set, or POST {txHash, quote_id}.');
    console.log('Do NOT re-broadcast the settlement until state is resolved.');
    process.exit(0);
  }

  if (res.status >= 200 && res.status < 300) {
    console.log('SETTLEMENT VERDICT (from recorded evidence):');
    console.log(JSON.stringify(data, null, 2));
    console.log('\nRule: act only on confirmed/unconfirmed. "unknown" means the');
    console.log('facilitator must NOT settle, retry, or repay — escalate.');
    process.exit(0);
  }

  console.error(`RAIL ERROR ${res.status} (fail closed — do NOT settle):`);
  console.error(JSON.stringify(data, null, 2).slice(0, 2000));
  process.exit(3);
}

main();
