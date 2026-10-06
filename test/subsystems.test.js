'use strict';

/**
 * Real-subsystem dispatch tests (in-process).
 *
 * The deps seam injects the REAL v2.0.0 modules, so these tests exercise
 * the actual dispatch wiring in core/index.js without needing env flags.
 * (Flag-gated behavior itself is covered by cli-dispatch.test.js.)
 */

const { test } = require('node:test');
const path = require('node:path');
const { runAction } = require('../core/index.js');
const { getSubsystem } = require('../core/subsystems.js');
const { assertEnvelope, scratchDir, withEnv } = require('./helpers');

const scratch = scratchDir('subsys');
const hermetic = {
  CALLX402_CONFIG: path.join(scratch, 'config.json'),
  CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'idempotency.jsonl'),
};

function realModule(name) {
  const h = getSubsystem(name, {});
  if (!h.reachable) throw new Error(`v2.0.0 subsystem '${name}' is not reachable`);
  return h.module;
}

test('rescue dispatch calls the real rescue module surface; no token -> auth_required exit 3', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runAction('rescue', { incident: 'inc-9' }, { deps: { rescue: realModule('rescue') } });
    t.assert.strictEqual(exitCode, 3);
    assertEnvelope(t, result, 'rescue');
    t.assert.strictEqual(result.error.code, 'auth_required');
    t.assert.strictEqual(result.subsystem, 'rescue');
  });
});

test('rescue dispatch with --auth runs real triage (read-only)', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runAction('rescue', { incident: 'inc-9', auth: true }, { deps: { rescue: realModule('rescue') } });
    t.assert.strictEqual(exitCode, 0);
    assertEnvelope(t, result, 'rescue');
    t.assert.strictEqual(result.ok, true);
    t.assert.match(result.disposition, /read-only/);
    t.assert.ok('incident' in result.data, 'triage data present');
  });
});

test('doctor dispatch executes real runMcpDoctor and returns stages', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runAction('diagnose', {}, { deps: { doctor: realModule('doctor') } });
    t.assert.strictEqual(exitCode, 0);
    assertEnvelope(t, result, 'diagnose');
    t.assert.strictEqual(result.ok, true);
    t.assert.strictEqual(result.subsystem, 'doctor');
    t.assert.strictEqual(result.subsystemStatus, 'ok');
    const stages = result.data.report.stages;
    t.assert.ok(Array.isArray(stages) && stages.length === 14);
    t.assert.ok(stages.every((s) => typeof s.stage === 'string' && typeof s.status === 'string'));
    t.assert.strictEqual(typeof result.data.report.whatFailed, 'string');
  });
});

test('router dispatch runs real selectTool/rankTools over candidates', async (t) => {
  // The real smart-router asserts PAYLOAD_MCP_FABRIC=1 on rank/select.
  await withEnv({ ...hermetic, PAYLOAD_MCP_FABRIC: '1' }, async () => {
    const candidates = [
      { tool: 'cheap-slow', price_usd: 0.2, expected_latency_ms: 900 },
      { tool: 'pricey-fast', price_usd: 2.0, expected_latency_ms: 60 },
    ];
    const { result, exitCode } = await runAction('route',
      { goal: 'pick a tool', candidates },
      { deps: { router: realModule('router') } });
    t.assert.strictEqual(exitCode, 0);
    assertEnvelope(t, result, 'route');
    t.assert.strictEqual(result.ok, true);
    t.assert.strictEqual(result.subsystem, 'router');
    t.assert.strictEqual(result.data.policy, 'BEST_VALUE');
    // BEST_VALUE picks the cheapest: cheap-slow.
    t.assert.strictEqual(result.data.selected.selected, 'cheap-slow');
    t.assert.deepStrictEqual(
      result.data.ranked.ranked.map((r) => r.tool),
      ['cheap-slow', 'pricey-fast']
    );
    t.assert.match(result.disposition, /nothing executed/i);
  });
});

test('router dispatch honors the fast speed policy', async (t) => {
  await withEnv({ ...hermetic, PAYLOAD_MCP_FABRIC: '1' }, async () => {
    const candidates = [
      { tool: 'cheap-slow', price_usd: 0.2, expected_latency_ms: 900 },
      { tool: 'pricey-fast', price_usd: 2.0, expected_latency_ms: 60 },
    ];
    const { result, exitCode } = await runAction('route',
      { goal: 'pick a tool', candidates, speed: 'fast' },
      { deps: { router: realModule('router') } });
    t.assert.strictEqual(exitCode, 0);
    t.assert.strictEqual(result.data.policy, 'FASTEST_VERIFIED');
    t.assert.strictEqual(result.data.selected.selected, 'pricey-fast');
  });
});

test('settlement dispatch resolves real states (DEFINITELY_PAID evidence)', async (t) => {
  await withEnv(hermetic, async () => {
    const settlement = realModule('settlement');
    const probe = settlement.resolve({ txHash: '0x' + 'ab'.repeat(32), confirmations: 12, expectedAmount: '1.00', actualAmount: '1.00', asset: 'USDC' });
    // Whatever the real resolver says for this evidence, the dispatch must
    // surface it honestly with the matching exit code.
    const { result, exitCode } = await runAction('resolve',
      { evidence: { txHash: '0x' + 'ab'.repeat(32), confirmations: 12, expectedAmount: '1.00', actualAmount: '1.00', asset: 'USDC' } },
      { deps: { settlement } });
    assertEnvelope(t, result, 'resolve');
    t.assert.strictEqual(result.settlement, probe.state);
    t.assert.strictEqual(exitCode, probe.state === 'UNKNOWN' ? 5 : 0);
  });
});
