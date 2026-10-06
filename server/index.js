#!/usr/bin/env node
'use strict';
/**
 * callx402 HTTP server — node:http ONLY, zero dependencies.
 *
 * Routes:
 *   GET  /health        -> {ok, version, subsystems} from core getStatus()
 *   GET  /openapi.json  -> server/openapi.yaml converted to JSON at startup
 *   GET  /openapi.yaml  -> raw server/openapi.yaml text (convenience)
 *   POST /call          -> core runIntent(intent, opts)
 *   POST /rescue        -> core runAction('rescue', args)
 *   POST /route         -> core runAction('route', args)
 *   POST /resolve       -> core runAction('resolve', args)
 *   POST /diagnose      -> core runAction('diagnose', args)
 *
 * Auth: if CALLX402_AUTH_TOKEN is set, all POST routes require
 *   Authorization: Bearer <token>, else 401. If unset, POST routes are open
 *   (production deployments should set it).
 *
 * Core resolution: require(process.env.CALLX402_CORE_PATH || <dir>/../core).
 * The core must export runAction(name, args), runIntent(text, opts), getStatus().
 * CALLX402_CORE_PATH exists so tests can point the server at a mock core;
 * it is a test seam, not a public config surface.
 *
 * Usage: node server/index.js
 * Env: CALLX402_PORT (default 8787), CALLX402_HOST (default 127.0.0.1),
 *      CALLX402_AUTH_TOKEN, CALLX402_TIMEOUT_MS (default 30000),
 *      CALLX402_CORE_PATH.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = '0.1.0';
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

const POST_ROUTES = {
  '/call': 'call',
  '/rescue': 'rescue',
  '/route': 'route',
  '/resolve': 'resolve',
  '/diagnose': 'diagnose',
};

/* ------------------------------------------------------------------ */
/* Minimal YAML subset parser.                                        */
/* Handles exactly the style used in openapi.yaml: 2-space indented   */
/* block mappings and sequences, plain/quoted scalars, `|` literal    */
/* blocks, `[]`/`{}` flow empties, comments on their own lines, and   */
/* the `---` document marker. NOT a general-purpose YAML parser.     */
/* ------------------------------------------------------------------ */
function yamlToJson(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const indentOf = (l) => /^ */.exec(l)[0].length;
  const isSeqItem = (l) => {
    const t = l.trimStart();
    return t === '-' || t.startsWith('- ');
  };
  function skip() {
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t === '---' || t.startsWith('#')) i++;
      else break;
    }
  }
  function peek() {
    skip();
    return i < lines.length ? lines[i] : null;
  }
  function parseScalar(raw) {
    const t = raw.trim();
    if (t === '' ) return '';
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return JSON.parse(t);
    if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'")
      return t.slice(1, -1).replace(/''/g, "'");
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null' || t === '~') return null;
    if (t === '[]') return [];
    if (t === '{}') return {};
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
    return t;
  }
  function splitKey(trimmed) {
    const c = trimmed.indexOf(':');
    if (c < 0) throw new Error('Invalid YAML line (no colon): ' + trimmed);
    return [trimmed.slice(0, c).trim(), trimmed.slice(c + 1).trim()];
  }
  // A "- foo: bar" dash item is a map entry only when the key looks like a
  // plain key (guards against bare scalars like URLs containing ':').
  function isMapEntry(s) {
    const c = s.indexOf(':');
    if (c < 0) return false;
    const key = s.slice(0, c).trim();
    if (/^(https?|ftp)$/i.test(key) && s.slice(c, c + 3) === '://') return false;
    return /^[A-Za-z0-9_][A-Za-z0-9_.\-/{}]*$/.test(key);
  }
  function parseValueInto(map, key, val, indent) {
    if (val === '|' || val === '|-') {
      map[key] = parseLiteral(indent + 2);
    } else if (val === '') {
      const child = parseNode(indent + 2);
      map[key] = child === null ? null : child;
    } else {
      map[key] = parseScalar(val);
    }
  }
  function parseNode(indent) {
    const l = peek();
    if (l === null || indentOf(l) < indent) return null;
    return isSeqItem(l) ? parseSeq(indentOf(l)) : parseMap(indentOf(l));
  }
  function parseMap(indent) {
    const obj = {};
    for (;;) {
      const l = peek();
      if (l === null || indentOf(l) !== indent || isSeqItem(l)) break;
      const [rawKey, val] = splitKey(l.trim());
      const key = String(parseScalar(rawKey));
      i++;
      parseValueInto(obj, key, val, indent);
    }
    return obj;
  }
  function parseSeq(indent) {
    const arr = [];
    for (;;) {
      const l = peek();
      if (l === null || indentOf(l) !== indent || !isSeqItem(l)) break;
      const trimmed = l.trim();
      const dash = trimmed === '-' ? '' : trimmed.slice(2).trim();
      i++;
      if (dash === '') {
        const child = parseNode(indent + 2);
        arr.push(child === null ? null : child);
        continue;
      }
      if (isMapEntry(dash)) {
        const map = {};
        const [rk, v] = splitKey(dash);
        parseValueInto(map, String(parseScalar(rk)), v, indent);
        for (;;) {
          const l2 = peek();
          if (l2 === null || indentOf(l2) !== indent + 2 || isSeqItem(l2)) break;
          if (!isMapEntry(l2.trim())) break;
          const [rk2, v2] = splitKey(l2.trim());
          i++;
          parseValueInto(map, String(parseScalar(rk2)), v2, indent);
        }
        arr.push(map);
        continue;
      }
      arr.push(parseScalar(dash));
    }
    return arr;
  }
  function parseLiteral(indent) {
    const out = [];
    for (;;) {
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.trim() === '') {
        out.push('');
        i++;
        continue;
      }
      if (indentOf(l) < indent) break;
      out.push(l.slice(indent));
      i++;
    }
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    // `|` clip semantics: content ends with a single newline.
    return out.length > 0 ? out.join('\n') + '\n' : '';
  }
  skip();
  const doc = parseNode(0);
  skip();
  if (i < lines.length) throw new Error('Trailing content after YAML document: ' + lines[i]);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Core loading                                                       */
/* ------------------------------------------------------------------ */
function loadCore(opts) {
  if (opts && opts.core) return opts.core;
  const corePath = process.env.CALLX402_CORE_PATH || path.join(__dirname, '..', 'core');
  let core;
  try {
    core = require(corePath);
  } catch (err) {
    throw new Error(
      'Cannot load callx402 core from ' + corePath + ': ' + (err && err.message) +
      '. Set CALLX402_CORE_PATH to a directory exporting runAction, runIntent, getStatus.'
    );
  }
  for (const fn of ['runAction', 'runIntent', 'getStatus']) {
    if (typeof core[fn] !== 'function') {
      throw new Error('callx402 core at ' + corePath + ' is missing required export: ' + fn);
    }
  }
  return core;
}

function loadOpenApiSpec() {
  const yamlPath = path.join(__dirname, 'openapi.yaml');
  const yamlText = fs.readFileSync(yamlPath, 'utf8');
  const json = yamlToJson(yamlText);
  if (!json || json.openapi !== '3.0.0' || typeof json.paths !== 'object' || json.paths === null) {
    throw new Error('openapi.yaml did not parse as an OpenAPI 3.0 document');
  }
  return { yamlText, json };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function transportEnvelope(action, code, message, extra) {
  return {
    ok: false,
    action: action,
    disposition: null,
    subsystem: null,
    subsystemStatus: null,
    data: null,
    settlement: null,
    txHash: null,
    receipt: null,
    idempotencyKey: (extra && extra.idempotencyKey) || null,
    deduped: false,
    error: { code: code, message: message },
  };
}

// Constant-time bearer comparison (guards token length probing).
function bearerOk(headerValue, token) {
  const expected = 'Bearer ' + token;
  const a = Buffer.from(headerValue || '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        failed = true;
        reject(Object.assign(new Error('Request body exceeds 1 MiB'), { code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

function withTimeout(promise, ms, action, idempotencyKey) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(transportEnvelope(action, 'timeout',
        'Request exceeded timeoutMs=' + ms + 'ms. The underlying operation may still be running; re-check status with the same idempotencyKey instead of blindly retrying.',
        { idempotencyKey: idempotencyKey || null }));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const HTTP_503_CODES = new Set(['subsystem_disabled', 'subsystem_unreachable', 'disabled', 'unreachable', 'not_enabled']);

function statusFromEnvelope(env) {
  if (!env || typeof env !== 'object') return 500;
  if (env.ok) return 200;
  const code = env.error && env.error.code;
  const ss = env.subsystemStatus;
  if (code === 'unauthorized') return 401;
  if (code === 'timeout') return 504;
  if (code === 'bad_request' || code === 'validation_error' || code === 'invalid_input') return 400;
  if (code === 'budget_refused' || code === 'spendguard_refused' || code === 'approval_required') return 403;
  if (code === 'settlement_unknown' || code === 'unsafe_retry_refused') return 409;
  if (ss === 'disabled' || ss === 'unreachable' || HTTP_503_CODES.has(code)) return 503;
  return 500;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// Core dispatch returns either the envelope directly or {result: envelope,
// exitCode: n} (the CLI-oriented wrapper). Normalize to the envelope.
function unwrapEnvelope(ret) {
  if (ret && typeof ret === 'object' && !Array.isArray(ret)) {
    const r = ret.result;
    if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
  }
  return ret;
}

const INTENT_OPT_KEYS = ['maxBudget', 'deadline', 'speed', 'risk', 'networks', 'assets',
  'providers', 'approvalThreshold', 'idempotencyKey', 'dryRun', 'timeoutMs'];

function pickTimeout(body, defaultTimeoutMs) {
  const t = body && body.timeoutMs;
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) return Math.floor(t);
  return defaultTimeoutMs;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/* ------------------------------------------------------------------ */
/* Route handlers                                                     */
/* ------------------------------------------------------------------ */
async function handleHealth(ctx, res) {
  try {
    const status = await withTimeout(ctx.core.getStatus(), ctx.defaultTimeoutMs, 'status', null);
    const subsystems = status && typeof status === 'object' && status.subsystems !== undefined
      ? status.subsystems
      : status;
    const ok = !(status && status.ok === false);
    sendJson(res, ok ? 200 : 503, {
      ok: ok,
      version: VERSION,
      subsystems: subsystems === undefined ? null : subsystems,
      error: status && status.error ? status.error : null,
    });
  } catch (err) {
    const env = err && err.error && err.error.code === 'timeout'
      ? err
      : transportEnvelope('status', 'status_unavailable', 'getStatus failed: ' + (err && err.message ? err.message : String(err)));
    sendJson(res, 503, { ok: false, version: VERSION, subsystems: null, error: env.error });
  }
}

function validateBody(body, route) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  if (route === '/call' && !isNonEmptyString(body.intent)) {
    return 'POST /call requires a non-empty string "intent".';
  }
  if (route === '/rescue' && !isNonEmptyString(body.incidentId)) {
    return 'POST /rescue requires a non-empty string "incidentId".';
  }
  if (route === '/route' && !isNonEmptyString(body.goal)) {
    return 'POST /route requires a non-empty string "goal".';
  }
  if (route === '/resolve' && (body.evidence === null || typeof body.evidence !== 'object' || Array.isArray(body.evidence))) {
    return 'POST /resolve requires an "evidence" object.';
  }
  if (route === '/diagnose' && !isNonEmptyString(body.target) && (body.evidence === null || typeof body.evidence !== 'object' || Array.isArray(body.evidence))) {
    return 'POST /diagnose requires a "target" string and/or an "evidence" object.';
  }
  return null;
}

async function dispatchPost(route, body, ctx) {
  const invalid = validateBody(body, route);
  if (invalid) {
    return { status: 400, envelope: transportEnvelope(POST_ROUTES[route], 'validation_error', invalid) };
  }
  const timeoutMs = pickTimeout(body, ctx.defaultTimeoutMs);
  try {
    if (route === '/call') {
      const env = unwrapEnvelope(await withTimeout(
        ctx.core.runIntent(body.intent, pick(body, INTENT_OPT_KEYS)),
        timeoutMs, 'call', body.idempotencyKey || null));
      return { status: statusFromEnvelope(env), envelope: env };
    }
    const action = POST_ROUTES[route];
    const args = Object.assign({}, body);
    delete args.timeoutMs; // transport concern, handled by the HTTP layer
    const env = unwrapEnvelope(await withTimeout(ctx.core.runAction(action, args), timeoutMs, action, body.idempotencyKey || null));
    return { status: statusFromEnvelope(env), envelope: env };
  } catch (err) {
    // withTimeout rejects with a timeout envelope (plain object, not an Error).
    if (err && err.error && err.error.code === 'timeout') return { status: 504, envelope: err };
    throw err;
  }
}

async function handleRequest(req, res, ctx) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') return handleHealth(ctx, res);
  if (req.method === 'GET' && pathname === '/openapi.json') return sendJson(res, 200, ctx.spec.json);
  if (req.method === 'GET' && pathname === '/openapi.yaml') {
    res.writeHead(200, {
      'content-type': 'text/yaml; charset=utf-8',
      'content-length': Buffer.byteLength(ctx.spec.yamlText),
    });
    return res.end(ctx.spec.yamlText);
  }

  if (Object.prototype.hasOwnProperty.call(POST_ROUTES, pathname)) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' });
      return res.end(JSON.stringify(transportEnvelope(POST_ROUTES[pathname], 'method_not_allowed',
        pathname + ' only supports POST.')));
    }
    if (ctx.authToken && !bearerOk(req.headers['authorization'], ctx.authToken)) {
      return sendJson(res, 401, transportEnvelope(POST_ROUTES[pathname], 'unauthorized',
        'Missing or invalid Authorization: Bearer token.'));
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err && err.code === 'too_large') {
        return sendJson(res, 413, transportEnvelope(POST_ROUTES[pathname], 'bad_request', err.message));
      }
      throw err;
    }
    let body = null;
    if (raw.trim() !== '') {
      try {
        body = JSON.parse(raw);
      } catch (err) {
        return sendJson(res, 400, transportEnvelope(POST_ROUTES[pathname], 'bad_request',
          'Malformed JSON body: ' + (err && err.message ? err.message : String(err))));
      }
    }
    const { status, envelope } = await dispatchPost(pathname, body, ctx);
    return sendJson(res, status, envelope);
  }

  return sendJson(res, 404, transportEnvelope(null, 'not_found',
    'Unknown route: ' + req.method + ' ' + pathname + '. See GET /openapi.json.'));
}

/* ------------------------------------------------------------------ */
/* Server factory                                                     */
/* ------------------------------------------------------------------ */
function createServer(opts) {
  const o = opts || {};
  const core = loadCore(o);
  const authToken = o.authToken !== undefined ? o.authToken : (process.env.CALLX402_AUTH_TOKEN || null);
  const defaultTimeoutMs = numEnv('CALLX402_TIMEOUT_MS',
    (o.timeoutMs !== undefined ? o.timeoutMs : DEFAULT_TIMEOUT_MS));
  const spec = loadOpenApiSpec();
  const ctx = { core: core, authToken: authToken, defaultTimeoutMs: defaultTimeoutMs, spec: spec };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, transportEnvelope(null, 'internal',
          'Unhandled server error: ' + (err && err.message ? err.message : String(err))));
      } else {
        res.destroy();
      }
    });
  });
  server.callx402 = { version: VERSION, authEnabled: !!authToken };
  return server;
}

module.exports = { createServer: createServer, VERSION: VERSION, yamlToJson: yamlToJson, statusFromEnvelope: statusFromEnvelope };

/* ------------------------------------------------------------------ */
/* Direct run: node server/index.js                                    */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  const port = numEnv('CALLX402_PORT', DEFAULT_PORT);
  const host = process.env.CALLX402_HOST || DEFAULT_HOST;
  let server;
  try {
    server = createServer();
  } catch (err) {
    console.error('callx402: failed to start: ' + (err && err.message ? err.message : err));
    process.exit(1);
  }
  server.listen(port, host, () => {
    console.log('callx402 v' + VERSION + ' listening on http://' + host + ':' + port +
      (server.callx402.authEnabled ? ' (bearer auth required on POST routes)' : ' (no auth token set; POST routes open)'));
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
