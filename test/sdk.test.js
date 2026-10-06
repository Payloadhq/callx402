'use strict';

/**
 * SDK surface tests.
 *
 * - JS SDK: in-process callx402({intent}) returns the full SPEC §4 envelope;
 *   version/status/sub-actions exist; invalid opts throw TypeError.
 * - Python SDK: callx402(...) returns a dict via the REAL CLI subprocess.
 *   Skips gracefully with a clear message when node is missing (it is not,
 *   here) or when the package cannot be imported.
 */

const { test } = require('node:test');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { ENVELOPE_KEYS, scratchDir, withEnv } = require('./helpers');

const scratch = scratchDir('sdk');
const hermetic = {
  CALLX402_CONFIG: path.join(scratch, 'config.json'),
  CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'idempotency.jsonl'),
};

const sdk = require('../sdk/js/index.js');

test('JS SDK: callx402({intent}) returns a full envelope (in-process)', async (t) => {
  await withEnv(hermetic, async () => {
    const result = await sdk({
      intent: 'summarize this for under 1 dollar',
      maxBudget: 1.0,
      speed: 'balanced',
      risk: 'low',
      networks: ['base'],
      assets: ['USDC'],
      timeoutMs: 10000,
      dryRun: true,
    });
    for (const k of ENVELOPE_KEYS) {
      t.assert.ok(Object.prototype.hasOwnProperty.call(result, k), `envelope missing key '${k}'`);
    }
    t.assert.strictEqual(result.action, 'execute');
    t.assert.strictEqual(result.ok, true);
    t.assert.strictEqual(result.error, null);
    t.assert.ok(Array.isArray(result.data.stages));
  });
});

test('JS SDK: version, status(), and sub-actions', async (t) => {
  await withEnv(hermetic, async () => {
    t.assert.strictEqual(sdk.version, '0.1.0');
    t.assert.strictEqual(require('../sdk/js/index.js').callx402.version, '0.1.0');

    const st = await sdk.status();
    t.assert.strictEqual(st.action, 'status');
    t.assert.strictEqual(st.ok, true);
    t.assert.strictEqual(Object.keys(st.data.subsystems).length, 15);

    for (const name of ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'preflight', 'inspect']) {
      t.assert.strictEqual(typeof sdk[name], 'function', `sdk.${name} exists`);
    }
    const d = await sdk.diagnose({});
    t.assert.strictEqual(d.action, 'diagnose');
    t.assert.strictEqual(d.ok, false); // doctor disabled without the flag
    t.assert.strictEqual(d.error.code, 'subsystem_disabled');
  });
});

test('JS SDK: invalid opts throw TypeError (fail fast, no dispatch)', async (t) => {
  await withEnv(hermetic, async () => {
    await t.assert.rejects(sdk({}), TypeError);
    await t.assert.rejects(sdk({ intent: 'x', speed: 'warp' }), TypeError);
    await t.assert.rejects(sdk({ intent: 'x', maxBudget: -1 }), TypeError);
    await t.assert.rejects(sdk({ action: 'frobnicate', intent: 'x' }), TypeError);
  });
});

test('JS SDK: action dispatch through runAction', async (t) => {
  await withEnv(hermetic, async () => {
    const r = await sdk({ action: 'resolve', args: { evidence: '{}' } });
    // Settlement subsystem disabled without its flag: honest failure.
    t.assert.strictEqual(r.action, 'resolve');
    t.assert.strictEqual(r.ok, false);
    t.assert.strictEqual(r.error.code, 'subsystem_disabled');
  });
});

/* ---------------- Python SDK (real CLI via subprocess) ---------------- */

function pythonAvailable() {
  return new Promise((resolve) => {
    execFile('python3', ['--version'], (err) => resolve(!err));
  });
}

function nodeAvailable() {
  return new Promise((resolve) => {
    execFile('node', ['--version'], (err) => resolve(!err));
  });
}

function runPython(script, env) {
  return new Promise((resolve) => {
    execFile('python3', ['-c', script], { env, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

const PY_ENV = () => ({
  ...process.env,
  CALLX402_CONFIG: path.join(scratch, 'py-config.json'),
  CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'py-idempotency.jsonl'),
  CALLX402_MODE: 'local',
});

test('Python SDK: callx402(...) returns an envelope dict via the real CLI', async (t) => {
  if (!(await pythonAvailable())) {
    t.skip('python3 not available');
    return;
  }
  if (!(await nodeAvailable())) {
    t.skip('callx402 Python SDK requires Node.js (>= 18) to run the bundled CLI, but no `node` binary was found on PATH');
    return;
  }
  const script = `
import json
try:
    import callx402
except ImportError as e:
    print("IMPORT_FAILED:" + str(e))
    raise SystemExit(3)
r = callx402.callx402(intent="summarize this for under 1 dollar", max_budget=1.0, dry_run=True)
assert isinstance(r, dict), type(r)
for k in ["ok","action","disposition","subsystem","subsystemStatus","data","settlement","txHash","receipt","idempotencyKey","deduped","error"]:
    assert k in r, "missing key " + k
assert r["action"] == "execute" and r["ok"] is True, r
print("PYSDK_OK")
`;
  const r = await runPython(script, PY_ENV());
  if (/IMPORT_FAILED/.test(r.stdout)) {
    t.skip('callx402 Python package is not importable: ' + r.stdout.trim());
    return;
  }
  t.assert.strictEqual(r.code, 0, `python stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  t.assert.match(r.stdout, /PYSDK_OK/);
});

test('Python SDK: transport failures raise Callx402Error with the envelope', async (t) => {
  if (!(await pythonAvailable()) || !(await nodeAvailable())) {
    t.skip('python3/node not available');
    return;
  }
  const script = `
try:
    import callx402
except ImportError as e:
    print("IMPORT_FAILED:" + str(e))
    raise SystemExit(3)
try:
    callx402.callx402(action="frobnicate")
    print("NO_RAISE")
except callx402.Callx402Error as e:
    assert e.exit_code == 2, e.exit_code
    print("RAISED_OK")
`;
  const r = await runPython(script, PY_ENV());
  if (/IMPORT_FAILED/.test(r.stdout)) {
    t.skip('callx402 Python package is not importable');
    return;
  }
  t.assert.strictEqual(r.code, 0, `stderr: ${r.stderr}`);
  t.assert.match(r.stdout, /RAISED_OK/);
});

test('Python SDK: validation errors raise TypeError before dispatch', async (t) => {
  if (!(await pythonAvailable()) || !(await nodeAvailable())) {
    t.skip('python3/node not available');
    return;
  }
  const script = `
try:
    import callx402
except ImportError as e:
    print("IMPORT_FAILED:" + str(e))
    raise SystemExit(3)
try:
    callx402.callx402(intent="x", speed="warp")
    print("NO_RAISE")
except TypeError:
    print("TYPEERROR_OK")
`;
  const r = await runPython(script, PY_ENV());
  if (/IMPORT_FAILED/.test(r.stdout)) {
    t.skip('callx402 Python package is not importable');
    return;
  }
  t.assert.match(r.stdout, /TYPEERROR_OK/);
});
