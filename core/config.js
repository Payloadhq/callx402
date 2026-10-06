'use strict';

/**
 * core/config.js — config file (~/.config/callx402/config.json, overridable by
 * $CALLX402_CONFIG) + CALLX402_* env overrides + safe defaults.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  mode: 'local',                 // local | remote
  remoteUrl: null,
  authToken: null,
  v2Root: null,                  // null => default relative to v2.0.0 tree
  defaultNetwork: 'base',
  defaultAsset: 'USDC',
  defaultBudgetUsd: 1.00,
  approvalThresholdUsd: 5.00,    // above this: require explicit approval, fail closed
  rescueAuth: false,             // rescue execute requires explicit auth enable
};

// env name -> [config key, coerce]
const ENV_MAP = {
  CALLX402_V2_ROOT: ['v2Root', String],
  CALLX402_MODE: ['mode', String],
  CALLX402_REMOTE_URL: ['remoteUrl', String],
  CALLX402_AUTH_TOKEN: ['authToken', String],
  CALLX402_DEFAULT_NETWORK: ['defaultNetwork', String],
  CALLX402_DEFAULT_ASSET: ['defaultAsset', String],
  CALLX402_DEFAULT_BUDGET_USD: ['defaultBudgetUsd', Number],
  CALLX402_APPROVAL_THRESHOLD_USD: ['approvalThresholdUsd', Number],
};

const NUMERIC_KEYS = new Set(['defaultBudgetUsd', 'approvalThresholdUsd']);

function configPath() {
  if (process.env.CALLX402_CONFIG) return process.env.CALLX402_CONFIG;
  return path.join(os.homedir(), '.config', 'callx402', 'config.json');
}

function readFileConfig() {
  const p = configPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw new Error(`callx402: config file ${p} is not valid JSON (${err.message})`);
    }
  }
  return {};
}

function applyEnvOverrides(cfg) {
  const out = { ...cfg };
  for (const [envName, [key, coerce]] of Object.entries(ENV_MAP)) {
    const v = process.env[envName];
    if (v === undefined || v === null || v === '') continue;
    if (coerce === Number) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[key] = n;
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/** Merged effective config: defaults < file < env. */
function loadConfig() {
  return applyEnvOverrides({ ...DEFAULTS, ...readFileConfig() });
}

function getConfig(key) {
  const cfg = loadConfig();
  if (!(key in DEFAULTS)) throw new Error(`callx402: unknown config key '${key}'`);
  return cfg[key];
}

function listConfig() {
  return loadConfig();
}

/** Persist one key to the config file (env overrides are never persisted). */
function setConfig(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`callx402: unknown config key '${key}' (valid: ${Object.keys(DEFAULTS).join(', ')})`);
  let v = value;
  if (NUMERIC_KEYS.has(key)) {
    v = Number(value);
    if (!Number.isFinite(v)) throw new Error(`callx402: config key '${key}' requires a number`);
  }
  const p = configPath();
  const current = readFileConfig();
  current[key] = v;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return loadConfig();
}

module.exports = { DEFAULTS, configPath, loadConfig, getConfig, setConfig, listConfig };
