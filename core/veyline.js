'use strict';

/**
 * core/veyline.js — dispatch handlers for the Veyline Recovery track:
 *   callx402 evidence <operationId> [--dir <path>] [--evidence <json|@file>]
 *   callx402 explain  <operationId> [--dir <path>] [--evidence <json|@file>]
 *   callx402 recover  <operationId> [--dir <path>] [--evidence <json|@file>]
 *                     [--identity <id>]
 *
 * ADDITIVE-ONLY: this file is new; no existing command is touched. It
 * resolves the Veyline recovery modules from the recovery dir
 * (CALLX402_VEYLINE_ROOT env, config veylineRoot, or the default relative
 * path) — it does NOT go through core/subsystems.js, whose hard rule
 * limits requires to the v2.0.0 tree.
 *
 * All three commands are read-only. `recover` reports the recovery
 * decision the network would make (RECOVERABLE / SAFE_RETRY /
 * EXECUTED_BUT_UNRECOVERABLE / SETTLEMENT_UNKNOWN); it never charges,
 * never executes, never repays. Performing the approved safe action stays
 * with the operator's own adapters.
 *
 * Gate: PAYLOAD_VEYLINE_LEDGER=1 for evidence/explain,
 *       PAYLOAD_VEYLINE_RECOVERY=1 for recover. Default OFF.
 */

const path = require('path');
const { EXIT, ok, fail } = require('./envelope');

function veylineRoot(config = {}) {
  return config.veylineRoot
    || process.env.CALLX402_VEYLINE_ROOT
    || path.resolve(__dirname, '..', '..', 'veyline', 'engineering', 'recovery');
}

function loadVeyline(config, deps) {
  if (deps && deps.veyline) {
    return { modules: deps.veyline, flag: '(test override)', overridden: true };
  }
  const root = veylineRoot(config);
  try {
    const modules = {
      ledger: require(path.join(root, 'operation-ledger.js')),
      recovery: require(path.join(root, 'recovery-state.js')),
      planner: require(path.join(root, 'rescue-planner.js')),
      trust: require(path.join(root, 'trust-graph.js')),
      intel: require(path.join(root, 'incident-intel.js')),
      continuity: require(path.join(root, 'continuity.js')),
      root,
    };
    return { modules, flag: null, overridden: false };
  } catch (err) {
    return { modules: null, error: err.message };
  }
}

function readJsonInput(input) {
  if (input === undefined || input === null || input === '') return {};
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (s.startsWith('@')) {
    const fs = require('fs');
    return JSON.parse(fs.readFileSync(path.resolve(s.slice(1)), 'utf8'));
  }
  return JSON.parse(s);
}

function disabledEnvelope(action, flag) {
  return {
    result: fail(action, {
      subsystem: 'veyline', subsystemStatus: 'disabled',
      code: 'subsystem_disabled',
      message: `veyline recovery subsystem is disabled. Set ${flag}=1 to enable it. Nothing was executed.`,
      disposition: 'veyline disabled: nothing executed.',
      data: { flag },
    }),
    exitCode: EXIT.UNAVAILABLE,
  };
}

function gate(modules, action, flag) {
  if (!modules) {
    return {
      result: fail(action, { subsystem: 'veyline', code: 'subsystem_unreachable', message: 'veyline recovery modules could not be loaded. Nothing was executed.' }),
      exitCode: EXIT.UNAVAILABLE,
    };
  }
  const mod = action === 'recover' ? modules.recovery : modules.ledger;
  const on = typeof mod.enabled === 'function' ? mod.enabled() : false;
  if (!on) return disabledEnvelope(action, flag);
  return null;
}

function ledgerFor(modules, dir) {
  const d = dir || path.join(process.cwd(), '.veyline');
  return modules.ledger.createOperationLedger({ dir: d });
}

async function actEvidence(args, ctx) {
  const { modules, error } = loadVeyline(ctx.config, ctx.deps);
  if (error || !modules) {
    return { result: fail('evidence', { subsystem: 'veyline', code: 'subsystem_unreachable', message: `veyline modules unreachable: ${error || 'unknown'}` }), exitCode: EXIT.UNAVAILABLE };
  }
  const g = gate(modules, 'evidence', modules.ledger.FLAG);
  if (g) return g;
  try {
    const operationId = args.operationId;
    if (!operationId) {
      return { result: fail('evidence', { subsystem: 'veyline', code: 'usage', message: 'operationId is required: callx402 evidence <operationId>' }), exitCode: EXIT.USAGE };
    }
    const ledger = ledgerFor(modules, args.dir);
    const events = ledger.events(operationId);
    const states = ledger.latestStates(operationId);
    const protocols = ledger.protocols(operationId);
    const data = {
      operationId, events, states, protocols,
      eventCount: events.length,
      basis: events.length > 0 ? 'recorded ledger evidence' : 'no_basis: no events recorded for this operation',
    };
    return {
      result: ok('evidence', {
        subsystem: 'veyline',
        disposition: events.length > 0
          ? `Evidence for ${operationId}: ${events.length} event(s) across ${protocols.join(', ') || 'no protocols'}.`
          : `No evidence recorded for ${operationId}.`,
        data,
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    const isMalformed = err instanceof SyntaxError;
    return { result: fail('evidence', { subsystem: 'veyline', code: isMalformed ? 'usage' : 'failed', message: err.message }), exitCode: isMalformed ? EXIT.USAGE : EXIT.FAIL };
  }
}

async function actExplain(args, ctx) {
  const { modules, error } = loadVeyline(ctx.config, ctx.deps);
  if (error || !modules) {
    return { result: fail('explain', { subsystem: 'veyline', code: 'subsystem_unreachable', message: `veyline modules unreachable: ${error || 'unknown'}` }), exitCode: EXIT.UNAVAILABLE };
  }
  const g = gate(modules, 'explain', modules.ledger.FLAG);
  if (g) return g;
  try {
    const operationId = args.operationId;
    if (!operationId) {
      return { result: fail('explain', { subsystem: 'veyline', code: 'usage', message: 'operationId is required: callx402 explain <operationId>' }), exitCode: EXIT.USAGE };
    }
    const ledger = ledgerFor(modules, args.dir);
    const events = ledger.events(operationId);
    const states = ledger.latestStates(operationId);
    let assessment;
    if (events.length === 0) {
      assessment = 'NO_BASIS: nothing recorded; no claim can be made about this operation.';
    } else if (states.payment === 'UNKNOWN' || states.execution === 'UNKNOWN') {
      assessment = 'INCOMPLETE: a plane is UNKNOWN — do not retry, do not repay; gather fresh evidence or escalate to human review.';
    } else if (states.payment === 'SETTLED' && states.execution === 'SUCCEEDED' && (states.delivery === 'DELIVERED' || states.delivery === 'ACKED')) {
      assessment = 'KNOWN_SAFE: paid, executed, delivered.';
    } else if (states.delivery === 'LOST') {
      assessment = 'RECOVERY_CANDIDATE: delivery lost — run `callx402 recover <operationId>` to see the safe recovery decision.';
    } else {
      assessment = 'PARTIAL: some planes resolved, some not — see states; safe action depends on the unresolved plane.';
    }
    const trail = events.map((e) => `[${e.seq}] ${e.at} ${e.kind}${e.protocol ? `/${e.protocol}` : ''}: ${e.summary || ''}`.trim());
    return {
      result: ok('explain', {
        subsystem: 'veyline',
        disposition: `Explanation for ${operationId}: ${assessment}`,
        data: { operationId, states, assessment, trail, eventCount: events.length },
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    const isMalformed = err instanceof SyntaxError;
    return { result: fail('explain', { subsystem: 'veyline', code: isMalformed ? 'usage' : 'failed', message: err.message }), exitCode: isMalformed ? EXIT.USAGE : EXIT.FAIL };
  }
}

async function actRecover(args, ctx) {
  const { modules, error } = loadVeyline(ctx.config, ctx.deps);
  if (error || !modules) {
    return { result: fail('recover', { subsystem: 'veyline', code: 'subsystem_unreachable', message: `veyline modules unreachable: ${error || 'unknown'}` }), exitCode: EXIT.UNAVAILABLE };
  }
  const g = gate(modules, 'recover', modules.recovery.FLAG);
  if (g) return g;
  try {
    const operationId = args.operationId;
    if (!operationId) {
      return { result: fail('recover', { subsystem: 'veyline', code: 'usage', message: 'operationId is required: callx402 recover <operationId>' }), exitCode: EXIT.USAGE };
    }
    const evidence = readJsonInput(args.evidence);
    const dir = args.dir || path.join(process.cwd(), '.veyline');
    const ledger = ledgerFor(modules, args.dir);
    // File-backed cache shared via --dir: the CLI reads the same recovery
    // substrate a server wrote. Without --dir the cache is in-memory.
    const cache = args.dir && typeof modules.recovery.createFileBackedCache === 'function'
      ? modules.recovery.createFileBackedCache({ file: path.join(dir, 'recovery-cache.jsonl') })
      : undefined;
    const network = modules.recovery.createRecoveryNetwork({ ledger, cache });
    let identity = args.identity || evidence.identity || null;
    if (!identity && evidence.toolName && evidence.payer && evidence.paymentAuthFingerprint) {
      identity = network.buildOperationIdentity({
        toolName: evidence.toolName,
        args: evidence.args,
        payer: evidence.payer,
        paymentAuthFingerprint: evidence.paymentAuthFingerprint,
        traceId: evidence.traceId,
        operationId,
      });
    }
    if (!identity) {
      return {
        result: fail('recover', {
          subsystem: 'veyline', code: 'usage',
          message: 'an operation identity is required: pass --identity <id> or --evidence with toolName/payer/paymentAuthFingerprint (+args/traceId).',
        }),
        exitCode: EXIT.USAGE,
      };
    }
    const decision = network.onLostResult({
      operationId,
      identity,
      credentials: { payer: evidence.payer, paymentAuthFingerprint: evidence.paymentAuthFingerprint },
      evidence,
    });
    const terminal = decision.recoveryState === 'RECOVERABLE' || decision.recoveryState === 'SAFE_RETRY'
      ? 'KNOWN_SAFE' : 'HUMAN_REVIEW';
    return {
      result: ok('recover', {
        subsystem: 'veyline',
        disposition: `Recovery decision for ${operationId}: ${decision.recoveryState} -> ${terminal}. Read-only: nothing charged, nothing executed.`,
        data: { operationId, decision, terminal },
      }),
      exitCode: EXIT.OK,
    };
  } catch (err) {
    const isMalformed = err instanceof SyntaxError;
    return { result: fail('recover', { subsystem: 'veyline', code: isMalformed ? 'usage' : 'failed', message: err.message }), exitCode: isMalformed ? EXIT.USAGE : EXIT.FAIL };
  }
}

module.exports = { actEvidence, actExplain, actRecover, veylineRoot, loadVeyline };
