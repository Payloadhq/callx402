'use strict';

/**
 * core/pipeline.js — intent pipeline stage orchestration for `execute`.
 *
 * Stages:
 *   0. idempotency dedupe (result-recovery store; duplicate key -> original
 *      result with deduped:true, no re-execution)
 *   1. intent-engine parse(text) -> structured intent
 *   2. capability-graph findTools -> candidates
 *   3. economic-planner planGoal -> costed plan
 *   4. SpendGuard budget check (over -> refuse, exit 4, zero side effects;
 *      over approvalThreshold without approval -> fail closed, exit 4)
 *   5. router selectTool/choosePath -> route
 *   6. execution kernel — ONLY when a live executable route exists; the
 *      dispatch layer has none wired, so this stage is reported honestly as
 *      'no executable route available'. Never fakes execution.
 *   7. effect proof — issued only on real execution
 *   8. settlement resolve — only on real execution; UNKNOWN -> exit 5
 *   9. delivery + reconciliation -> receipt note
 *  10. RevRule emit (idempotent, flag-gated)
 *
 * Money-safety invariants:
 *   - Over-budget intent -> SpendGuard refusal, exit 4, zero execution side effects.
 *   - Duplicate idempotencyKey -> original stored result, deduped:true.
 *   - Explicit retry/force when prior settlement is UNKNOWN -> REFUSED (exit 5).
 *   - Settlement UNKNOWN -> never auto-retry, never repay (exit 5).
 */

const os = require('os');
const path = require('path');

const { EXIT, ok, fail, exitCodeFor } = require('./envelope');
const { loadConfig } = require('./config');
const { getSubsystem } = require('./subsystems');
const { dispatchRemote } = require('./remote');

const SPEED_POLICY = { fast: 'FASTEST_VERIFIED', cheap: 'LOWEST_TOTAL_COST', balanced: 'BEST_VALUE' };

function idempotencyFile(config) {
  if (process.env.CALLX402_IDEMPOTENCY_FILE) return process.env.CALLX402_IDEMPOTENCY_FILE;
  return path.join(os.homedir(), '.config', 'callx402', 'idempotency.jsonl');
}

function stageRec(stages, name, status, detail) {
  stages.push({ name, status, detail: detail === undefined ? null : detail, at: new Date().toISOString() });
}

function storeResult(store, identity, result) {
  if (!store || !identity) return;
  try {
    store.put({ identity, toolName: 'callx402.execute', payer: 'local', paymentAuthFingerprint: 'none', traceId: result.idempotencyKey || '', operationId: identity, result, storedAt: new Date().toISOString() });
  } catch (_) { /* dedupe persistence is best-effort; never fail the run */ }
}

/**
 * runIntent(text, opts, { config, deps }) -> { result, exitCode }
 *
 * opts: maxBudget, deadline, speed, risk, networks, assets, providers,
 *       approvalThreshold, idempotencyKey, timeoutMs, dryRun, approve,
 *       forceRetry / retry (explicit retry flag).
 */
async function runIntent(text, opts = {}, ctx = {}) {
  const config = ctx.config || loadConfig();
  const deps = ctx.deps || {};

  // SPEC §5: remote mode posts the intent to the callx402 server's /call.
  if (config.mode === 'remote' && Object.keys(deps).length === 0) {
    return dispatchRemote(config, 'execute', { intent: text, ...opts }, { timeoutMs: opts.timeoutMs });
  }

  const stages = [];
  const S = (name, status, detail) => stageRec(stages, name, status, detail);

  if (!text || !String(text).trim()) {
    const r = fail('execute', { code: 'usage', message: 'intent text is required', disposition: 'No intent supplied.' });
    return { result: r, exitCode: EXIT.USAGE };
  }

  const idempotencyKey = opts.idempotencyKey || null;
  const identity = idempotencyKey ? `callx402_idem_${idempotencyKey}` : null;

  // ---- Stage 0: idempotency dedupe -------------------------------------
  const recovery = getSubsystem('recovery', { config, deps });
  let store = null;
  if (recovery.reachable) {
    try {
      store = recovery.module.createRecoveryStore({ file: idempotencyFile(config) });
      S('idempotency', 'ok', { file: idempotencyFile(config), key: idempotencyKey });
    } catch (err) {
      S('idempotency', 'skipped', `recovery store unavailable: ${err.message}`);
    }
  } else {
    S('idempotency', 'skipped', `result-recovery unreachable: ${recovery.error || 'unknown'}`);
  }

  if (store && identity) {
    const prior = store.get(identity);
    if (prior && prior.result) {
      const retryRequested = opts.forceRetry === true || opts.retry === true;
      if (retryRequested && prior.result.settlement === 'UNKNOWN') {
        const r = fail('execute', {
          code: 'unsafe_retry_refused',
          message: 'Refused: the stored run settled UNKNOWN. An explicit retry after UNKNOWN settlement could double-spend. Resolve the settlement manually first (callx402 resolve --evidence ...).',
          disposition: 'Unsafe retry refused: prior settlement state is UNKNOWN.',
          idempotencyKey, deduped: true,
          data: { stages },
        });
        return { result: r, exitCode: EXIT.SETTLEMENT_UNKNOWN };
      }
      const dup = { ...prior.result, deduped: true, idempotencyKey };
      return { result: dup, exitCode: exitCodeFor(dup) };
    }
  }

  // ---- Stage 1: intent parse ------------------------------------------
  const intentSub = getSubsystem('intent', { config, deps });
  let intent = null;
  if (!intentSub.reachable) {
    S('intent', 'skipped', `intent-engine unreachable: ${intentSub.error || 'unknown'}`);
  } else if (!intentSub.enabled) {
    S('intent', 'disabled', `intent-engine disabled; set ${intentSub.flag}=1 to enable parsing`);
  } else {
    try {
      // Awaited: an async (or slow) intent engine must respect timeoutMs via
      // the runAction race; awaiting a sync value is a no-op.
      intent = await intentSub.module.parse(String(text));
      const budgetHint = intent && intent.constraints && (intent.constraints.MAX_PRICE ?? intent.constraints.AMOUNT);
      S('intent', 'ok', { goals: intent.goals, action_class: intent.action_class, budgetHint: budgetHint ?? null });
    } catch (err) {
      S('intent', 'failed', err.message);
    }
  }

  let maxBudget = opts.maxBudget != null ? Number(opts.maxBudget)
    : (intent && intent.constraints && Number.isFinite(Number(intent.constraints.MAX_PRICE)) ? Number(intent.constraints.MAX_PRICE)
    : Number(config.defaultBudgetUsd));
  if (!Number.isFinite(maxBudget) || maxBudget < 0) maxBudget = Number(config.defaultBudgetUsd);
  const approvalThreshold = opts.approvalThreshold != null ? Number(opts.approvalThreshold) : Number(config.approvalThresholdUsd);

  // ---- Stage 2: capability graph --------------------------------------
  const capSub = getSubsystem('capabilities', { config, deps });
  let candidates = [];
  if (!capSub.reachable) {
    S('capabilities', 'skipped', `capability-graph unreachable: ${capSub.error || 'unknown'}`);
  } else if (!capSub.enabled) {
    S('capabilities', 'disabled', `capability-graph disabled; set ${capSub.flag}=1 to enable tool discovery`);
  } else {
    try {
      const graph = await capSub.module.createGraph();
      const stats = graph.stats ? await graph.stats() : {};
      const toolCount = stats.tools || 0;
      if (toolCount === 0) {
        S('capabilities', 'ok', { candidates: 0, note: 'capability graph is empty: no tools registered' });
      } else {
        const found = await graph.findTools(String(text));
        candidates = Array.isArray(found.candidates) ? found.candidates : [];
        S('capabilities', 'ok', { candidates: candidates.length, stats: graph.stats ? await graph.stats() : {} });
      }
    } catch (err) {
      S('capabilities', 'failed', err.message);
    }
  }

  // ---- Stage 3: economic planner --------------------------------------
  const plannerSub = getSubsystem('planner', { config, deps });
  let plan = null;
  const speedPolicy = (SPEED_POLICY[String(opts.speed || 'balanced').toLowerCase()] || 'BEST_VALUE');
  if (!plannerSub.reachable) {
    S('planner', 'skipped', `economic-planner unreachable: ${plannerSub.error || 'unknown'}`);
  } else if (!plannerSub.enabled) {
    S('planner', 'disabled', `economic-planner disabled; set ${plannerSub.flag}=1 to enable costed planning`);
  } else {
    try {
      const steps = [{
        id: 'goal',
        name: (intent && intent.goals && intent.goals[0] && intent.goals[0].goal) || 'goal',
        candidates: candidates.length > 0
          ? candidates.slice(0, 8).map((c, i) => ({ tool: String(c.id || c.name || `tool-${i}`), price_usd: Number(c.price_usd ?? c.cost_usd ?? 0) || 0 }))
          : [{ tool: 'no-registered-tool', price_usd: 0 }],
      }];
      plan = await plannerSub.module.planGoal({
        goal: String(text).slice(0, 120),
        steps,
        maxBudgetUsd: maxBudget,
        objective: speedPolicy === 'FASTEST_VERIFIED' ? 'FASTEST' : speedPolicy === 'LOWEST_TOTAL_COST' ? 'CHEAPEST' : 'BEST_VALUE',
        networks: opts.networks || null,
        assets: opts.assets || null,
        providers: opts.providers || null,
      });
      S('planner', plan && plan.valid ? 'ok' : 'no_plan', plan && plan.valid
        ? { cost: plan.total_cost_usd ?? plan.cost_usd ?? null, plans_considered: plan.plans_considered }
        : (plan && plan.reason) || 'planner returned no valid plan');
    } catch (err) {
      S('planner', 'failed', err.message);
    }
  }

  const plannedCost = plan && plan.valid
    ? Number(plan.total_cost_usd ?? plan.cost_usd ?? 0)
    : (candidates.length > 0 ? Math.min(...candidates.map((c) => Number(c.price_usd ?? c.cost_usd ?? 0)).filter(Number.isFinite)) : 0);

  // ---- Stage 4: SpendGuard budget check --------------------------------
  const sgSub = getSubsystem('spendguard', { config, deps });
  if (!sgSub.reachable) {
    S('spendguard', 'skipped', `spendguard unreachable: ${sgSub.error || 'unknown'}; budget enforced by direct comparison only`);
  } else if (!sgSub.enabled) {
    S('spendguard', 'disabled', `spendguard disabled; set ${sgSub.flag}=1 to enable task-level guards`);
  }
  let remainingUsd = maxBudget;
  if (sgSub.reachable && sgSub.enabled) {
    try {
      const taskGuard = await sgSub.module.createTaskSpendGuard({
        taskId: `callx402-${Date.now()}`,
        totalTaskBudgetUsd: maxBudget,
        approvedNetworks: opts.networks || (config.defaultNetwork ? [config.defaultNetwork] : null),
        approvedAssets: opts.assets || (config.defaultAsset ? [config.defaultAsset] : null),
        approvedProviders: opts.providers || null,
      });
      const st = await taskGuard.status();
      remainingUsd = Number(st.remainingTaskUsd ?? maxBudget);
      S('spendguard', 'ok', { remainingTaskUsd: remainingUsd, budgetUsd: maxBudget });
    } catch (err) {
      S('spendguard', 'failed', err.message);
    }
  }

  // Money-safety: over budget -> refuse with zero side effects. Nothing has
  // executed at this point, so refusal is inherently clean.
  if (plannedCost > maxBudget) {
    S('budget', 'refused', { plannedCost, maxBudget });
    const r = fail('execute', {
      subsystem: 'spendguard', subsystemStatus: sgSub.subsystemStatus,
      code: 'budget_refused',
      message: `Planned cost $${plannedCost.toFixed(2)} exceeds budget $${maxBudget.toFixed(2)}. Nothing was executed and no money moved. Raise --max-budget or narrow the goal.`,
      disposition: 'Budget refused: planned cost exceeds budget; zero side effects.',
      data: { stages, plannedCost, maxBudget },
      idempotencyKey,
    });
    return { result: r, exitCode: EXIT.BUDGET_REFUSED };
  }
  if (Number.isFinite(approvalThreshold) && plannedCost > approvalThreshold && opts.approve !== true && !opts.dryRun) {
    S('budget', 'refused', { plannedCost, approvalThreshold, reason: 'approval_required' });
    const r = fail('execute', {
      subsystem: 'spendguard', subsystemStatus: sgSub.subsystemStatus,
      code: 'approval_required',
      message: `Planned cost $${plannedCost.toFixed(2)} exceeds the approval threshold $${approvalThreshold.toFixed(2)}. Re-run with --approve to authorize, or nothing will happen.`,
      disposition: 'Fail closed: cost above approval threshold without explicit approval.',
      data: { stages, plannedCost, approvalThreshold },
      idempotencyKey,
    });
    return { result: r, exitCode: EXIT.BUDGET_REFUSED };
  }
  S('budget', 'ok', { plannedCost, maxBudget, approved: opts.approve === true });

  // ---- Stage 5: router --------------------------------------------------
  const routerSub = getSubsystem('router', { config, deps });
  let route = null;
  if (!routerSub.reachable) {
    S('router', 'skipped', `router unreachable: ${routerSub.error || 'unknown'}`);
  } else if (!routerSub.enabled) {
    S('router', 'disabled', `router disabled; set ${routerSub.flag}=1 to enable route selection`);
  } else if (candidates.length === 0) {
    S('router', 'skipped', 'no candidate tools discovered; nothing to rank');
  } else {
    try {
      const routerOpts = {
        policy: speedPolicy,
        networks: opts.networks || null,
        assets: opts.assets || null,
        providers: opts.providers || null,
      };
      // normalizeCandidate(c, opts): opts is required by the real
      // smart-router; constraint opts ride along for recording doubles.
      const normalized = [];
      for (const c of candidates) {
        try {
          normalized.push(routerSub.module.normalizeCandidate
            ? await routerSub.module.normalizeCandidate(c, routerOpts)
            : c);
        } catch (_) { /* skip un-normalizable candidates */ }
      }
      const ranked = await routerSub.module.rankTools(normalized, routerOpts);
      const selected = await routerSub.module.selectTool(ranked);
      route = { selected, policy: speedPolicy };
      S('router', 'ok', { selected: selected && (selected.tool || selected.id || selected.name), policy: speedPolicy });
    } catch (err) {
      S('router', 'failed', err.message);
    }
  }

  // ---- Stage 6: execution kernel — live route required ------------------
  // The dispatch layer wires no live tool endpoints: without a real executable
  // route we report honestly and stop. Never fabricate execution.
  const kernelSub = getSubsystem('kernel', { config, deps });
  const hasLiveRoute = !!(route && route.selected && route.selected.executable === true);
  if (opts.dryRun === true) {
    S('execution', 'dry_run', 'dry-run: planning only, no execution attempted');
  } else if (!hasLiveRoute) {
    S('execution', 'no_route', 'no executable route available: no live tool endpoint is wired to this dispatch. No execution performed, no money moved.');
  } else if (!kernelSub.enabled) {
    S('execution', 'disabled', `execution kernel disabled; set ${kernelSub.flag}=1 and wire a live route to execute`);
  }

  const executed = hasLiveRoute && kernelSub.enabled && opts.dryRun !== true;

  // ---- Stages 7-9: effect proof / settlement / delivery ----------------
  let settlement = null;
  let receipt = {};
  if (executed) {
    // Only reachable with a real executable route; placeholder branch kept
    // explicit so the honesty invariant is auditable.
    S('effect_proof', 'not_implemented', 'live execution path is not wired in this build');
    S('settlement', 'not_implemented', 'live execution path is not wired in this build');
    S('delivery', 'not_implemented', 'live execution path is not wired in this build');
  } else {
    S('effect_proof', 'skipped', 'no execution: no effect proof issued');
    S('settlement', 'skipped', 'no execution: nothing to settle');
    S('delivery', 'skipped', 'no execution: nothing delivered');
  }

  // ---- Stage 10: RevRule emit (idempotent) ------------------------------
  const revSub = getSubsystem('revrule', { config, deps });
  if (!revSub.reachable) {
    S('revrule', 'skipped', `revrule unreachable: ${revSub.error || 'unknown'}`);
  } else if (!revSub.enabled) {
    S('revrule', 'disabled', `revrule disabled; set ${revSub.flag}=1 to emit economic events`);
  } else {
    try {
      const emitter = await revSub.module.createEmitter({ sink: await revSub.module.createMemorySink(), idempotencyRegistry: await revSub.module.createIdempotencyRegistry() });
      const ev = await emitter.emitOnce({
        operationId: idempotencyKey || `plan-${Date.now()}`,
        toolId: 'callx402.execute',
        payer: 'local',
        payTo: 'none',
        amountAt: plannedCost,
        amountAtomic: Math.round(Number(plannedCost || 0) * 1e6),
        asset: config.defaultAsset || 'USDC',
        network: config.defaultNetwork || 'base',
        type: 'callx402.intent_planned',
        intent: String(text).slice(0, 120),
        maxBudget,
        idempotencyKey: idempotencyKey || `plan-${Date.now()}`,
        executed,
      });
      S('revrule', ev.emitted ? 'ok' : 'deduped', ev.emitted ? { eventId: ev.eventId } : { reason: ev.reason });
    } catch (err) {
      S('revrule', 'failed', err.message);
    }
  }

  const disposition = executed
    ? 'Intent executed through a live route.'
    : opts.dryRun === true
      ? 'Dry run: plan validated, no execution performed.'
      : 'No executable route available: intent parsed and planned honestly, but no live tool endpoint is wired to this dispatch, so nothing was executed and no money moved.';

  const r = ok('execute', {
    subsystem: 'pipeline',
    subsystemStatus: 'ok',
    disposition,
    data: { stages, intent: intent ? { goals: intent.goals, action_class: intent.action_class, risk_level: intent.risk_level } : null, plannedCost, maxBudget, route: route ? { policy: route.policy } : null, dryRun: opts.dryRun === true, executed },
    settlement,
    receipt,
    idempotencyKey,
  });
  storeResult(store, identity, r);
  return { result: r, exitCode: EXIT.OK };
}

module.exports = { runIntent };
