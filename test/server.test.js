'use strict';

/**
 * HTTP server tests (in-process, ephemeral port, node:http only).
 *
 * - GET /health -> 200 with subsystem map.
 * - GET /openapi.json -> 200 OpenAPI document.
 * - POST /call (dryRun) -> 200 envelope.
 * - Malformed JSON -> 400; unknown route -> 404.
 * - Disabled subsystem over HTTP -> 503 (honest, not faked).
 * - Auth: with CALLX402_AUTH_TOKEN, missing/wrong bearer -> 401.
 */

const { test } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const { createServer } = require('../server/index.js');
const { ENVELOPE_KEYS, scratchDir, withEnv, needsV2Tree } = require('./helpers');
// The in-process server's core reads the parent env: keep the idempotency
// store hermetic for the whole file (each test file is its own process).
const serverScratch = scratchDir('server');
process.env.CALLX402_IDEMPOTENCY_FILE = path.join(serverScratch, 'idempotency.jsonl');
process.env.CALLX402_CONFIG = path.join(serverScratch, 'config.json');

function startServer(opts = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(opts);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function request(port, method, route, { body = undefined, rawBody = undefined, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : null);
    const req = http.request(
      { host: '127.0.0.1', port, path: route, method, headers: { ...(data !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (_) { /* leave null */ }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on('error', reject);
    if (data !== null) req.end(data);
    else req.end();
  });
}

function assertEnvelopeShape(t, env, action) {
  for (const k of ENVELOPE_KEYS) {
    t.assert.ok(Object.prototype.hasOwnProperty.call(env, k), `envelope missing key '${k}'`);
  }
  if (action !== undefined) t.assert.strictEqual(env.action, action);
}

test('GET /health -> 200 with version and subsystem map', needsV2Tree, async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'GET', '/health');
    t.assert.strictEqual(r.status, 200);
    t.assert.strictEqual(r.json.ok, true);
    t.assert.strictEqual(r.json.version, '1.0.0');
    t.assert.strictEqual(Object.keys(r.json.subsystems).length, 15);
    t.assert.strictEqual(r.json.subsystems.doctor.flag, 'PAYLOAD_MCP_DOCTOR');
  } finally {
    server.close();
  }
});

test('GET /openapi.json -> 200 OpenAPI document', async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'GET', '/openapi.json');
    t.assert.strictEqual(r.status, 200);
    t.assert.strictEqual(r.json.openapi, '3.0.0');
    t.assert.ok(r.json.paths && typeof r.json.paths === 'object');
    t.assert.ok(r.json.paths['/call'], 'documents POST /call');
  } finally {
    server.close();
  }
});

test('POST /call dryRun -> 200 with full envelope', async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'POST', '/call', {
      body: { intent: 'summarize this for under 1 dollar', maxBudget: 1, dryRun: true },
    });
    t.assert.strictEqual(r.status, 200);
    assertEnvelopeShape(t, r.json, 'execute');
    t.assert.strictEqual(r.json.ok, true);
    t.assert.match(r.json.disposition, /Dry run/);
  } finally {
    server.close();
  }
});

test('POST /call with malformed JSON -> 400', async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'POST', '/call', { rawBody: '{not json' });
    t.assert.strictEqual(r.status, 400);
    t.assert.strictEqual(r.json.error.code, 'bad_request');
  } finally {
    server.close();
  }
});

test('POST /call without intent -> 400 validation error', async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'POST', '/call', { body: {} });
    t.assert.strictEqual(r.status, 400);
    t.assert.strictEqual(r.json.error.code, 'validation_error');
  } finally {
    server.close();
  }
});

test('unknown route -> 404', async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'GET', '/nope');
    t.assert.strictEqual(r.status, 404);
    t.assert.strictEqual(r.json.error.code, 'not_found');
  } finally {
    server.close();
  }
});

test('disabled subsystem over HTTP -> 503, honest envelope', needsV2Tree, async (t) => {
  const { server, port } = await startServer();
  try {
    const r = await request(port, 'POST', '/resolve', { body: { evidence: {} } });
    t.assert.strictEqual(r.status, 503);
    assertEnvelopeShape(t, r.json, 'resolve');
    t.assert.strictEqual(r.json.error.code, 'subsystem_disabled');
    t.assert.strictEqual(r.json.subsystemStatus, 'disabled');
  } finally {
    server.close();
  }
});

test('settlement UNKNOWN over HTTP -> 409 with fail-closed envelope', needsV2Tree, async (t) => {
  await withEnv({ PAYLOAD_SETTLEMENT_RESOLVER: '1' }, async () => {
    const { server, port } = await startServer();
    try {
      const r = await request(port, 'POST', '/resolve', { body: { evidence: {} } });
      t.assert.strictEqual(r.status, 409);
      t.assert.strictEqual(r.json.settlement, 'UNKNOWN');
      t.assert.strictEqual(r.json.error.code, 'settlement_unknown');
    } finally {
      server.close();
    }
  });
});

test('auth: missing/wrong bearer -> 401; correct bearer -> through', async (t) => {
  const { server, port } = await startServer({ authToken: 's3cret-token' });
  try {
    const noAuth = await request(port, 'POST', '/call', { body: { intent: 'x', dryRun: true } });
    t.assert.strictEqual(noAuth.status, 401);
    t.assert.strictEqual(noAuth.json.error.code, 'unauthorized');

    const wrong = await request(port, 'POST', '/call', {
      body: { intent: 'x', dryRun: true },
      headers: { authorization: 'Bearer wrong' },
    });
    t.assert.strictEqual(wrong.status, 401);

    const right = await request(port, 'POST', '/call', {
      body: { intent: 'summarize this for under 1 dollar', maxBudget: 1, dryRun: true },
      headers: { authorization: 'Bearer s3cret-token' },
    });
    t.assert.strictEqual(right.status, 200);
    t.assert.strictEqual(right.json.ok, true);

    // GET /health stays public even when POST routes require auth.
    const health = await request(port, 'GET', '/health');
    t.assert.strictEqual(health.status, 200);
  } finally {
    server.close();
  }
});
