'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthMessage, readSignedAuthorization } = require('../core/payer-auth.js');
const { invokeRail, isRailCommand } = require('../core/rail.js');

const txHash = '0x' + '22'.repeat(32);
const wallet = '0x' + '11'.repeat(20);
const recipient = '0x' + '33'.repeat(20);
const signature = '0x' + '44'.repeat(65);
const authorization = () => ({
  wallet, action: 'resolve', txHash, quote_id: 'q_test',
  network: 'eip155:8453', recipient, nonce: 'nonce_unique_1234',
  expiry: Math.floor(Date.now() / 1000) + 300, signature,
});

test('client and Rail use canonical EIP-191 signer message', () => {
  const expected = [
    'Payload x402 Authorization',
    'wallet:' + wallet,
    'action:resolve',
    'txHash:' + txHash,
    'quote_id:q_test',
    'network:eip155:8453',
    'recipient:' + recipient,
    'nonce:nonce_unique_1234',
    'expiry:' + authorization().expiry,
  ].join('\n');
  assert.equal(buildAuthMessage(authorization()), expected);
});

test('unsigned, malformed and expired authorizations are rejected before network payment', () => {
  assert.throws(() => readSignedAuthorization('{}'), /wallet/);
  const bad = { ...authorization(), expiry: Math.floor(Date.now()/1000) - 1 };
  assert.throws(() => readSignedAuthorization(JSON.stringify(bad)), /expired/);
});

test('hosted CLI does not route local-only actions to paid Rail', () => {
  assert.equal(isRailCommand('execute'), false);
  assert.equal(isRailCommand('rescue'), false);
  assert.equal(isRailCommand('resolve'), true);
});

test('signed noninteractive redemption sends signature, never wallet secrets', async () => {
  const previous = global.fetch;
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    const quote = String(url).includes('/quote?');
    const body = quote ? { quoted_price_usd: '0.25', quote_id: 'q_test', quote_inputs: { action: 'resolve', path: 'x402' } } :
      { ok: true, invocation_id: 'invo_mock', via: 'x402', execution: { executed: true, result: { state: 'UNKNOWN' } } };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const result = await invokeRail('resolve', {
      evidence: '{}', txHash, payerAuth: JSON.stringify(authorization()),
    }, { yes: true, json: true });
    assert.equal(result.ok, true);
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[1].init.body);
    assert.equal(body.txHash, txHash);
    assert.equal(body.payer_auth.wallet, wallet);
    assert.equal(body.payer_auth.signature, signature);
    assert.equal(body.payer_auth.quote_id, 'q_test');
    assert.equal('privateKey' in body, false);
  } finally {
    global.fetch = previous;
  }
});

test('stale signature for a different quote fails without submitting a payment proof', async () => {
  const previous = global.fetch;
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ quoted_price_usd: '0.25', quote_id: 'q_changed', quote_inputs: { action: 'resolve', path: 'x402' } }) };
  };
  try {
    const result = await invokeRail('resolve', {
      txHash, payerAuth: JSON.stringify(authorization()),
    }, { yes: true, json: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /current quote/);
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = previous;
  }
});
