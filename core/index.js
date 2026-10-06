'use strict';

/**
 * core/index.js — action dispatcher.
 *
 * runAction(name, args, { deps, config, timeoutMs }) -> Promise<{ result, exitCode }>
 *   `deps` is an internal/test seam: deps[<subsystem>] replaces the real module.
 * getStatus({ deps, config }) -> per-subsystem reachability report.
 * runIntent re-exported from pipeline.js.
 */

const { EXIT, ok, fail, exitCodeFor } = require('./envelope');
const { loadConfig } = require('./config');
const { getSubsystem, getStatus: statusOf, SUBSYSTEMS } = require('./subsystems');
const { runIntent } = require('./pipeline');
const { dispatchRemote } = require('./remote');

const ACTIONS = ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'status', 'preflight', 'inspect'];

/** Parse --evidence style input: JSON string or @file. */
function readEvidenceInput(input, fs, path) {
  if (input === undefined || input === null || input === '') return {};
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (s.startsWith('@')) {
    const p = s.slice(1);
    const raw = fs.readFileSync(path.resolve(p), 'utf8');
    return JSON.parse(raw);
  }
  return JSON.parse(s);
}

function disabledResult(action, subsystem, handle) {
  return {
    result: fail(action, {
      subsystem, subsystemStatus: 'disabled',
      code: 'subsystem_disabled',
      message: `${subsystem} subsystem is disabled. Set ${handle.flag}=1 to enable it. Nothing was executed.`,
      disposition: `${subsystem} disabled: nothing executed.`,
      data: { flag: handle.flag, note: handle.note },
    }),
    exitCode: EXIT.UNAVAILABLE,
  };
}

function unreachableResult(action, subsystem, handle) {
  return {
    result: fail(action, {
      subsystem, subsystemStatus: 'unreachable',
      code: 'subsystem_unreachable',
      message: `${subsystem} subsystem could not be loaded (${handle.error || 'unknown error'}). Nothing was executed.`,
      disposition: `${subsystem} unreachable: nothing executed.`,
      data: { error: handle.error },
    }),
    exitCode: EXIT.UNAVAILABLE,
  };
}

function requireSubsystem(action, subsystem, { config, deps }) {
  const h = getSubsystem(subsystem, { config, deps });
  if (!h.reachable) return { ...unreachableResult(action, subsystem, h), handle: null };
  if (!h.enabled) return { ...disabledResult(action, subsystem, h), handle: null };
  return { result: null, exitCode: null, handle: h };
}

async function actDiagnose(args, ctx) {
  const g = requireSubsystem('diagnose', 'doctor', ctx);
  if (!g.handle) return g;
  try {
    const evidence = readEvidenceInput(args.evidence ?? args.target, require('fs'), require('path'));
    const report = g.handle.module.runMcpDoctor(evidence);
    const whatFailed = report.whatFailed || 'unknown';
    return {
      result: ok('diagnose', { subsystem: 'doctor', disposition: `Diagnosis complete: ${whatFailed}`, data: { report } }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    const isMalformed = err instanceof SyntaxError;
    return { result: fail('diagnose', { subsystem: 'doctor', code: isMalformed ? 'usage' : 'failed', message: isMalformed ? `malformed evidence JSON: ${err.message}` : err.message }), exitCode: isMalformed ? EXIT.USAGE : EXIT.FAIL };
  }
}

async function actRescue(args, ctx) {
  const g = requireSubsystem('rescue', 'rescue', ctx);
  if (!g.handle) return g;
  const config = ctx.config;
  const authed = args.auth === true || args.auth === '1' || !!config.authToken || !!process.env.CALLX402_AUTH_TOKEN || config.rescueAuth === true;
  if (!authed) {
    return {
      result: fail('rescue', {
        subsystem: 'rescue', subsystemStatus: g.handle.subsystemStatus,
        code: 'auth_required',
        message: 'Rescue requires explicit authorization: set CALLX402_AUTH_TOKEN, config authToken, or pass --auth. Detection/quote tiers are free and read-only; execution never happens without auth.',
        disposition: 'Rescue refused: no authorization provided.',
        data: { incident: args.incident || null, flag: g.handle.flag },
      }),
      exitCode: EXIT.UNAVAILABLE,
    };
  }
  try {
    const rescue = g.handle.module.createRescue({});
    const incidentId = args.incident || null;
    const context = { incidentId, ...(args.context || {}) };
    const incidents = rescue.detect(context);
    const incident = Array.isArray(incidents) && incidents.length > 0
      ? incidents.find((i) => !incidentId || i.incidentId === incidentId || i.type === incidentId) || incidents[0]
      : null;
    let quote = null;
    let offer = null;
    if (incident) {
      quote = await rescue.quoteRescue(incident, { network: args.network || config.defaultNetwork });
      offer = rescue.freeVsPaid(incident, quote);
    }
    return {
      result: ok('rescue', {
        subsystem: 'rescue',
        disposition: incident
          ? `Rescue triage (free, read-only): ${incident.type}. Paid execution was NOT performed; quote requires explicit paid engagement.`
          : 'Rescue detection ran (free, read-only): no incident matched the supplied context.',
        data: { incident, quote, offer, version: rescue.version },
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    return { result: fail('rescue', { subsystem: 'rescue', code: 'failed', message: err.message }), exitCode: EXIT.FAIL };
  }
}

async function actRoute(args, ctx) {
  const g = requireSubsystem('route', 'router', ctx);
  if (!g.handle) return g;
  try {
    const goal = args.goal || args.intent || args.text || '';
    if (!goal.trim()) {
      return { result: fail('route', { subsystem: 'router', code: 'usage', message: '--goal <text> is required' }), exitCode: EXIT.USAGE };
    }
    const speedPolicy = ({ fast: 'FASTEST_VERIFIED', cheap: 'LOWEST_TOTAL_COST', balanced: 'BEST_VALUE' })[String(args.speed || 'balanced').toLowerCase()] || 'BEST_VALUE';
    const m = g.handle.module;
    // Candidates: use capability graph when it is enabled; otherwise an
    // explicit single candidate set supplied via args.candidates.
    const cap = getSubsystem('capabilities', ctx);
    let candidates = [];
    if (cap.enabled && cap.reachable) {
      try {
        const graph = cap.module.createGraph();
        const found = graph.findTools(goal);
        candidates = Array.isArray(found.candidates) ? found.candidates : [];
      } catch (_) { /* fall through to args candidates */ }
    }
    if (candidates.length === 0 && Array.isArray(args.candidates) && args.candidates.length > 0) {
      candidates = args.candidates;
    }
    if (candidates.length === 0) {
      const capNote = cap.reachable && cap.enabled
        ? 'capability graph is enabled but holds no registered tools'
        : 'capability graph is disabled';
      return {
        result: ok('route', {
          subsystem: 'router',
          disposition: `No candidate tools available: ${capNote} and no --candidates were supplied. No route selected; nothing executed.`,
          data: { goal, candidates: 0, flag: m.FLAG },
        }),
        exitCode: EXIT.OK,
      };
    }
    // normalizeCandidate(c, opts): opts is required by the real smart-router
    // (reads opts.latency_value_usd_per_sec); pass routing constraints too.
    // Awaited so a slow router still respects timeoutMs (no-op for sync).
    const normalizeOpts = { networks: args.networks || null, assets: args.assets || null };
    const normalized = [];
    for (const c of candidates) {
      try { normalized.push(await m.normalizeCandidate(c, normalizeOpts)); } catch (_) { /* skip */ }
    }
    if (normalized.length === 0) {
      return { result: fail('route', { subsystem: 'router', code: 'failed', message: 'candidates could not be normalized by the router' }), exitCode: EXIT.FAIL };
    }
    const ranked = await m.rankTools(normalized, { policy: speedPolicy, networks: args.networks || null, assets: args.assets || null });
    const selected = await m.selectTool(ranked);
    let pathChoice = null;
    if (Array.isArray(args.paths) && args.paths.length > 0 && typeof m.choosePath === 'function') {
      pathChoice = m.choosePath({ paths: args.paths, policy: speedPolicy });
    }
    return {
      result: ok('route', {
        subsystem: 'router',
        disposition: `Route selected under ${speedPolicy} policy. Selection only: nothing executed, no money moved.`,
        data: { goal, policy: speedPolicy, ranked, selected, pathChoice },
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    return { result: fail('route', { subsystem: 'router', code: 'failed', message: err.message }), exitCode: EXIT.FAIL };
  }
}

async function actResolve(args, ctx) {
  const g = requireSubsystem('resolve', 'settlement', ctx);
  if (!g.handle) return g;
  try {
    const evidence = readEvidenceInput(args.evidence, require('fs'), require('path'));
    const r = g.handle.module.resolve(evidence);
    const state = r.state;
    const isUnknown = state === 'UNKNOWN';
    const disposition = isUnknown
      ? 'Settlement UNKNOWN: no auto-retry, no repay. Resolve manually with fresh evidence; an operator override requires callx402-level explicit action outside this dispatch.'
      : `Settlement resolved: ${state} (${r.confidence || 'n/a'} confidence). ${r.policy ? `Policy: ${r.policy.retry}.` : ''}`;
    const result = isUnknown
      ? fail('resolve', { subsystem: 'settlement', code: 'settlement_unknown', message: 'Settlement state is UNKNOWN. Per money-safety rules this must never auto-retry or repay.', disposition, settlement: state, data: { resolution: r } })
      : ok('resolve', { subsystem: 'settlement', disposition, settlement: state, txHash: evidence.txHash || null, data: { resolution: r } });
    return { result, exitCode: isUnknown ? EXIT.SETTLEMENT_UNKNOWN : EXIT.OK };
  } catch (err) {
    const isMalformed = err instanceof SyntaxError;
    return { result: fail('resolve', { subsystem: 'settlement', code: isMalformed ? 'usage' : 'failed', message: isMalformed ? `malformed evidence JSON: ${err.message}` : err.message }), exitCode: isMalformed ? EXIT.USAGE : EXIT.FAIL };
  }
}

async function actExecute(args, ctx) {
  const intent = args.intent || args.text || '';
  if (!intent.trim()) {
    return { result: fail('execute', { code: 'usage', message: '--intent <text> is required' }), exitCode: EXIT.USAGE };
  }
  return runIntent(intent, {
    maxBudget: args.maxBudget, deadline: args.deadline, speed: args.speed, risk: args.risk,
    networks: args.networks, assets: args.assets, providers: args.providers,
    approvalThreshold: args.approvalThreshold, idempotencyKey: args.idempotencyKey,
    timeoutMs: args.timeoutMs, dryRun: args.dryRun, approve: args.approve,
    forceRetry: args.forceRetry, retry: args.retry,
  }, ctx);
}

async function actMonitor(args, ctx) {
  const g = requireSubsystem('monitor', 'sentinel', ctx);
  if (!g.handle) return g;
  try {
    const sentinel = g.handle.module.createSentinel({ ...(args.sentinelOpts || {}) });
    const snapshot = {
      inert: !!sentinel.inert,
      enabled: g.handle.enabled,
      incidentTypes: Object.keys(g.handle.module.INCIDENT_TYPES || {}),
      note: sentinel.inert ? 'Inert sentinel: set PAYLOAD_SENTINEL=1 for a live tracker.' : 'Live sentinel tracker.',
    };
    if (args.watch) {
      // Stream snapshots until interrupted. JSON lines when --json.
      const json = !!args.json;
      const intervalMs = Number(args.intervalMs || args.interval) > 0 ? Number(args.intervalMs || args.interval) : 5000;
      if (!json) console.log('# monitoring sentinel snapshots every ' + intervalMs + 'ms (Ctrl+C to stop)');
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const line = { ...snapshot, at: new Date().toISOString() };
        if (json) console.log(JSON.stringify(line)); else console.log(JSON.stringify(line));
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return {
      result: ok('monitor', { subsystem: 'sentinel', disposition: sentinel.inert ? 'Sentinel snapshot (inert): no live tracking.' : 'Sentinel snapshot.', data: { snapshot } }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    return { result: fail('monitor', { subsystem: 'sentinel', code: 'failed', message: err.message }), exitCode: EXIT.FAIL };
  }
}

async function actStatus(args, ctx) {
  const subsystems = statusOf({ config: ctx.config, deps: ctx.deps });
  const all = Object.values(subsystems);
  const reachable = all.filter((s) => s.reachable).length;
  const enabledCount = all.filter((s) => s.enabled).length;
  return {
    result: ok('status', {
      subsystem: null,
      disposition: `callx402 status: ${reachable}/${all.length} subsystems reachable, ${enabledCount}/${all.length} enabled.`,
      data: { version: ctx.version || '0.1.0', v2Root: require('./subsystems').getV2Root(ctx.config || {}), subsystems },
    }),
    exitCode: EXIT.OK,
  };
}

async function actPreflight(args, ctx) {
  const g = requireSubsystem('preflight', 'preflight', ctx);
  if (!g.handle) return g;
  try {
    const report = await g.handle.module.runMcpPreflight(args.context || args.ctx || {});
    return {
      result: ok('preflight', { subsystem: 'preflight', disposition: 'Preflight checks complete.', data: { report } }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    return { result: fail('preflight', { subsystem: 'preflight', code: 'failed', message: err.message }), exitCode: EXIT.FAIL };
  }
}

async function actInspect(args, ctx) {
  const g = requireSubsystem('inspect', 'capabilities', ctx);
  if (!g.handle) return g;
  try {
    const graph = g.handle.module.createGraph();
    const query = args.query || args.text || '';
    const found = query ? graph.findTools(query) : { intent: query, candidates: [], took_ms: 0 };
    return {
      result: ok('inspect', {
        subsystem: 'capabilities',
        disposition: query ? `Capability lookup for "${query}": ${(found.candidates || []).length} candidate(s).` : 'Capability graph stats.',
        data: { query, stats: graph.stats(), candidates: found.candidates || [] },
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    return { result: fail('inspect', { subsystem: 'capabilities', code: 'failed', message: err.message }), exitCode: EXIT.FAIL };
  }
}

/**
 * runAction(name, args, { deps, config, timeoutMs, version }) -> Promise<{ result, exitCode }>
 */
async function runAction(name, args = {}, opts = {}) {
  const config = opts.config || loadConfig();
  const ctx = { deps: opts.deps || {}, config, timeoutMs: opts.timeoutMs, version: opts.version || '0.1.0' };

  // SPEC §5: remote mode dispatches over HTTP to a callx402 server. The deps
  // seam is local-only: an explicit subsystem override means local dispatch.
  if (config.mode === 'remote' && Object.keys(ctx.deps).length === 0) {
    return dispatchRemote(config, name, args, { timeoutMs: opts.timeoutMs || args.timeoutMs });
  }

  const work = (async () => {
    switch (name) {
      case 'diagnose': return actDiagnose(args, ctx);
      case 'doctor': return actDiagnose(args, ctx);
      case 'rescue': return actRescue(args, ctx);
      case 'route': return actRoute(args, ctx);
      case 'resolve': return actResolve(args, ctx);
      case 'execute': return actExecute(args, ctx);
      case 'monitor': return actMonitor(args, ctx);
      case 'status': return actStatus(args, ctx);
      case 'preflight': return actPreflight(args, ctx);
      case 'inspect': return actInspect(args, ctx);
      default:
        return {
          result: fail(name, {
            code: 'unknown_action',
            message: `unknown command '${name}'. Valid commands: ${ACTIONS.join(', ')}.`,
            disposition: `Unknown command '${name}'.`,
            data: { commands: ACTIONS },
          }),
          exitCode: EXIT.USAGE,
        };
    }
  })();

  const timeoutMs = Number(opts.timeoutMs || args.timeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    const raced = await Promise.race([
      work,
      new Promise((resolve) => setTimeout(() => resolve({
        result: fail(name, { code: 'timeout', message: `action '${name}' timed out after ${timeoutMs}ms` }),
        exitCode: EXIT.FAIL,
      }), timeoutMs)),
    ]);
    return raced;
  }
  return work;
}

module.exports = { ACTIONS, runAction, runIntent, getStatus: statusOf, SUBSYSTEMS };
