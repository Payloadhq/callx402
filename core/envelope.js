'use strict';

/**
 * core/envelope.js — result envelope builders + CLI exit codes.
 *
 * Every dispatch (CLI, SDKs, HTTP) returns the envelope shape from SPEC section 4.
 * `error` is null on success; ok:false whenever error is set.
 */

const EXIT = {
  OK: 0,               // ok
  FAIL: 1,             // generic failure
  USAGE: 2,            // usage/validation error
  UNAVAILABLE: 3,      // subsystem disabled or unreachable
  BUDGET_REFUSED: 4,   // SpendGuard budget refusal
  SETTLEMENT_UNKNOWN: 5, // settlement UNKNOWN: never auto-retry, never repay
};

const VALID_STATUSES = new Set(['ok', 'disabled', 'unreachable', 'prototype']);

function envelope(partial = {}) {
  const env = {
    ok: partial.ok === true,
    action: partial.action ?? null,
    disposition: partial.disposition ?? null,
    subsystem: partial.subsystem ?? null,
    subsystemStatus: partial.subsystemStatus ?? null,
    data: partial.data ?? {},
    settlement: partial.settlement ?? null,
    txHash: partial.txHash ?? null,
    receipt: partial.receipt ?? {},
    idempotencyKey: partial.idempotencyKey ?? null,
    deduped: partial.deduped === true,
    error: partial.error ?? null,
  };
  if (env.subsystemStatus && !VALID_STATUSES.has(env.subsystemStatus)) {
    env.subsystemStatus = null;
  }
  // Invariant: ok:false whenever error is set; ok:true implies error null.
  if (env.error) env.ok = false;
  if (env.ok) env.error = null;
  return env;
}

function ok(action, { subsystem = null, subsystemStatus = 'ok', disposition = null, data = {}, settlement = null, txHash = null, receipt = {}, idempotencyKey = null, deduped = false } = {}) {
  return envelope({ ok: true, action, subsystem, subsystemStatus, disposition, data, settlement, txHash, receipt, idempotencyKey, deduped, error: null });
}

function fail(action, { subsystem = null, subsystemStatus = null, code = 'failed', message = 'failed', disposition = null, data = {}, settlement = null, idempotencyKey = null, deduped = false } = {}) {
  return envelope({ ok: false, action, subsystem, subsystemStatus, disposition, data, settlement, idempotencyKey, deduped, error: { code, message } });
}

/** Map an envelope to a CLI exit code (budget/settlement refusals are explicit). */
function exitCodeFor(result) {
  if (!result) return EXIT.FAIL;
  if (result.ok) return EXIT.OK;
  const code = result.error && result.error.code;
  switch (code) {
    case 'usage':
    case 'validation':
    case 'unknown_action':
      return EXIT.USAGE;
    case 'subsystem_disabled':
    case 'subsystem_unreachable':
    case 'auth_required':
    case 'no_executable_route':
    case 'remote_unreachable':
      return EXIT.UNAVAILABLE;
    case 'budget_refused':
    case 'approval_required':
      return EXIT.BUDGET_REFUSED;
    case 'settlement_unknown':
    case 'unsafe_retry_refused':
      return EXIT.SETTLEMENT_UNKNOWN;
    default:
      return EXIT.FAIL;
  }
}

module.exports = { EXIT, VALID_STATUSES, envelope, ok, fail, exitCodeFor };
