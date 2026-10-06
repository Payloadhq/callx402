'use strict';

/**
 * Intent pipeline tests (in-process, via the deps seam).
 *
 * - Stage order: recording doubles prove the pipeline walks
 *   intent -> capabilities -> planner -> spendguard -> router -> revrule.
 * - Budget: over-budget -> budget_refused, exit 4, zero side effects
 *   (the router double is never reached).
 * - Approval threshold: over threshold without --approve fails closed.
 * - Constraints: networks/assets/providers reach planner, router and
 *   SpendGuard exactly as supplied.
 * - Real end-to-end dry-run with no doubles: honest "no executable route".
 */

const { test } = require('node:test');
const path = require('node:path');
const { runIntent, runAction } = require('../core/index.js');
const { scratchDir, withEnv } = require('./helpers');

const scratch = scratchDir('pipeline');
const hermetic = {
  CALLX402_CONFIG: path.join(scratch, 'config.json'),
  CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'idempotency.jsonl'),
};

/** Deps doubles that record invocation order; none touch the network. */
function recordingDoubles(order, recorded, planCost = 0.4) {
  return {
    recovery: { createRecoveryStore: () => ({ get: () => null, put: () => {} }) },
    intent: {
      parse: (text) => {
        order.push('intent');
        return { goals: [{ goal: String(text).slice(0, 40) }], action_class: 'test', risk_level: 'low', constraints: {} };
      },
    },
    capabilities: {
      createGraph: () => {
        order.push('capabilities');
        return {
          stats: () => ({ tools: 1 }),
          findTools: () => ({ candidates: [{ tool: 't1', price_usd: 0.4 }] }),
        };
      },
    },
    planner: {
      planGoal: (o) => {
        order.push('planner');
        recorded.plannerOpts = o;
        return { valid: true, total_cost_usd: planCost, plans_considered: 1 };
      },
    },
    spendguard: {
      createTaskSpendGuard: (o) => {
        order.push('spendguard');
        recorded.sgOpts = o;
        return { status: () => ({ remainingTaskUsd: o.totalTaskBudgetUsd }) };
      },
    },
    router: {
      normalizeCandidate: (c) => { order.push('router.normalize'); return c; },
      rankTools: (cands, o) => { order.push('router.rank'); recorded.routerOpts = o; return { ranked: cands }; },
      selectTool: (r) => { order.push('router.select'); return { tool: 't1' }; },
    },
    revrule: {
      createEmitter: () => {
        order.push('revrule');
        return { emitOnce: () => ({ emitted: true, eventId: 'e1' }) };
      },
      createMemorySink: () => ({}),
      createIdempotencyRegistry: () => ({}),
    },
  };
}

test('intent pipeline walks stages in order (recording doubles)', async (t) => {
  await withEnv(hermetic, async () => {
    const order = [];
    const recorded = {};
    const deps = recordingDoubles(order, recorded);
    const { result, exitCode } = await runIntent('summarize this for under 1 dollar', { maxBudget: 1, dryRun: true }, { deps });
    t.assert.strictEqual(exitCode, 0);
    t.assert.strictEqual(result.ok, true);
    t.assert.deepStrictEqual(order, [
      'intent', 'capabilities', 'planner', 'spendguard',
      'router.normalize', 'router.rank', 'router.select', 'revrule',
    ]);
    const stageNames = result.data.stages.map((s) => s.name);
    t.assert.deepStrictEqual(stageNames, [
      'idempotency', 'intent', 'capabilities', 'planner', 'spendguard',
      'budget', 'router', 'execution', 'effect_proof', 'settlement',
      'delivery', 'revrule',
    ]);
    t.assert.strictEqual(result.data.plannedCost, 0.4);
  });
});

test('over-budget intent -> budget_refused, exit 4, zero side effects', async (t) => {
  await withEnv(hermetic, async () => {
    const order = [];
    const recorded = {};
    const deps = recordingDoubles(order, recorded, 50); // planned $50 vs $1 budget
    const { result, exitCode } = await runAction('execute',
      { intent: 'do the expensive thing', maxBudget: 1 },
      { deps });
    t.assert.strictEqual(exitCode, 4);
    t.assert.strictEqual(result.ok, false);
    t.assert.strictEqual(result.error.code, 'budget_refused');
    t.assert.strictEqual(result.subsystem, 'spendguard');
    t.assert.match(result.error.message, /exceeds budget/);
    // Zero side effects: the pipeline refused BEFORE the router stage, so no
    // routing (and no execution) double was ever invoked.
    t.assert.ok(!order.some((s) => s.startsWith('router')), `router must not run; order was ${order}`);
    t.assert.ok(!order.includes('revrule'), 'revrule must not run after refusal');
    const budgetStage = result.data.stages.find((s) => s.name === 'budget');
    t.assert.strictEqual(budgetStage.status, 'refused');
    t.assert.strictEqual(result.data.plannedCost, 50);
    t.assert.strictEqual(result.data.maxBudget, 1);
  });
});

test('cost above approval threshold without --approve fails closed, exit 4', async (t) => {
  await withEnv(hermetic, async () => {
    const order = [];
    const deps = recordingDoubles(order, {}, 6); // $6 > default $5 threshold, < $10 budget
    const { result, exitCode } = await runAction('execute',
      { intent: 'do the thing', maxBudget: 10 },
      { deps });
    t.assert.strictEqual(exitCode, 4);
    t.assert.strictEqual(result.error.code, 'approval_required');
    t.assert.match(result.error.message, /approval threshold/);
    t.assert.ok(!order.some((s) => s.startsWith('router')), 'no routing without approval');
  });
});

test('explicit --approve passes the threshold gate', async (t) => {
  await withEnv(hermetic, async () => {
    const order = [];
    const deps = recordingDoubles(order, {}, 6);
    const { result, exitCode } = await runAction('execute',
      { intent: 'do the thing', maxBudget: 10, approve: true, dryRun: true },
      { deps });
    t.assert.strictEqual(exitCode, 0);
    t.assert.strictEqual(result.ok, true);
    t.assert.ok(order.includes('router.select'), 'router ran after approval');
  });
});

test('networks/assets/providers constrain planner, router and spendguard', async (t) => {
  await withEnv(hermetic, async () => {
    const order = [];
    const recorded = {};
    const deps = recordingDoubles(order, recorded);
    const { result, exitCode } = await runIntent(
      'move funds cheaply',
      { maxBudget: 10, dryRun: true, networks: ['base'], assets: ['USDC'], providers: ['acme'] },
      { deps }
    );
    t.assert.strictEqual(exitCode, 0);
    t.assert.deepStrictEqual(recorded.plannerOpts.networks, ['base']);
    t.assert.deepStrictEqual(recorded.plannerOpts.assets, ['USDC']);
    t.assert.deepStrictEqual(recorded.plannerOpts.providers, ['acme']);
    t.assert.deepStrictEqual(recorded.routerOpts.networks, ['base']);
    t.assert.deepStrictEqual(recorded.routerOpts.assets, ['USDC']);
    t.assert.deepStrictEqual(recorded.sgOpts.approvedNetworks, ['base']);
    t.assert.deepStrictEqual(recorded.sgOpts.approvedAssets, ['USDC']);
    t.assert.deepStrictEqual(recorded.sgOpts.approvedProviders, ['acme']);
    t.assert.strictEqual(result.ok, true);
  });
});

test('real end-to-end run (no doubles, all flags off): honest no-route', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runIntent('summarize this for under 1 dollar', { maxBudget: 1 });
    t.assert.strictEqual(exitCode, 0);
    t.assert.strictEqual(result.ok, true);
    t.assert.strictEqual(result.action, 'execute');
    t.assert.match(result.disposition, /No executable route available/);
    t.assert.match(result.disposition, /no money moved/);
    t.assert.strictEqual(result.settlement, null);
    t.assert.strictEqual(result.data.executed, false);
    const byName = Object.fromEntries(result.data.stages.map((s) => [s.name, s.status]));
    t.assert.strictEqual(byName.intent, 'disabled');
    t.assert.strictEqual(byName.execution, 'no_route');
    t.assert.strictEqual(byName.settlement, 'skipped');
  });
});

test('real dry-run reports planning only', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runIntent('summarize this for under 1 dollar', { maxBudget: 1, dryRun: true });
    t.assert.strictEqual(exitCode, 0);
    t.assert.match(result.disposition, /Dry run: plan validated/);
    const byName = Object.fromEntries(result.data.stages.map((s) => [s.name, s.status]));
    t.assert.strictEqual(byName.execution, 'dry_run');
  });
});

test('empty intent text -> usage error, exit 2', async (t) => {
  await withEnv(hermetic, async () => {
    const { result, exitCode } = await runIntent('   ', {});
    t.assert.strictEqual(exitCode, 2);
    t.assert.strictEqual(result.error.code, 'usage');
  });
});
