'use strict';

/**
 * core/subsystems.js — lazy require map of the v2.0.0 tree.
 *
 * HARD RULE: callx402 only require()s from the v2.0.0 tree; it never writes
 * anything under it. All requires are lazy (inside getSubsystem) so `status`
 * can report per-module reachability even when a module is missing.
 *
 * v2Root default: path.resolve(__dirname, '../../x402-paid-api-starter-kit/v2.0.0')
 * Overridable via CALLX402_V2_ROOT env or config `v2Root`.
 */

const path = require('path');

const MODULE_FILES = {
  sentinel: 'lib/sentinel/index.js',
  rescue: 'lib/rescue/index.js',
  doctor: 'lib/mcp/doctor.js',
  router: ['lib/mcp/smart-router.js', 'lib/mcp/route-decider.js'], // merged
  spendguard: 'lib/mcp/spendguard.js',
  settlement: 'lib/settlement-resolver.js',
  intent: 'lib/mcp/intent-engine.js',
  capabilities: 'lib/mcp/capability-graph.js',
  planner: 'lib/mcp/economic-planner.js',
  fabric: 'lib/mcp/index.js',
  revrule: 'lib/revrule-events.js',
  preflight: 'lib/mcp/preflight.js',
  effectproof: 'lib/mcp/effect-proof.js',
  kernel: 'lib/mcp/execution-kernel.js',
  recovery: 'lib/mcp/result-recovery.js',
};

const SUBSYSTEMS = Object.keys(MODULE_FILES);

// Honest per-subsystem notes gathered from source inspection (2026-10-06).
const NOTES = {
  sentinel: 'createSentinel() returns an inert sentinel unless PAYLOAD_SENTINEL=1.',
  rescue: 'Dispatch uses the real lib/rescue/index.js (fail-closed guard, receipts). The sibling lib/rescue-service/_rescue-stub.js is a documented LOCAL STAND-IN for the standalone rescue service and is never dispatched by callx402.',
  doctor: 'runMcpDoctor(evidence) evaluates stages deterministically from supplied evidence only.',
  router: 'selectTool/choosePath rank candidates; no live tool execution happens here.',
  spendguard: 'createTaskSpendGuard budget checks; refusal is zero-side-effect.',
  settlement: 'resolve(evidence) is read-only analysis; never retries or repays.',
  intent: 'parse() is pure text analysis; asserts PAYLOAD_MCP_FABRIC=1.',
  capabilities: 'Experimental: createGraph() throws unless PAYLOAD_MCP_FABRIC=1.',
  planner: 'planGoal() asserts PAYLOAD_MCP_PLANNER=1.',
  fabric: 'transactional/saga/executionKernel primitives; live execution needs enabled kernel + a real executable route.',
  revrule: 'Emission to a memory sink unless PAYLOAD_REVRULE_EVENTS=1; idempotent via registry.',
  preflight: 'runMcpPreflight runs deterministic checks on supplied context.',
  effectproof: 'Effect proofs verify execution evidence; none issued without execution.',
  kernel: 'createKernel guards state transitions; no live kernel without PAYLOAD_MCP_EXECUTION_KERNEL=1.',
  recovery: 'File-backed idempotency store used for duplicate-idempotencyKey dedupe.',
};

function defaultV2Root() {
  return path.resolve(__dirname, '../../x402-paid-api-starter-kit/v2.0.0');
}

function getV2Root(config = {}) {
  return config.v2Root || process.env.CALLX402_V2_ROOT || defaultV2Root();
}

function requireFiles(v2Root, files) {
  const list = Array.isArray(files) ? files : [files];
  let merged = {};
  for (const rel of list) {
    const mod = require(path.join(v2Root, rel));
    merged = { ...merged, ...mod };
  }
  return merged;
}

/**
 * getSubsystem(name, { config, deps }) -> handle
 *   { name, reachable, module, enabled, flag, version, note, subsystemStatus, error }
 *
 * `deps` is the internal/test seam: deps[name] replaces the real module and is
 * reported as reachable+enabled with flag '(test override)'.
 */
function getSubsystem(name, { config = {}, deps = {} } = {}) {
  if (!SUBSYSTEMS.includes(name)) {
    return { name, reachable: false, module: null, enabled: false, flag: null, version: null, note: `unknown subsystem '${name}'`, subsystemStatus: 'unreachable', error: `unknown subsystem '${name}'` };
  }

  if (deps && deps[name] !== undefined && deps[name] !== null) {
    const override = deps[name];
    return {
      name, reachable: true, module: override, enabled: true,
      flag: '(test override)',
      version: (override && override.version) || null,
      note: 'internal/test override via deps seam',
      subsystemStatus: 'ok', error: null,
    };
  }

  const v2Root = getV2Root(config);
  let mod = null;
  try {
    mod = requireFiles(v2Root, MODULE_FILES[name]);
  } catch (err) {
    return { name, reachable: false, module: null, enabled: false, flag: null, version: null, note: NOTES[name] || null, subsystemStatus: 'unreachable', error: `require failed: ${err.message}` };
  }

  let flag = null;
  let enabled = false;
  try {
    flag = typeof mod.FLAG === 'string' ? mod.FLAG : null;
    enabled = typeof mod.enabled === 'function' ? mod.enabled() : false;
  } catch (err) {
    return { name, reachable: true, module: mod, enabled: false, flag, version: null, note: NOTES[name] || null, subsystemStatus: 'disabled', error: `enabled() check failed: ${err.message}` };
  }

  const version = mod.version || mod.RESCUE_VERSION || mod.EFFECT_PROOF_VERSION || null;
  const subsystemStatus = enabled ? 'ok' : 'disabled';
  return { name, reachable: true, module: mod, enabled, flag, version, note: NOTES[name] || null, subsystemStatus, error: null };
}

/** Per-subsystem reachability/enabled/version report for `status`. */
function getStatus({ config = {}, deps = {} } = {}) {
  const out = {};
  for (const name of SUBSYSTEMS) {
    const h = getSubsystem(name, { config, deps });
    out[name] = {
      reachable: h.reachable,
      enabled: h.enabled,
      flag: h.flag,
      version: h.version,
      note: h.note,
      subsystemStatus: h.subsystemStatus,
      ...(h.error ? { error: h.error } : {}),
    };
  }
  return out;
}

module.exports = { SUBSYSTEMS, MODULE_FILES, NOTES, getV2Root, defaultV2Root, getSubsystem, getStatus };
