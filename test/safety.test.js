'use strict';

/**
 * Money-safety invariant tests.
 *
 * - Duplicate idempotencyKey -> second call returns the ORIGINAL stored
 *   result with deduped:true; the pipeline executes exactly once.
 * - Settlement UNKNOWN -> exit 5, fail-closed policy, NO retry and NO
 *   repayment instruction anywhere in the result.
 * - Explicit retry/force after a stored UNKNOWN settlement -> refused, exit 5.
 * - Timeout: a slow subsystem + tiny timeoutMs -> timeout error, non-zero
 *   exit, no hang.
 */

const { test } = require('node:test');
const path = require('node:path');
const { runIntent, runAction } = require('../core/index.js');
const { scratchDir, cliEnv, runCLI, assertEnvelope, withEnv, needsV2Tree } = require('./helpers');
const scratch = scratchDir('safety');
const hermetic = {
  CALLX402_CONFIG: path.join(scratch, 'config.json'),
  CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'idempotency.jsonl'),
};

/** In-memory result-recovery double: { identity -> entry }. */
function memoryRecovery(mem) {
  return {
    createRecoveryStore: () => ({
      get: (identity) => mem[identity] || null,
      put: (entry) => { mem[entry.identity] = entry; return entry; },
    }),
  };
}

const MINIMAL_DEPS = (mem, calls) => ({
  recovery: memoryRecovery(mem),
  intent: {
    parse: (text) => {
      calls.intent += 1;
      return { goals: [{ goal: String(text).slice(0, 40) }], action_class: 'test', risk_level: 'low', constraints: {} };
    },
  },
  capabilities: { createGraph: () => ({ stats: () => ({ tools: 0 }), findTools: () => ({ candidates: [] }) }) },
  planner: { planGoal: () => ({ valid: false, reason: 'no plan' }) },
  spendguard: { createTaskSpendGuard: (o) => ({ status: () => ({ remainingTaskUsd: o.totalTaskBudgetUsd }) }) },
  router: { rankTools: () => ({ ranked: [] }), selectTool: () => null },
  revrule: { createEmitter: () => ({ emitOnce: () => ({ emitted: true, eventId: 'e1' }) }), createMemorySink: () => ({}), createIdempotencyRegistry: () => ({}) },
});

test('duplicate idempotencyKey: second call deduped with ORIGINAL result, pipeline ran once', async (t) => {
  await withEnv(hermetic, async () => {
    const mem = {};
    const calls = { intent: 0 };
    const deps = MINIMAL_DEPS(mem, calls);
    const args = { intent: 'do the thing for under 1 dollar', maxBudget: 1, dryRun: true, idempotencyKey: 'idem-001' };

    const first = await runAction('execute', args, { deps });
    t.assert.strictEqual(first.exitCode, 0);
    t.assert.strictEqual(first.result.ok, true);
    t.assert.strictEqual(first.result.deduped, false);
    t.assert.strictEqual(first.result.idempotencyKey, 'idem-001');
    t.assert.strictEqual(calls.intent, 1, 'pipeline ran once');
    t.assert.ok(mem['callx402_idem_idem-001'], 'result was stored');

    const second = await runAction('execute', args, { deps });
    t.assert.strictEqual(second.exitCode, 0);
    t.assert.strictEqual(second.result.ok, true);
    t.assert.strictEqual(second.result.deduped, true, 'second call is marked deduped');
    t.assert.strictEqual(second.result.idempotencyKey, 'idem-001');
    t.assert.strictEqual(calls.intent, 1, 'pipeline did NOT re-execute');
    // The deduped result is the original: same disposition and stages.
    t.assert.strictEqual(second.result.disposition, first.result.disposition);
    t.assert.deepStrictEqual(second.result.data.stages, first.result.data.stages);
  });
});

test('different idempotencyKeys do not collide', async (t) => {
  await withEnv(hermetic, async () => {
    const mem = {};
    const calls = { intent: 0 };
    const deps = MINIMAL_DEPS(mem, calls);
    await runAction('execute', { intent: 'x', maxBudget: 1, dryRun: true, idempotencyKey: 'k-a' }, { deps });
    const b = await runAction('execute', { intent: 'x', maxBudget: 1, dryRun: true, idempotencyKey: 'k-b' }, { deps });
    t.assert.strictEqual(b.result.deduped, false);
    t.assert.strictEqual(calls.intent, 2);
  });
});

/** Recursively collect [path, value] pairs. */
function walkPairs(o, prefix = '') {
  const out = [];
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) {
      out.push([prefix + k, o[k]]);
      out.push(...walkPairs(o[k], prefix + k + '.'));
    }
  }
  return out;
}

test('settlement UNKNOWN: exit 5, fail-closed, no retry/repay instruction', needsV2Tree, async (t) => {
  const r = await runCLI(
    ['resolve', '--evidence', '{}', '--json'],
    cliEnv(scratch, { PAYLOAD_SETTLEMENT_RESOLVER: '1' })
  );
  t.assert.strictEqual(r.code, 5);
  assertEnvelope(t, r.json, 'resolve');
  t.assert.strictEqual(r.json.ok, false);
  t.assert.strictEqual(r.json.settlement, 'UNKNOWN');
  t.assert.strictEqual(r.json.error.code, 'settlement_unknown');

  // Fail-closed policy is explicit in the resolver output.
  const policy = r.json.data.resolution && r.json.data.resolution.policy;
  t.assert.ok(policy, 'resolution policy present');
  t.assert.strictEqual(policy.retry, 'FAIL_CLOSED');
  t.assert.strictEqual(policy.operatorActionRequired, true);

  // NO retry instruction and NO repayment instruction anywhere: no
  // instruction-shaped keys, and the human text explicitly forbids both.
  const pairs = walkPairs(r.json);
  const instructionKeys = pairs
    .map(([p]) => p.split('.').pop())
    .filter((k) => /^(retryNow|doRetry|retryable|autoRetry|repay|repayment|repayTo)$/i.test(k));
  t.assert.deepStrictEqual(instructionKeys, [], 'no retry/repay instruction keys');
  t.assert.match(r.json.disposition, /no auto-retry, no repay/i);
  t.assert.match(r.json.error.message, /never auto-retry or repay/i);
});

test('unsafe retry refusal: stored UNKNOWN + --force-retry -> refused, exit 5', async (t) => {
  await withEnv(hermetic, async () => {
    const mem = {};
    const calls = { intent: 0 };
    const deps = MINIMAL_DEPS(mem, calls);
    // Seed a prior run that settled UNKNOWN (as resolve --evidence '{}' would record).
    mem['callx402_idem_idem-unknown'] = {
      identity: 'callx402_idem_idem-unknown',
      toolName: 'callx402.execute',
      payer: 'local',
      paymentAuthFingerprint: 'none',
      traceId: 'idem-unknown',
      operationId: 'callx402_idem_idem-unknown',
      result: {
        ok: false, action: 'execute',
        disposition: 'Settlement UNKNOWN: no auto-retry, no repay.',
        subsystem: 'pipeline', subsystemStatus: 'ok', data: {},
        settlement: 'UNKNOWN', txHash: null, receipt: {},
        idempotencyKey: 'idem-unknown', deduped: false,
        error: { code: 'settlement_unknown', message: 'Settlement state is UNKNOWN.' },
      },
      storedAt: new Date().toISOString(),
    };

    const { result, exitCode } = await runAction('execute',
      { intent: 'retry the thing', idempotencyKey: 'idem-unknown', forceRetry: true },
      { deps });
    t.assert.strictEqual(exitCode, 5);
    t.assert.strictEqual(result.ok, false);
    t.assert.strictEqual(result.error.code, 'unsafe_retry_refused');
    t.assert.strictEqual(result.deduped, true);
    t.assert.match(result.error.message, /UNKNOWN/i);
    t.assert.match(result.error.message, /double-spend|manually/i);
    t.assert.strictEqual(calls.intent, 0, 'no new execution was started');
  });
});

test('unsafe retry refusal via real CLI + file-backed store', needsV2Tree, async (t) => {
  const idemFile = path.join(scratch, 'idem-unsafe.jsonl');
  const env = cliEnv(scratch, { CALLX402_IDEMPOTENCY_FILE: idemFile });
  const seeded = {
    identity: 'callx402_idem_cli-unknown',
    toolName: 'callx402.execute',
    payer: 'local',
    paymentAuthFingerprint: 'none',
    traceId: 'cli-unknown',
    operationId: 'callx402_idem_cli-unknown',
    result: {
      ok: false, action: 'execute', disposition: 'Settlement UNKNOWN.',
      subsystem: 'pipeline', subsystemStatus: 'ok', data: {},
      settlement: 'UNKNOWN', txHash: null, receipt: {},
      idempotencyKey: 'cli-unknown', deduped: false,
      error: { code: 'settlement_unknown', message: 'Settlement state is UNKNOWN.' },
    },
    storedAt: new Date().toISOString(),
  };
  require('node:fs').writeFileSync(idemFile, JSON.stringify(seeded) + '\n', 'utf8');

  const r = await runCLI(
    ['execute', '--intent', 'retry the thing', '--idempotency-key', 'cli-unknown', '--force-retry', '--json'],
    env
  );
  t.assert.strictEqual(r.code, 5);
  assertEnvelope(t, r.json, 'execute');
  t.assert.strictEqual(r.json.error.code, 'unsafe_retry_refused');
});

test('timeout: slow subsystem + tiny timeoutMs -> timeout error, exit 1, no hang', async (t) => {
  await withEnv(hermetic, async () => {
    const mem = {};
    const deps = {
      recovery: memoryRecovery(mem),
      // Slow dep: resolves after 30s on an unref'd timer (so it can neither
      // win the race nor keep the test process alive). The timeout must win
      // without hanging.
      intent: {
        parse: () => new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ goals: [] }), 30000);
          timer.unref();
        }),
      },
    };
    const start = Date.now();
    const { result, exitCode } = await runAction('execute',
      { intent: 'slow thing' },
      { deps, timeoutMs: 50 });
    const elapsed = Date.now() - start;
    t.assert.strictEqual(exitCode, 1);
    t.assert.strictEqual(result.ok, false);
    t.assert.strictEqual(result.error.code, 'timeout');
    t.assert.match(result.error.message, /timed out after 50ms/);
    t.assert.ok(elapsed < 5000, `returned promptly (${elapsed}ms), did not hang on the slow dep`);
  });
});

test('timeout via CLI --timeout: monitor --watch is cut off -> exit 1', needsV2Tree, async (t) => {
  // --watch streams forever; --timeout 200ms must win the race and exit 1.
  const r = await runCLI(
    ['monitor', '--watch', '--interval', '50', '--timeout', '200'],
    cliEnv(scratch, { PAYLOAD_SENTINEL: '1' })
  );
  t.assert.strictEqual(r.code, 1);
  t.assert.match(r.stdout, /FAILED \[monitor\]/);
  t.assert.match(r.stdout, /timed out after 200ms/);
});
