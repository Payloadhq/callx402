'use strict';

/**
 * Remote-mode tests (SPEC §5).
 *
 * - Unreachable remote -> clear 'unreachable' error, non-zero exit.
 * - Remote mode without a URL -> usage error.
 * - Actions without a server route fail closed in remote mode.
 * - Positive path: real server on an ephemeral port, CLI + in-process
 *   runAction/runIntent round-trip through it, incl. bearer auth.
 */

const { test } = require('node:test');
const path = require('node:path');
const { runAction, runIntent } = require('../core/index.js');
const { createServer } = require('../server/index.js');
const { scratchDir, cliEnv, runCLI, assertEnvelope, withEnv, needsV2Tree } = require('./helpers');
const scratch = scratchDir('remote');

/** Start a real callx402 server on an ephemeral port. */
function startServer(opts = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(opts);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function remoteEnv(url, extra = {}) {
  return cliEnv(scratch, { CALLX402_MODE: 'remote', CALLX402_REMOTE_URL: url, ...extra });
}

test('remote unreachable -> clear unreachable error, exit 3', async (t) => {
  const r = await runCLI(
    ['execute', '--intent', 'do the thing', '--max-budget', '1', '--timeout', '2000', '--json'],
    remoteEnv('http://127.0.0.1:1')
  );
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'execute');
  t.assert.strictEqual(r.json.ok, false);
  t.assert.strictEqual(r.json.error.code, 'remote_unreachable');
  t.assert.match(r.json.error.message, /unreachable/);
  t.assert.match(r.json.error.message, /http:\/\/127\.0\.0\.1:1/);
  t.assert.match(r.json.error.message, /CALLX402_MODE=local/);
});

test('remote mode without a URL -> usage error, exit 2', async (t) => {
  const r = await runCLI(['status', '--json'], cliEnv(scratch, { CALLX402_MODE: 'remote' }));
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'status');
  t.assert.strictEqual(r.json.error.code, 'usage');
  t.assert.match(r.json.error.message, /CALLX402_REMOTE_URL/);
});

test('remote mode: actions without a server route fail closed, exit 2', async (t) => {
  const r = await runCLI(['monitor', '--json'], remoteEnv('http://127.0.0.1:1'));
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'monitor');
  t.assert.strictEqual(r.json.error.code, 'usage');
  t.assert.match(r.json.error.message, /no server route exists/);
});

test('remote mode: malformed evidence fails locally before any network call', async (t) => {
  const r = await runCLI(
    ['resolve', '--evidence', '{bad', '--json'],
    remoteEnv('http://127.0.0.1:1')
  );
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'resolve');
  t.assert.match(r.json.error.message, /malformed evidence JSON/);
});

test('remote positive: CLI status + execute round-trip through a real server', async (t) => {
  const { server, port } = await startServer();
  try {
    const env = remoteEnv(`http://127.0.0.1:${port}`);

    const st = await runCLI(['status', '--json'], env);
    t.assert.strictEqual(st.code, 0);
    assertEnvelope(t, st.json, 'status');
    t.assert.strictEqual(st.json.ok, true);
    t.assert.strictEqual(st.json.data.version, '1.0.0');
    t.assert.strictEqual(Object.keys(st.json.data.subsystems).length, 15);

    const ex = await runCLI(
      ['execute', '--intent', 'do the thing for under 1 dollar', '--max-budget', '1', '--dry-run', '--json'],
      env
    );
    t.assert.strictEqual(ex.code, 0);
    assertEnvelope(t, ex.json, 'execute');
    t.assert.match(ex.json.disposition, /Dry run/);
  } finally {
    server.close();
  }
});

test('remote positive: in-process runAction/runIntent honor mode=remote', async (t) => {
  const { server, port } = await startServer();
  try {
    const config = { mode: 'remote', remoteUrl: `http://127.0.0.1:${port}` };
    await withEnv(
      {
        CALLX402_CONFIG: path.join(scratch, 'remote-cfg.json'),
        CALLX402_IDEMPOTENCY_FILE: path.join(scratch, 'remote-idem.jsonl'),
      },
      async () => {
        const st = await runAction('status', {}, { config, timeoutMs: 5000 });
        t.assert.strictEqual(st.exitCode, 0);
        assertEnvelope(t, st.result, 'status');

        const ex = await runIntent('do the thing for under 1 dollar', { maxBudget: 1, dryRun: true, timeoutMs: 5000 }, { config });
        t.assert.strictEqual(ex.exitCode, 0);
        assertEnvelope(t, ex.result, 'execute');
      }
    );
  } finally {
    server.close();
  }
});

test('remote auth: server with token rejects missing/wrong bearer, accepts the right one', async (t) => {
  const { server, port } = await startServer({ authToken: 's3cret-token' });
  try {
    const url = `http://127.0.0.1:${port}`;

    const noAuth = await runCLI(['execute', '--intent', 'x', '--dry-run', '--json'], remoteEnv(url));
    t.assert.notStrictEqual(noAuth.code, 0);
    t.assert.strictEqual(noAuth.json.error.code, 'unauthorized');

    const wrong = await runCLI(
      ['execute', '--intent', 'x', '--dry-run', '--json'],
      remoteEnv(url, { CALLX402_AUTH_TOKEN: 'wrong' })
    );
    t.assert.notStrictEqual(wrong.code, 0);
    t.assert.strictEqual(wrong.json.error.code, 'unauthorized');

    const right = await runCLI(
      ['execute', '--intent', 'do the thing for under 1 dollar', '--max-budget', '1', '--dry-run', '--json'],
      remoteEnv(url, { CALLX402_AUTH_TOKEN: 's3cret-token' })
    );
    t.assert.strictEqual(right.code, 0);
    assertEnvelope(t, right.json, 'execute');
  } finally {
    server.close();
  }
});

test('remote money-safety: settlement UNKNOWN envelope crosses the wire unchanged (exit 5)', needsV2Tree, async (t) => {
  // The server runs in-process, so the subsystem flag belongs to the parent
  // env; the CLI subprocess only carries the remote-mode config.
  await withEnv({ PAYLOAD_SETTLEMENT_RESOLVER: '1' }, async () => {
    const { server, port } = await startServer();
    try {
      const r = await runCLI(['resolve', '--evidence', '{}', '--json'], remoteEnv(`http://127.0.0.1:${port}`));
      t.assert.strictEqual(r.code, 5, 'remote settlement UNKNOWN still exits 5');
      assertEnvelope(t, r.json, 'resolve');
      t.assert.strictEqual(r.json.settlement, 'UNKNOWN');
      t.assert.strictEqual(r.json.error.code, 'settlement_unknown');
    } finally {
      server.close();
    }
  });
});
