'use strict';

/**
 * test/helpers.js — shared test utilities (not a test file itself).
 *
 * runCLI: spawn the real bin/callx402.js as a subprocess with a hermetic env.
 * Every CLI test gets an isolated CALLX402_CONFIG file and an isolated
 * CALLX402_IDEMPOTENCY_FILE so tests never touch the operator's real config
 * or idempotency store.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'callx402.js');
const V2_ROOT = path.resolve(ROOT, '..', 'x402-paid-api-starter-kit', 'v2.0.0');

// SPEC §4 envelope keys — every dispatch surface must return all of these.
const ENVELOPE_KEYS = [
  'ok', 'action', 'disposition', 'subsystem', 'subsystemStatus', 'data',
  'settlement', 'txHash', 'receipt', 'idempotencyKey', 'deduped', 'error',
];

/** Create an isolated scratch dir for one test file's subprocess env. */
function scratchDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `callx402-test-${tag}-`));
  return dir;
}

/**
 * Build a hermetic env for CLI subprocesses.
 * extra: additional env vars (e.g. { PAYLOAD_MCP_DOCTOR: '1' }).
 */
function cliEnv(scratch, extra = {}) {
  return {
    ...process.env,
    CALLX402_CONFIG: path.join(scratch, 'config.json'),
    CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'idempotency.jsonl'),
    // Hermetic default: local mode unless the test explicitly asks for remote.
    CALLX402_MODE: 'local',
    ...extra,
  };
}

/**
 * Run the real CLI. Returns { code, stdout, stderr, json }.
 * json is the parsed stdout when --json was passed and stdout parses.
 */
function runCLI(args, env) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      let json = null;
      const out = (stdout || '').trim();
      if (out.startsWith('{')) {
        try { json = JSON.parse(out); } catch (_) { /* leave null */ }
      }
      resolve({
        code: err && typeof err.code === 'number' ? err.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        json,
      });
    });
  });
}

/** Assert the value is a full SPEC §4 envelope for the expected action. */
function assertEnvelope(t, env, expectedAction) {
  t.assert.ok(env && typeof env === 'object', 'expected a JSON envelope object');
  for (const k of ENVELOPE_KEYS) {
    t.assert.ok(Object.prototype.hasOwnProperty.call(env, k), `envelope missing key '${k}'`);
  }
  if (expectedAction !== undefined) {
    t.assert.strictEqual(env.action, expectedAction, `envelope action should be '${expectedAction}'`);
  }
  t.assert.strictEqual(typeof env.ok, 'boolean', 'envelope.ok must be boolean');
  t.assert.strictEqual(typeof env.deduped, 'boolean', 'envelope.deduped must be boolean');
  if (env.ok) t.assert.strictEqual(env.error, null, 'ok envelope must have null error');
  else t.assert.ok(env.error && typeof env.error.code === 'string', 'failed envelope must carry error.code');
}

/** Temporarily set env vars, run fn, then restore. */
async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

module.exports = { ROOT, CLI, V2_ROOT, ENVELOPE_KEYS, scratchDir, cliEnv, runCLI, assertEnvelope, withEnv };
