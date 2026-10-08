'use strict';

/**
 * core/rail.js — lightweight client for the hosted Payload Rail.
 *
 * When the v2.0.0 runtime tree is not available locally (or unless
 * CALLX402_LOCAL=1), subsystem commands route here automatically:
 *
 *   invoke -> free quote -> user approves -> payment/authorization -> result
 *
 * Payment paths (no wallet required in the CLI):
 *   - x402: user pays USDC on Base from their own wallet, pastes the tx hash.
 *   - card: CLI opens the Stripe checkout in a browser; user pastes the
 *     single-use credit ID from the success page.
 *
 * The rail verifies payment exactly once, executes read-only diagnostic
 * actions server-side, meters the invocation, and returns the result.
 * Nothing here signs, holds keys, or moves money.
 */

const RAIL_BASE = process.env.CALLX402_RAIL || 'https://payload-rail.fly.dev';
const RAIL_ACTIONS = [
  'diagnose', 'doctor', 'rescue', 'route', 'resolve', 'execute', 'monitor',
  'preflight', 'inspect', 'evidence', 'explain', 'recover',
  'settlement_interpretation', 'safe_retry', 'failure_classification',
  'duplicate_payment_risk',
];

// Map CLI command names to rail action names.
const ACTION_ALIASES = { doctor: 'diagnose' };

function railActionFor(command) {
  return ACTION_ALIASES[command] || command;
}

function isRailCommand(command) {
  return RAIL_ACTIONS.includes(command);
}

/** True when the caller explicitly prefers the local v2 tree. */
function preferLocal() {
  return process.env.CALLX402_LOCAL === '1';
}

async function railFetch(path, opts = {}) {
  const res = await fetch(`${RAIL_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
  return { status: res.status, body };
}

async function getQuote(action) {
  const { status, body } = await railFetch(
    `/v1/callx402/quote?action=${encodeURIComponent(action)}&path=x402`,
  );
  if (status !== 200 || !body || !body.quoted_price_usd) {
    throw new Error(`quote unavailable (HTTP ${status})`);
  }
  return body;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = require('node:readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url) {
  const { execSync } = require('node:child_process');
  const platform = process.platform;
  try {
    if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildEvidence(action, args) {
  // Prefer explicit --evidence JSON (or @file); otherwise assemble from args.
  if (args.evidence) {
    const raw = String(args.evidence);
    if (raw.startsWith('@')) {
      const fs = require('node:fs');
      const path = require('node:path');
      return fs.readFileSync(path.resolve(raw.slice(1)), 'utf8');
    }
    return raw;
  }
  const ev = {};
  if (args.target) ev.target = args.target;
  if (args.incident) ev.incident = args.incident;
  if (args.goal) ev.goal = args.goal;
  if (args.intent) ev.intent = args.intent;
  if (args.query) ev.query = args.query;
  if (args.operationId) ev.operationId = args.operationId;
  if (args.identity) ev.identity = args.identity;
  return ev;
}

/**
 * Invoke a paid action via the hosted rail.
 * Returns { ok, result } for display by the caller.
 */
async function invokeRail(command, args, opts = {}) {
  const action = railActionFor(command);
  const evidence = buildEvidence(action, args);
  const interactive = process.stdin.isTTY && !opts.yes;

  // 1. Free quote first.
  let quote;
  try {
    quote = await getQuote(action);
  } catch (err) {
    return { ok: false, error: `Could not reach the hosted rail for a free quote: ${err.message}` };
  }
  const price = quote.quoted_price_usd;
  const quoteId = quote.quote_id;

  if (!opts.json) {
    console.log(`callx402 (hosted) — action '${action}'`);
    console.log(`  Free quote: $${price} (quote ${String(quoteId).slice(0, 8)}…)`);
  }

  // 2. User approves the spend.
  if (!opts.yes) {
    if (!interactive) {
      return {
        ok: false,
        error: `Payment of $${price} required. Re-run with --yes to approve non-interactively, or run interactively.`,
        quote: { action, price_usd: price, quote_id: quoteId },
      };
    }
    const approve = await prompt(`  Approve $${price} for '${action}'? [y/N] `);
    if (!/^y(es)?$/i.test(approve)) {
      return { ok: false, error: 'Cancelled by user before payment.' };
    }
  }

  // 3. Payment: x402 (paste tx hash) or card (browser checkout -> credit ID).
  let payBody = { evidence, quote_id: quoteId, quote };
  if (!interactive) {
    return {
      ok: false,
      error: 'Interactive payment required.',
      quote: { action, price_usd: price, quote_id: quoteId },
      payment_instructions: `POST ${RAIL_BASE}/v1/callx402/actions/${action} with { evidence, quote_id, quote } to receive a 402, pay, then re-POST with { txHash } or { credit_id }.`,
    };
  }
  const method = await prompt('  Pay with [1] USDC on Base (paste tx hash after paying) or [2] card via browser? [1/2] ');
  if (method === '2') {
    // Stripe checkout path.
    const { status, body } = await railFetch('/v1/callx402/checkout', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (status !== 200 && status !== 201) {
      return { ok: false, error: `Checkout creation failed (HTTP ${status}).` };
    }
    const url = body.checkout_url || body.url;
    if (!url) return { ok: false, error: 'Checkout URL not returned by rail.' };
    console.log(`  Opening checkout in your browser…`);
    if (!openBrowser(url)) console.log(`  Open this URL manually: ${url}`);
    console.log('  Complete the payment, then paste the single-use credit ID from the success page.');
    const creditId = await prompt('  Credit ID: ');
    if (!creditId) return { ok: false, error: 'No credit ID provided.' };
    payBody = { ...payBody, credit_id: creditId };
  } else {
    // x402 path: get exact payment terms from the 402, then user pays.
    const { status, body } = await railFetch(`/v1/callx402/actions/${action}`, {
      method: 'POST',
      body: JSON.stringify({ evidence, quote_id: quoteId, quote }),
    });
    if (status !== 402) {
      return { ok: false, error: `Expected a 402 payment challenge, got HTTP ${status}.` };
    }
    const accept = (body.accepts && body.accepts[0]) || {};
    const amountUsdc = accept.amount ? (Number(accept.amount) / 1e6).toFixed(2) : price;
    console.log(`  Send ${amountUsdc} USDC on Base (eip155:8453) to:`);
    console.log(`    ${accept.payTo || '(see 402 response)'}`);
    console.log('  Then paste the transaction hash:');
    const txHash = await prompt('  Tx hash: ');
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { ok: false, error: 'Invalid transaction hash format.' };
    }
    payBody = { ...payBody, txHash: txHash.toLowerCase() };
  }

  // 4. Submit payment proof -> verified, executed, metered -> result.
  const { status, body } = await railFetch(`/v1/callx402/actions/${action}`, {
    method: 'POST',
    body: JSON.stringify(payBody),
  });
  if (status === 402) {
    return { ok: false, error: 'Payment not yet recognized. The quote may have expired — re-run to get a fresh quote.' };
  }
  if (status === 409) {
    return { ok: false, error: `Already used: ${body?.error?.message || 'this payment was already consumed'}.` };
  }
  if (status !== 200 || !body || !body.ok) {
    return { ok: false, error: `Rail error (HTTP ${status}): ${body?.error?.message || 'unknown'}` };
  }
  return {
    ok: true,
    action,
    invocation_id: body.invocation_id,
    via: body.via,
    execution: body.execution || null,
    notice: body.notice,
  };
}

module.exports = {
  RAIL_BASE,
  isRailCommand,
  preferLocal,
  railActionFor,
  invokeRail,
  getQuote,
};
