#!/usr/bin/env node
'use strict';

/**
 * bin/callx402.js — CLI for the callx402 universal action layer (stdlib only).
 *
 *   callx402 <command> [args] [options]
 *   callx402 "natural language intent"      # intent mode -> execute
 *   callx402 --help | --version
 *
 * Global: --json, --timeout <ms>. Exit codes: 0 ok, 1 failure, 2 usage,
 * 3 subsystem disabled/unreachable, 4 budget refused, 5 settlement unknown.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'core'));
const { loadConfig, getConfig, setConfig, listConfig } = require(path.join(ROOT, 'core', 'config'));
const { EXIT } = require(path.join(ROOT, 'core', 'envelope'));

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version || '1.0.0';

const COMMANDS = ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'status', 'preflight', 'inspect', 'config'];

const HELP = `callx402 ${VERSION} — universal action layer for x402 infrastructure.
callx402 is the ACTION, not the product name; every command dispatches into
the existing v2.0.0 subsystems. Nothing here executes payments by itself.

Usage:
  callx402 <command> [args] [options]
  callx402 "natural language intent"        intent mode (plans, never executes blindly)
  callx402 --help | --version

Commands:
  diagnose    run the x402 doctor over supplied evidence        [--target ...]
  rescue      incident triage (auth-gated; read-only without auth) --incident <id>
  route       select a tool/route for a goal                   --goal <text>
  resolve     resolve settlement state from evidence           --evidence <json|@file>
  doctor      alias of diagnose
  execute     run the intent pipeline                          --intent <text> [--max-budget N] [--dry-run] [--idempotency-key K]
  monitor     sentinel snapshot [--once] or stream [--watch]
  status      per-subsystem reachable/enabled/version report
  preflight   run MCP preflight checks
  inspect     capability-graph lookup/stats                    [--query <text>]
  config      list | get <key> | set <key> <value>

Options:
  --json                 print the full result envelope as JSON
  --timeout <ms>         fail the action if it exceeds <ms>
  --approve              authorize costs above the approval threshold
  --force-retry          explicit retry flag (REFUSED when prior settlement is UNKNOWN)
  --dry-run              plan only; no execution side effects
  --speed fast|balanced|cheap   routing policy hint
  --max-budget <usd>     cap for execute
  --idempotency-key <k>  dedupe key for execute
  -h, --help             this help
  -v, --version          version

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`;

function parseArgv(argv) {
  const out = { flags: {}, positionals: [], errors: [] };
  const SHORT = { h: 'help', v: 'version' };
  // Unknown --flags are usage errors, never silently ignored: a typo like
  // --dry-runn must not silently change what the command does.
  const KNOWN_FLAGS = new Set([
    'help', 'version', 'json', 'timeout', 'maxBudget', 'approvalThreshold',
    'idempotencyKey', 'evidence', 'incident', 'goal', 'intent', 'query',
    'target', 'speed', 'interval', 'network', 'networks', 'asset', 'assets',
    'providers', 'deadline', 'risk',
    'dryRun', 'approve', 'forceRetry', 'retry', 'auth', 'watch', 'once',
  ]);
  let i = 0;
  while (i < argv.length) {
    const t = argv[i];
    if (t === '--') { out.positionals.push(...argv.slice(i + 1)); break; }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const rawName = eq === -1 ? t.slice(2) : t.slice(2, eq);
      const name = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = eq === -1 ? null : t.slice(eq + 1);
      if (!KNOWN_FLAGS.has(name)) {
        out.errors.push(`unknown flag --${rawName}`);
        i += 1;
        continue;
      }
      const NEEDS_VALUE = new Set(['timeout', 'maxBudget', 'approvalThreshold', 'idempotencyKey', 'evidence', 'incident', 'goal', 'intent', 'query', 'target', 'speed', 'interval', 'network', 'networks', 'asset', 'assets', 'providers', 'deadline', 'risk']);
      if (NEEDS_VALUE.has(name)) {
        if (val !== null) out.flags[name] = val;
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) out.flags[name] = argv[++i];
        else out.errors.push(`flag --${t.slice(2)} requires a value`);
      } else {
        out.flags[name] = val === null ? true : val;
      }
    } else if (t.startsWith('-') && t.length === 2) {
      const name = SHORT[t[1]];
      if (!name) out.errors.push(`unknown flag ${t}`);
      else out.flags[name] = true;
    } else if (t.startsWith('-')) {
      out.errors.push(`unknown flag ${t}`);
    } else {
      out.positionals.push(t);
    }
    i += 1;
  }
  return out;
}

function usageError(message) {
  console.error(`callx402: ${message}\nValid commands: ${COMMANDS.join(', ')}\nRun 'callx402 --help' for usage.`);
  process.exit(EXIT.USAGE);
}

/** Concise human-readable summary for non-JSON output. */
function summarize(envelope) {
  const lines = [];
  lines.push(`${envelope.ok ? 'ok' : 'FAILED'} [${envelope.action || '?'}]${envelope.subsystem ? ` via ${envelope.subsystem}` : ''}`);
  if (envelope.disposition) lines.push(envelope.disposition);
  if (envelope.subsystemStatus && envelope.subsystemStatus !== 'ok') lines.push(`subsystemStatus: ${envelope.subsystemStatus}`);
  if (envelope.settlement) lines.push(`settlement: ${envelope.settlement}`);
  if (envelope.txHash) lines.push(`txHash: ${envelope.txHash}`);
  if (envelope.idempotencyKey) lines.push(`idempotencyKey: ${envelope.idempotencyKey}${envelope.deduped ? ' (deduped)' : ''}`);
  if (envelope.error) lines.push(`error [${envelope.error.code}]: ${envelope.error.message}`);
  return lines.join('\n');
}

function statusSummary(envelope) {
  const lines = [envelope.disposition || 'status'];
  const subs = (envelope.data && envelope.data.subsystems) || {};
  for (const [name, s] of Object.entries(subs)) {
    const mark = !s.reachable ? 'UNREACHABLE' : s.enabled ? 'enabled' : `disabled (${s.flag || 'no FLAG export'})`;
    lines.push(`  ${name.padEnd(12)} ${mark}${s.version ? `  v${s.version}` : ''}`);
  }
  return lines.join('\n');
}

async function main() {
  const { flags, positionals, errors } = parseArgv(process.argv.slice(2));

  if (flags.help) { process.stdout.write(HELP); process.exit(EXIT.OK); }
  if (flags.version) { process.stdout.write(`callx402 ${VERSION}\n`); process.exit(EXIT.OK); }
  if (errors.length > 0) usageError(errors[0]);

  const [first, ...rest] = positionals;

  // Bare quoted string -> intent mode: anything not a known command AND looking
  // like natural language (more than one word). A single unknown word is an
  // unknown command (exit 2), per the CLI contract.
  const isCommand = first && COMMANDS.includes(first);
  if (!isCommand && first && first.startsWith('-')) usageError(`unknown input '${first}'`);
  if (!isCommand && positionals.length === 1 && !/\s/.test(first)) usageError(`unknown command '${first}'`);
  const command = isCommand ? first : (first === undefined ? null : '__intent__');

  // config handled directly (not a subsystem dispatch)
  if (command === 'config') {
    const sub = rest[0];
    try {
      if (sub === 'list' || sub === undefined) {
        const cfg = listConfig();
        if (flags.json) console.log(JSON.stringify(cfg, null, 2));
        else for (const [k, v] of Object.entries(cfg)) console.log(`${k}=${v}`);
        process.exit(EXIT.OK);
      }
      if (sub === 'get') {
        if (!rest[1]) usageError('config get <key>');
        const v = getConfig(rest[1]);
        if (flags.json) console.log(JSON.stringify({ [rest[1]]: v }));
        else console.log(`${rest[1]}=${v}`);
        process.exit(EXIT.OK);
      }
      if (sub === 'set') {
        if (!rest[1] || rest[2] === undefined) usageError('config set <key> <value>');
        const cfg = setConfig(rest[1], rest[2]);
        if (flags.json) console.log(JSON.stringify({ [rest[1]]: cfg[rest[1]] }));
        else console.log(`${rest[1]}=${cfg[rest[1]]}`);
        process.exit(EXIT.OK);
      }
      usageError(`unknown config subcommand '${sub}' (use list|get|set)`);
    } catch (err) {
      console.error(`callx402: ${err.message}`);
      process.exit(EXIT.USAGE);
    }
  }

  if (!command) usageError('no command given');

  const toNum = (v) => (v === undefined ? undefined : Number(v));
  // Comma-separated list flags (also used by the Python SDK: --networks a,b).
  const toList = (v) => (v === undefined ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));
  const args = {
    json: !!flags.json,
    timeoutMs: toNum(flags.timeout),
    evidence: flags.evidence,
    target: flags.target,
    incident: flags.incident,
    goal: flags.goal,
    intent: flags.intent,
    query: flags.query,
    speed: flags.speed,
    maxBudget: toNum(flags.maxBudget),
    approvalThreshold: toNum(flags.approvalThreshold),
    idempotencyKey: flags.idempotencyKey,
    dryRun: flags.dryRun === true || flags.dryRun === 'true',
    approve: flags.approve === true || flags.approve === 'true',
    forceRetry: flags.forceRetry === true || flags.forceRetry === 'true',
    retry: flags.retry === true || flags.retry === 'true',
    auth: flags.auth === true || flags.auth === 'true' || flags.auth === '1' ? true : undefined,
    watch: !!flags.watch,
    once: !!flags.once,
    interval: toNum(flags.interval),
    network: flags.network,
    deadline: flags.deadline,
    risk: flags.risk,
    networks: toList(flags.networks) || (flags.network ? [flags.network] : undefined),
    assets: toList(flags.assets) || (flags.asset ? [flags.asset] : undefined),
    providers: toList(flags.providers),
  };

  let actionName = command;
  if (command === '__intent__') {
    actionName = 'execute';
    args.intent = positionals.join(' ');
  } else {
    // positional fallbacks
    if ((command === 'diagnose' || command === 'doctor') && !args.target && rest.length > 0) args.target = rest.join(' ');
    if (command === 'route' && !args.goal && rest.length > 0) args.goal = rest.join(' ');
    if (command === 'execute' && !args.intent && rest.length > 0) args.intent = rest.join(' ');
    if (command === 'inspect' && !args.query && rest.length > 0) args.query = rest.join(' ');
    if (command === 'rescue' && !args.incident && rest.length > 0) args.incident = rest[0];
  }

  if (Number.isNaN(args.timeoutMs)) usageError('--timeout must be a number (ms)');
  if (args.maxBudget !== undefined && Number.isNaN(args.maxBudget)) usageError('--max-budget must be a number');
  if (args.approvalThreshold !== undefined && Number.isNaN(args.approvalThreshold)) usageError('--approval-threshold must be a number');

  try {
    const { result, exitCode } = await core.runAction(actionName, args, { version: VERSION });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (actionName === 'status') {
      console.log(statusSummary(result));
    } else {
      console.log(summarize(result));
    }
    process.exit(exitCode);
  } catch (err) {
    console.error(`callx402: ${err.message}`);
    process.exit(EXIT.FAIL);
  }
}

main();
