'use strict';

/**
 * test/veyline-commands.test.js — ADDITIVE test for the Veyline Recovery
 * track commands: evidence, explain, recover.
 *
 * Does not touch existing commands. Uses core.runAction directly with a
 * temp --dir so no fixture pollutes the repo. Saves/restores env flags.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runAction, ACTIONS } = require('../core/index');

const FLAGS = ['PAYLOAD_VEYLINE_LEDGER', 'PAYLOAD_VEYLINE_RECOVERY'];
let saved = {};

function envOn() {
  saved = {};
  for (const f of FLAGS) { saved[f] = process.env[f]; process.env[f] = '1'; }
}
function envOff() {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'callx402-veyline-'));
}

// Local-mode gate: the veyline tree is the optional advanced self-hosted
// runtime, not a requirement. On a clean machine (no tree) the tree-dependent
// tests skip — the CLI routes to the hosted rail by default instead.
const VEYLINE_ROOT = path.resolve(__dirname, '..', '..', 'veyline', 'engineering', 'recovery');
let treeAvailable = false;
try { require(path.join(VEYLINE_ROOT, 'operation-ledger.js')); treeAvailable = true; } catch { treeAvailable = false; }
const needsTree = { skip: !treeAvailable };

function seedLedger(dir) {
  // Seed through the real veyline modules so recover() can hit the cache.
  const root = path.resolve(__dirname, '..', '..', 'veyline', 'engineering', 'recovery');
  const L = require(path.join(root, 'operation-ledger.js'));
  const R = require(path.join(root, 'recovery-state.js'));
  const ledger = L.createOperationLedger({ dir });
  ledger.record({ operationId: 'op_cli1', kind: 'begin', protocol: 'x402', actor: 'client', summary: 'begins' });
  ledger.record({ operationId: 'op_cli1', kind: 'payment', protocol: 'x402', actor: 'fac', summary: 'settled', states: { payment: 'SETTLED' } });
  ledger.record({ operationId: 'op_cli1', kind: 'execution', protocol: 'MCP', actor: 'prov', summary: 'done', states: { execution: 'SUCCEEDED' } });
  ledger.record({ operationId: 'op_cli1', kind: 'delivery', protocol: 'MCP', actor: 'prov', summary: 'lost', states: { delivery: 'LOST' } });
  const cache = R.createFileBackedCache({ file: path.join(dir, 'recovery-cache.jsonl') });
  const net = R.createRecoveryNetwork({ ledger, cache });
  const stored = net.storeSettledResult({
    toolName: 't', args: {}, payer: 'payer_1', paymentAuthFingerprint: 'fp1',
    operationId: 'op_cli1', result: { ok: true }, settlementTx: '0x1',
  });
  return stored.identity;
}

test('ACTIONS includes the three new commands and no existing command was removed', () => {
  for (const c of ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'status', 'preflight', 'inspect',
    'evidence', 'explain', 'recover']) {
    assert.ok(ACTIONS.includes(c), `ACTIONS missing ${c}`);
  }
});

test('evidence: reports recorded events for a known operation', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    seedLedger(dir);
    const { result, exitCode } = await runAction('evidence', { operationId: 'op_cli1', dir }, {});
    assert.equal(exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.action, 'evidence');
    assert.equal(result.data.operationId, 'op_cli1');
    assert.ok(result.data.eventCount >= 4);
    assert.equal(result.data.states.payment, 'SETTLED');
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('evidence: unknown operation is honest no_basis, still exit 0', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    const { result, exitCode } = await runAction('evidence', { operationId: 'op_nope', dir }, {});
    assert.equal(exitCode, 0);
    assert.equal(result.ok, true);
    assert.match(result.data.basis, /no_basis/);
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('evidence: disabled flag -> exit 3, nothing executed', needsTree, async () => {
  envOff();
  const { result, exitCode } = await runAction('evidence', { operationId: 'x', dir: tmpDir() }, {});
  assert.equal(exitCode, 3);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'subsystem_disabled');
});

test('explain: plain-language assessment of an operation', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    seedLedger(dir);
    const { result, exitCode } = await runAction('explain', { operationId: 'op_cli1', dir }, {});
    assert.equal(exitCode, 0);
    assert.ok(result.disposition.includes('op_cli1'));
    assert.ok(result.data.assessment.length > 0);
    assert.ok(Array.isArray(result.data.trail));
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explain: missing operationId -> usage error', needsTree, async () => {
  envOn();
  try {
    const { result, exitCode } = await runAction('explain', {}, {});
    assert.equal(exitCode, 2);
    assert.equal(result.error.code, 'usage');
  } finally { envOff(); }
});

test('recover: RECOVERABLE decision returned read-only with the prior result', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    const identity = seedLedger(dir);
    const { result, exitCode } = await runAction('recover', {
      operationId: 'op_cli1', dir, identity,
      evidence: JSON.stringify({ payer: 'payer_1', paymentAuthFingerprint: 'fp1' }),
    }, {});
    assert.equal(exitCode, 0);
    assert.equal(result.data.decision.recoveryState, 'RECOVERABLE');
    assert.equal(result.data.terminal, 'KNOWN_SAFE');
    assert.deepEqual(result.data.decision.result, { ok: true });
    assert.match(result.disposition, /Read-only/);
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recover: builds the identity from evidence fields when --identity is absent', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    seedLedger(dir); // seeds toolName 't', args {}, payer payer_1, fp1, no traceId
    const { result, exitCode } = await runAction('recover', {
      operationId: 'op_cli1', dir,
      evidence: JSON.stringify({ toolName: 't', args: {}, payer: 'payer_1', paymentAuthFingerprint: 'fp1' }),
    }, {});
    assert.equal(exitCode, 0);
    assert.equal(result.data.decision.recoveryState, 'RECOVERABLE');
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recover: unknown identity with no evidence -> SETTLEMENT_UNKNOWN, never a repay', needsTree, async () => {
  envOn();
  const dir = tmpDir();
  try {
    const { result, exitCode } = await runAction('recover', {
      operationId: 'op_cli1', dir, identity: 'opid_unknown',
      evidence: JSON.stringify({ payer: 'payer_1', paymentAuthFingerprint: 'fp1' }),
    }, {});
    assert.equal(exitCode, 0);
    assert.equal(result.data.decision.recoveryState, 'SETTLEMENT_UNKNOWN');
    assert.equal(result.data.terminal, 'HUMAN_REVIEW');
    assert.ok(result.data.decision.actionsForbidden.includes('blind_repay'));
  } finally { envOff(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recover: missing identity and insufficient evidence fields -> usage error', needsTree, async () => {
  envOn();
  try {
    const { result, exitCode } = await runAction('recover', { operationId: 'op_cli1', dir: tmpDir() }, {});
    assert.equal(exitCode, 2);
    assert.equal(result.error.code, 'usage');
  } finally { envOff(); }
});

test('recover: disabled flag -> exit 3', needsTree, async () => {
  envOff();
  const { result, exitCode } = await runAction('recover', { operationId: 'x', identity: 'y' }, {});
  assert.equal(exitCode, 3);
  assert.equal(result.error.code, 'subsystem_disabled');
});

test('existing commands still dispatch: unknown command lists the new commands too', async () => {
  const { result, exitCode } = await runAction('frobnicate', {}, {});
  assert.equal(exitCode, 2);
  assert.ok(result.data.commands.includes('evidence'));
  assert.ok(result.data.commands.includes('recover'));
});
