'use strict';

/**
 * core/remote.js — remote-mode dispatch (SPEC §5).
 *
 * When config.mode === 'remote', runAction/runIntent delegate to a callx402
 * HTTP server at config.remoteUrl instead of dispatching into local
 * subsystems. The server's envelope is returned as-is; its exit code is
 * derived with exitCodeFor.
 *
 * Money-safety: remote is a transport change only. Budget refusals,
 * settlement-UNKNOWN, and unsafe-retry refusals surface exactly as the
 * remote server reports them; this layer never retries.
 *
 * Auth: when config.authToken (CALLX402_AUTH_TOKEN) is set, requests carry
 * `Authorization: Bearer <token>`, matching server/index.js.
 *
 * The deps seam (internal/test) disables remote dispatch: an explicit
 * subsystem override means "dispatch locally against these handles".
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const { EXIT, ok, fail, exitCodeFor } = require('./envelope');

const DEFAULT_REMOTE_TIMEOUT_MS = 15000;

// CLI/server route map. Actions without a server route fail closed with a
// clear usage error (never silently degraded).
const POST_ROUTES = {
  execute: '/call',
  rescue: '/rescue',
  route: '/route',
  resolve: '/resolve',
  diagnose: '/diagnose',
  doctor: '/diagnose',
};

const REMOTE_UNSUPPORTED = {
  monitor: 'monitor streams local sentinel snapshots; no server route exists',
  preflight: 'preflight runs local preflight checks; no server route exists',
  inspect: 'inspect queries the local capability graph; no server route exists',
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Parse --evidence style input locally so malformed input fails before any network call. */
function parseEvidenceInput(input) {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string') return input;
  const s = input.trim();
  if (s.startsWith('@')) {
    const raw = fs.readFileSync(path.resolve(s.slice(1)), 'utf8');
    return JSON.parse(raw);
  }
  return JSON.parse(s);
}

function requestJson(urlStr, { method = 'POST', body = null, authToken = null, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === null || body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (data !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(data);
    }
    if (authToken) headers['authorization'] = 'Bearer ' + authToken;
    const req = lib.request(u, { method, headers, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (data !== null) req.end(data);
    else req.end();
  });
}

function unreachableResult(action, remoteUrl, err) {
  const detail = (err && err.message) || String(err);
  return {
    result: fail(action, {
      code: 'remote_unreachable',
      message: `remote callx402 server at ${remoteUrl} is unreachable (${detail}). Set CALLX402_MODE=local to dispatch locally, or start a callx402 server (node server/index.js) at that URL. Nothing was executed remotely.`,
      disposition: `Remote server unreachable: ${remoteUrl}.`,
      data: { remoteUrl },
    }),
    exitCode: EXIT.UNAVAILABLE,
  };
}

function buildCall(action, args) {
  switch (action) {
    case 'execute':
      return {
        route: POST_ROUTES.execute,
        body: {
          intent: args.intent || args.text || '',
          ...pick(args, ['maxBudget', 'deadline', 'speed', 'risk', 'networks', 'assets', 'providers', 'approvalThreshold', 'idempotencyKey', 'dryRun', 'timeoutMs']),
        },
      };
    case 'rescue':
      return { route: POST_ROUTES.rescue, body: { incidentId: args.incident || null, ...pick(args, ['network', 'context']) } };
    case 'route':
      return { route: POST_ROUTES.route, body: { goal: args.goal || args.intent || args.text || '', ...pick(args, ['speed', 'networks', 'assets', 'providers']) } };
    case 'resolve': {
      let evidence;
      try {
        evidence = parseEvidenceInput(args.evidence);
      } catch (err) {
        return { usageError: `malformed evidence JSON: ${err.message}` };
      }
      return { route: POST_ROUTES.resolve, body: { evidence: evidence === undefined ? {} : evidence } };
    }
    case 'diagnose':
    case 'doctor': {
      let evidence;
      try {
        evidence = parseEvidenceInput(args.evidence ?? args.target);
      } catch (err) {
        return { usageError: `malformed evidence JSON: ${err.message}` };
      }
      const body = { target: typeof args.target === 'string' ? args.target : null };
      if (evidence !== undefined) body.evidence = evidence;
      return { route: POST_ROUTES.diagnose, body };
    }
    default:
      return { usageError: null }; // handled by caller
  }
}

/**
 * dispatchRemote(config, action, args, { timeoutMs }) -> Promise<{ result, exitCode }>
 */
async function dispatchRemote(config, action, args = {}, opts = {}) {
  const remoteUrl = String(config.remoteUrl || '').replace(/\/+$/, '');

  if (!remoteUrl) {
    return {
      result: fail(action, {
        code: 'usage',
        message: 'CALLX402_MODE=remote requires a remote URL: set CALLX402_REMOTE_URL (or config remoteUrl), e.g. http://127.0.0.1:8787.',
        disposition: 'Remote mode configured without a remote URL.',
      }),
      exitCode: EXIT.USAGE,
    };
  }

  if (action === 'config') {
    // Client-side config management never goes over the wire.
    return {
      result: fail(action, { code: 'usage', message: 'config is always local; it is not dispatched to the remote server.' }),
      exitCode: EXIT.USAGE,
    };
  }

  if (REMOTE_UNSUPPORTED[action]) {
    return {
      result: fail(action, {
        code: 'usage',
        message: `${action}: ${REMOTE_UNSUPPORTED[action]}. The callx402 server exposes /call, /rescue, /route, /resolve, /diagnose and /health only. Run with CALLX402_MODE=local for ${action}.`,
        disposition: `${action} is not available in remote mode.`,
        data: { remoteUrl },
      }),
      exitCode: EXIT.USAGE,
    };
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_REMOTE_TIMEOUT_MS;
  const authToken = config.authToken || null;

  try {
    if (action === 'status') {
      const { body } = await requestJson(remoteUrl + '/health', { method: 'GET', authToken, timeoutMs });
      let parsed = null;
      try { parsed = JSON.parse(body); } catch (_) { /* handled below */ }
      if (!parsed || typeof parsed !== 'object') {
        return {
          result: fail(action, { code: 'remote_bad_response', message: `remote server at ${remoteUrl} returned a non-JSON /health response.`, data: { remoteUrl } }),
          exitCode: EXIT.FAIL,
        };
      }
      if (parsed.ok !== true) {
        const r = fail(action, {
          code: (parsed.error && parsed.error.code) || 'remote_error',
          message: (parsed.error && parsed.error.message) || `remote /health reported failure at ${remoteUrl}.`,
          data: { remoteUrl, version: parsed.version || null },
        });
        return { result: r, exitCode: exitCodeFor(r) };
      }
      return {
        result: ok('status', {
          subsystem: null,
          disposition: `remote callx402 status from ${remoteUrl}: v${parsed.version || '?'}.`,
          data: { version: parsed.version || null, remoteUrl, subsystems: parsed.subsystems || {} },
        }),
        exitCode: EXIT.OK,
      };
    }

    if (!POST_ROUTES[action]) {
      return {
        result: fail(action, { code: 'unknown_action', message: `unknown action '${action}' for remote dispatch.` }),
        exitCode: EXIT.USAGE,
      };
    }

    const call = buildCall(action, args);
    if (call.usageError) {
      return {
        result: fail(action, { code: 'usage', message: call.usageError, disposition: 'Malformed input.' }),
        exitCode: EXIT.USAGE,
      };
    }
    const { body } = await requestJson(remoteUrl + call.route, { method: 'POST', body: call.body, authToken, timeoutMs });
    let env = null;
    try { env = JSON.parse(body); } catch (_) { /* handled below */ }
    if (!env || typeof env !== 'object' || typeof env.ok !== 'boolean') {
      return {
        result: fail(action, { code: 'remote_bad_response', message: `remote server at ${remoteUrl}${call.route} returned a non-envelope response.`, data: { remoteUrl, route: call.route } }),
        exitCode: EXIT.FAIL,
      };
    }
    return { result: env, exitCode: exitCodeFor(env) };
  } catch (err) {
    return unreachableResult(action, remoteUrl, err);
  }
}

module.exports = { dispatchRemote, POST_ROUTES, REMOTE_UNSUPPORTED, DEFAULT_REMOTE_TIMEOUT_MS };
