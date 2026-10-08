'use strict';

/**
 * The client never signs messages or accepts wallet private keys.
 * An external wallet signs the EIP-191 message and supplies a 65-byte signature.
 * This canonical message MUST remain in lockstep with Rail payer-auth.ts.
 */
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

function actionRequestHash(action, body) {
  const data = {
    action,
    evidence: body.evidence ?? null,
    invocation_id: body.invocation_id ?? null,
    context: body.context ?? null,
    operation_id: body.operation_id ?? null,
    target: body.target ?? null,
    identity: body.identity ?? null,
  };
  return '0x' + createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex');
}

function buildAuthMessage(auth) {
  return [
    'Payload x402 Authorization',
    `wallet:${String(auth.wallet).toLowerCase()}`,
    `action:${auth.action}`,
    `txHash:${String(auth.txHash).toLowerCase()}`,
    `quote_id:${auth.quote_id}`,
    `request_hash:${auth.request_hash}`,
    `network:${auth.network}`,
    `recipient:${String(auth.recipient).toLowerCase()}`,
    `nonce:${auth.nonce}`,
    `expiry:${auth.expiry}`,
  ].join('\n');
}

function readSignedAuthorization(value) {
  if (!value || typeof value !== 'string') throw new Error('payer authorization JSON or @file required');
  const raw = value.startsWith('@') ?
    fs.readFileSync(path.resolve(value.slice(1)), 'utf8') : value;
  const obj = JSON.parse(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('expected an object');
  if (!/^0x[0-9a-fA-F]{40}$/.test(obj.wallet || '')) throw new Error('invalid wallet');
  if (!/^0x[0-9a-fA-F]{64}$/.test(obj.txHash || '')) throw new Error('invalid txHash');
  if (!/^0x[0-9a-fA-F]{40}$/.test(obj.recipient || '')) throw new Error('invalid recipient');
  if (!/^0x[0-9a-fA-F]{64}$/.test(obj.request_hash || '')) throw new Error('invalid action request hash');
  if (!/^0x[0-9a-fA-F]{130}$/.test(obj.signature || '')) throw new Error('invalid EIP-191 signature');
  if (typeof obj.action !== 'string' || typeof obj.network !== 'string' ||
      typeof obj.quote_id !== 'string' || typeof obj.nonce !== 'string' ||
      !Number.isSafeInteger(obj.expiry) || obj.expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error('malformed or expired authorization fields');
  }
  return obj;
}

module.exports = { buildAuthMessage, actionRequestHash, readSignedAuthorization };
