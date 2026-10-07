'use strict';

/**
 * callx402 JS SDK — universal action layer over the x402 subsystems.
 *
 * Same-process dispatch: requires ../../core (core/index.js) and calls
 * runIntent / runAction directly. No subprocess, no logic duplication.
 *
 * Result is always the SPEC §4 envelope; subsystem errors are propagated
 * as { ok: false, error: {...} } envelopes — never swallowed, never retried.
 */

const VERSION = '1.0.0';

const KNOWN_ACTIONS = [
  'diagnose', 'rescue', 'route', 'resolve', 'doctor',
  'execute', 'monitor', 'preflight', 'inspect', 'status', 'config',
];

const SPEEDS = ['fast', 'balanced', 'cheap'];
const RISKS = ['low', 'medium', 'high'];

let _core = null;
function core() {
  if (!_core) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      _core = require('../../core');
    } catch (err) {
      throw new Error(
        `callx402: failed to load core dispatcher (../../core): ${err.message}`
      );
    }
  }
  return _core;
}

function typeError(msg) {
  return new TypeError(`callx402: ${msg}`);
}

function assertString(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw typeError(`opts.${name} must be a non-empty string`);
  }
}

function assertOptionalString(value, name) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw typeError(`opts.${name} must be a string`);
  }
}

function assertNonNegativeNumber(value, name) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw typeError(`opts.${name} must be a non-negative finite number`);
  }
}

function assertStringArray(value, name) {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || v.length === 0)
  ) {
    throw typeError(`opts.${name} must be an array of non-empty strings`);
  }
}

function assertPositiveInt(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw typeError(`opts.${name} must be a positive integer (milliseconds)`);
  }
}

/**
 * Validate the shared option bag. Throws TypeError on invalid input.
 * Returns a normalized opts object passed straight through to the core.
 */
function validateOpts(opts) {
  if (opts === undefined || opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw typeError('opts must be an object');
  }

  const out = { ...opts };

  if (out.action !== undefined && out.action !== null) {
    assertString(out.action, 'action');
    if (!KNOWN_ACTIONS.includes(out.action)) {
      throw typeError(
        `opts.action must be one of: ${KNOWN_ACTIONS.join(', ')} (got "${out.action}")`
      );
    }
  } else {
    assertString(out.intent, 'intent');
  }

  if (out.maxBudget !== undefined && out.maxBudget !== null) {
    assertNonNegativeNumber(out.maxBudget, 'maxBudget');
  }
  if (out.approvalThreshold !== undefined && out.approvalThreshold !== null) {
    assertNonNegativeNumber(out.approvalThreshold, 'approvalThreshold');
  }
  if (out.timeoutMs !== undefined && out.timeoutMs !== null) {
    assertPositiveInt(out.timeoutMs, 'timeoutMs');
  }
  if (out.deadline !== undefined && out.deadline !== null) {
    assertOptionalString(out.deadline, 'deadline');
  }
  if (out.idempotencyKey !== undefined && out.idempotencyKey !== null) {
    assertOptionalString(out.idempotencyKey, 'idempotencyKey');
  }
  if (out.speed !== undefined && out.speed !== null) {
    if (!SPEEDS.includes(out.speed)) {
      throw typeError(`opts.speed must be one of: ${SPEEDS.join(', ')} (got "${out.speed}")`);
    }
  }
  if (out.risk !== undefined && out.risk !== null) {
    if (!RISKS.includes(out.risk)) {
      throw typeError(`opts.risk must be one of: ${RISKS.join(', ')} (got "${out.risk}")`);
    }
  }
  if (out.networks !== undefined && out.networks !== null) {
    assertStringArray(out.networks, 'networks');
  }
  if (out.assets !== undefined && out.assets !== null) {
    assertStringArray(out.assets, 'assets');
  }
  if (out.providers !== undefined && out.providers !== null) {
    assertStringArray(out.providers, 'providers');
  }
  if (out.dryRun !== undefined && out.dryRun !== null && typeof out.dryRun !== 'boolean') {
    throw typeError('opts.dryRun must be a boolean');
  }

  return out;
}

/**
 * Unwrap the core's { result, exitCode } carrier to the SPEC §4 envelope.
 * The envelope (ok:false included) is returned as-is — never swallowed,
 * never retried. Money-safety: budget refusals and settlement UNKNOWN
 * surface exactly as the core reports them.
 */
function unwrap(out, what) {
  if (out && typeof out === 'object' && 'result' in out) return out.result;
  throw new Error(
    `callx402: core ${what} returned an unexpected shape (expected { result, exitCode })`
  );
}

/**
 * Primary entry point.
 *
 *   const { callx402 } = require('callx402');
 *   const result = await callx402({ intent: 'complete this job for under $1', maxBudget: 1.00 });
 *
 * Returns the SPEC §4 result envelope. Envelopes with ok:false are returned
 * (not thrown) so budget refusals, settlement UNKNOWN, disabled subsystems,
 * etc. surface exactly as the core reports them.
 */
async function callx402(opts) {
  const o = validateOpts(opts);
  const c = core();
  if (o.action) {
    const { action, ...rest } = o;
    const args = rest.args && typeof rest.args === 'object' ? rest.args : {};
    return unwrap(await c.runAction(action, args, rest), `runAction('${action}')`);
  }
  return unwrap(await c.runIntent(o.intent, o), 'runIntent');
}

/**
 * Build a named sub-action delegating to core.runAction.
 */
function makeAction(name) {
  const fn = async (args = {}, opts = {}) => {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      throw typeError(`${name}(): args must be an object`);
    }
    if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
      throw typeError(`${name}(): opts must be an object`);
    }
    return unwrap(await core().runAction(name, args, opts), `runAction('${name}')`);
  };
  return fn;
}

callx402.version = VERSION;
callx402.diagnose = makeAction('diagnose');
callx402.rescue = makeAction('rescue');
callx402.route = makeAction('route');
callx402.resolve = makeAction('resolve');
callx402.doctor = makeAction('doctor');
callx402.execute = makeAction('execute');
callx402.monitor = makeAction('monitor');
callx402.preflight = makeAction('preflight');
callx402.inspect = makeAction('inspect');
callx402.status = makeAction('status');

module.exports = callx402;
module.exports.callx402 = callx402;
module.exports.version = VERSION;
module.exports.default = callx402;
