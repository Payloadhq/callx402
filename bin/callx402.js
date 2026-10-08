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
const rail = require(path.join(ROOT, 'core', 'rail'));
const { loadConfig, getConfig, setConfig, listConfig } = require(path.join(ROOT, 'core', 'config'));
const { EXIT } = require(path.join(ROOT, 'core', 'envelope'));

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version || '1.0.0';

const COMMANDS = ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'status', 'preflight', 'inspect', 'config', 'evidence', 'explain', 'recover'];

// Paid on-demand rail actions that have no CLI command (architecture: the CLI
// is the free local tier; these run on the paid rail via the quote-then-pay
// invocation in docs/problem-map.md). Named here so a mistyped/rail-action
// command gets a routing hint instead of a dead-end usage error.
const RAIL_ONLY_ACTIONS = {
  safe_retry: 'safe_retry', 'safe-retry': 'safe_retry',
  duplicate_payment_risk: 'duplicate_payment_risk', 'duplicate-payment-risk': 'duplicate_payment_risk',
  failure_classification: 'failure_classification', 'failure-classification': 'failure_classification',
  settlement_interpretation: 'settlement_interpretation', 'settlement-interpretation': 'settlement_interpretation',
};

// Per-command help: `callx402 <command> --help` prints the command's own usage
// instead of the global help. Free local tier; paid rail counterparts (where
// they exist) are named with their docs pointer.
const COMMAND_HELP = {
  diagnose: `callx402 diagnose — run the x402 doctor over supplied evidence.

Usage:
  callx402 diagnose --target <url> [--evidence <json|@file>]
  callx402 diagnose --evidence '{"txHash":"0x..."}'

Read-only: classifies the failure stage from evidence you supply; performs no
live probing and changes no state. Requires PAYLOAD_MCP_DOCTOR=1 (exit 3 names
the flag when it is off).

Paid one-off counterpart: the 'diagnose' rail action (quote first, then pay;
see docs/problem-map.md). The MCP tool x402_diagnose covers the same free
diagnostic.

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  rescue: `callx402 rescue — incident triage for stuck or failed x402 transactions.

Usage:
  callx402 rescue --incident <id> [--network <net>] [--auth]

Read-only triage: detects the incident, quotes the rescue, presents the
free-vs-paid offer. Paid execution is NEVER performed by this command.
Without --auth (or CALLX402_AUTH_TOKEN / config rescueAuth) it refuses with
exit 3. Requires PAYLOAD_RESCUE=1.

Paid one-off counterpart: the 'rescue' rail action (see docs/problem-map.md).

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable or auth_required ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  route: `callx402 route — select a tool/route for a goal under a routing policy.

Usage:
  callx402 route --goal <text> [--speed fast|balanced|cheap]
                 [--networks a,b] [--assets a,b]

Selection only: nothing executed, no money moved. Requires PAYLOAD_MCP_ROUTES=1.

Exit codes: 0 ok · 1 failure · 2 usage (missing --goal) · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  resolve: `callx402 resolve — resolve the settlement state of a payment from evidence.

Usage:
  callx402 resolve --evidence '{"txHash":"0x...","network":"base"}'
  callx402 resolve --evidence @evidence.json

Read-only analysis: maps evidence to DEFINITELY_PAID, DEFINITELY_NOT_PAID,
AUTHORIZED_NOT_SETTLED, SETTLEMENT_PENDING, CONFLICT, or UNKNOWN. Never
queries the chain, never signs, never retries, never repays. Requires
PAYLOAD_SETTLEMENT_RESOLVER=1.

Thin evidence -> settlement UNKNOWN, exit 5. That is the stop sign: do not
retry, do not repay; gather fresh evidence or escalate.

Paid one-off counterpart: the 'resolve' rail action (quote first, then pay;
see docs/problem-map.md). The MCP tool x402_resolve covers the same free
diagnostic.

Exit codes: 0 ok · 1 failure · 2 usage (malformed evidence JSON) ·
3 disabled/unreachable · 4 budget refused ·
5 settlement unknown (never auto-retry, never repay).
`,
  doctor: `callx402 doctor — alias of diagnose.

Usage:
  callx402 doctor --target <url> [--evidence <json|@file>]

Identical to diagnose (the envelope's action field reads "diagnose").
Requires PAYLOAD_MCP_DOCTOR=1.

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  execute: `callx402 execute — run the intent pipeline under an explicit budget.

Usage:
  callx402 execute --intent <text> [--max-budget N] [--dry-run]
                   [--idempotency-key K] [--approve] [--force-retry]

Budget-gated and idempotent. --dry-run plans only. Over-budget plans refuse
with exit 4 and zero side effects. --force-retry after a stored run whose
settlement is UNKNOWN is refused (exit 5): it could double-spend.

Exit codes: 0 ok · 1 failure · 2 usage (missing --intent) ·
3 disabled/unreachable · 4 budget refused ·
5 settlement unknown (never auto-retry, never repay).
`,
  monitor: `callx402 monitor — Sentinel snapshot of x402 incident state.

Usage:
  callx402 monitor --once            single snapshot (default)
  callx402 monitor --watch [--interval <ms>]

Read-only. The default sentinel is inert ("no live tracking") unless
PAYLOAD_SENTINEL=1 enables the live tracker.

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  status: `callx402 status — per-subsystem reachability report.

Usage:
  callx402 status [--json]

Requires nothing; works even when every subsystem is disabled. Reports
reachable/enabled/version/flag for all 15 subsystem handles. Always exits 0
on success.
`,
  preflight: `callx402 preflight — preflight checks over a supplied context.

Usage:
  callx402 preflight [--json]

Read-only: validates setup before a paid run; provisions or repairs nothing.
Requires PAYLOAD_MCP_PREFLIGHT=1.

Paid one-off counterpart: the 'preflight' rail action (see docs/problem-map.md).

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  inspect: `callx402 inspect — capability-graph lookup or stats.

Usage:
  callx402 inspect [--query <text>]

Lookups only. Requires PAYLOAD_MCP_FABRIC=1; without registered tools it
returns zero candidates honestly.

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).
`,
  evidence: `callx402 evidence — show recorded evidence for an operation.

Usage:
  callx402 evidence <operationId> [--dir <path>]

Reads the Veyline operation ledger: events, latest per-plane states (payment,
execution, delivery), protocols. Unknown operations are honest ("no events
recorded"), still exit 0. Requires PAYLOAD_VEYLINE_LEDGER=1. First step in any
incident: returns what is recorded, nothing invented.

Paid one-off counterpart: the 'evidence' rail action (quote first, then pay;
see docs/problem-map.md). The MCP tool x402_evidence covers the same free
diagnostic.

Exit codes: 0 ok · 1 failure · 2 usage (missing operationId) ·
3 disabled/unreachable · 4 budget refused ·
5 settlement unknown (never auto-retry, never repay).
`,
  explain: `callx402 explain — explain an operation's state in plain language.

Usage:
  callx402 explain <operationId> [--dir <path>]

Assessments from recorded ledger evidence: NO_BASIS, INCOMPLETE (do not retry,
do not repay), KNOWN_SAFE, RECOVERY_CANDIDATE (run 'recover'), PARTIAL.
Requires PAYLOAD_VEYLINE_LEDGER=1.

Paid one-off counterpart: the 'explain' rail action (see docs/problem-map.md).
The MCP tool x402_explain covers the same free diagnostic.

Exit codes: 0 ok · 1 failure · 2 usage (missing operationId) ·
3 disabled/unreachable · 4 budget refused ·
5 settlement unknown (never auto-retry, never repay).
`,
  recover: `callx402 recover — report the safe recovery decision (read-only).

Usage:
  callx402 recover <operationId> [--identity <id> | --evidence <json>]

Evaluates recorded history against the operation identity and returns the
recovery decision: RECOVERABLE, SAFE_RETRY, EXECUTED_BUT_UNRECOVERABLE, or
SETTLEMENT_UNKNOWN, mapped to KNOWN_SAFE or HUMAN_REVIEW. Never charges,
never executes, never repays. Requires PAYLOAD_VEYLINE_RECOVERY=1.

This is the read-only answer to "is a retry safe?" — a SAFE_RETRY verdict
here is advisory; performing the safe action stays with your own adapters.
For the paid one-off verdict on a specific retry plan, use the 'safe_retry'
rail action (quote first, then pay; see docs/problem-map.md). The MCP tool
x402_recover covers the same free diagnostic.

Exit codes: 0 ok · 1 failure · 2 usage (missing identity/evidence) ·
3 disabled/unreachable · 4 budget refused ·
5 settlement unknown (never auto-retry, never repay).
`,
  config: `callx402 config — manage local configuration.

Usage:
  callx402 config list
  callx402 config get <key>
  callx402 config set <key> <value>

Valid keys: mode, remoteUrl, authToken, v2Root, defaultNetwork, defaultAsset,
defaultBudgetUsd, approvalThresholdUsd, rescueAuth. Values persist to
~/.config/callx402/config.json (CALLX402_CONFIG overrides the path);
CALLX402_* environment variables override file values at runtime.

Exit codes: 0 ok · 2 usage (unknown key or subcommand).
`,
};

const HELP = `callx402 ${VERSION} — universal action layer for x402 infrastructure.
Install it and it works: subsystem commands route to the hosted Payload Rail
by default (free quote first, then pay-per-action). Nothing here executes
payments by itself.

Usage:
  callx402 <command> [args] [options]
  callx402 "natural language intent"        intent mode (plans, never executes blindly)
  callx402 --help | --version

Commands (hosted by default — zero setup):
  diagnose    run the x402 doctor over supplied evidence        [--target <url|json>] [--evidence <json|@file>]
  rescue      incident triage (auth-gated; read-only without auth) --incident <id>
  route       select a tool/route for a goal                   --goal <text>
  resolve     resolve settlement state from evidence           --evidence <json|@file>
  doctor      alias of diagnose
  execute     run the intent pipeline                          --intent <text> [--max-budget N] [--dry-run] [--idempotency-key K]
  monitor     sentinel snapshot [--once] or stream [--watch]
  status      per-subsystem reachable/enabled/version report
  preflight   run MCP preflight checks
  inspect     capability-graph lookup/stats                    [--query <text>]
  evidence    show recorded evidence for an operation          <operationId> [--dir <path>]
  explain     explain an operation's state in plain language   <operationId> [--dir <path>]
  recover     report the safe recovery decision (read-only)    <operationId> [--identity <id> | --evidence <json>]
  config      list | get <key> | set <key> <v>

Options:
  --json                 print the full result envelope as JSON
  --timeout <ms>         fail the action if it exceeds <ms>
  --approve              approve the quoted price non-interactively
  --force-retry          explicit retry flag (REFUSED when prior settlement is UNKNOWN)
  --dry-run              plan only; no execution side effects
  --speed fast|balanced|cheap   routing policy hint
  --max-budget <usd>     cap for execute
  --idempotency-key <k>  dedupe key for execute
  -h, --help             this help
  -v, --version          version

Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable ·
4 budget refused · 5 settlement unknown (never auto-retry, never repay).

First run (no setup):  callx402 diagnose --evidence '{"txHash":"0x..."}'
                        free quote first, then pay-per-action on the hosted rail.
                        callx402 status        honest subsystem reachability report
                        callx402 'plain words'  plans only; nothing executes, no money moves
Execution modes: hosted rail by default. Set CALLX402_LOCAL=1 to prefer the
local v2.0.0 runtime tree instead (advanced self-hosted mode): set
CALLX402_V2_ROOT to its path and enable each subsystem's flag
(run 'callx402 status' to see flag names).
`;

function parseArgv(argv) {
  const out = { flags: {}, positionals: [], errors: [] };
  const SHORT = { h: 'help', v: 'version' };
  // Unknown --flags are usage errors, never silently ignored: a typo like
  // --dry-runn must not silently change what the command does.
  const KNOWN_FLAGS = new Set([
    'help', 'version', 'json', 'timeout', 'maxBudget', 'approvalThreshold',
    'idempotencyKey', 'evidence', 'incident', 'goal', 'intent', 'query',
    'txHash', 'payerAuth', 'creditId',
    'target', 'speed', 'interval', 'network', 'networks', 'asset', 'assets',
    'providers', 'deadline', 'risk',
    'dryRun', 'approve', 'forceRetry', 'retry', 'auth', 'watch', 'once',
    'dir', 'operationId', 'identity',
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
      const NEEDS_VALUE = new Set(['timeout', 'maxBudget', 'approvalThreshold', 'idempotencyKey', 'evidence', 'incident', 'goal', 'intent', 'query', 'target',
        'txHash', 'payerAuth', 'creditId', 'speed', 'interval', 'network', 'networks', 'asset', 'assets', 'providers', 'deadline', 'risk', 'dir', 'operationId', 'identity']);
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

function usageError(message, first) {
  let msg = message;
  // A rail-only paid action typed as a command is a routing hint, not a
  // dead end: point at the quote-then-pay invocation instead.
  if (first && RAIL_ONLY_ACTIONS[first] && /^unknown command /.test(message)) {
    msg = `${message} — '${RAIL_ONLY_ACTIONS[first]}' is a paid on-demand rail action, not a CLI command. ` +
      `Get the free quote, then pay deliberately: see docs/problem-map.md`;
  }
  console.error(`callx402: ${msg}\nValid commands: ${COMMANDS.join(', ')}\nRun 'callx402 --help' for usage, or 'callx402 <command> --help' for one command.`);
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
  let reachable = 0;
  for (const [name, s] of Object.entries(subs)) {
    if (s.reachable) reachable += 1;
    const mark = !s.reachable ? 'UNREACHABLE' : s.enabled ? 'enabled' : `disabled (${s.flag || 'no FLAG export'})`;
    lines.push(`  ${name.padEnd(12)} ${mark}${s.version ? `  v${s.version}` : ''}`);
  }
  if (reachable === 0 && Object.keys(subs).length > 0) {
    lines.push('');
    lines.push('  No subsystems reachable: subsystem commands need the v2.0.0 tree.');
    lines.push('  Set CALLX402_V2_ROOT to its path (see README "Full subsystem commands").');
  }
  return lines.join('\n');
}

async function main() {
  const { flags, positionals, errors } = parseArgv(process.argv.slice(2));

  // Per-command help: `callx402 <command> --help` prints that command's own
  // usage. Bare `--help` (or --help with an unknown word) prints the global help.
  if (flags.help) {
    const cmd = positionals[0];
    if (cmd && COMMAND_HELP[cmd]) { process.stdout.write(COMMAND_HELP[cmd]); process.exit(EXIT.OK); }
    process.stdout.write(HELP); process.exit(EXIT.OK);
  }
  if (flags.version) { process.stdout.write(`callx402 ${VERSION}\n`); process.exit(EXIT.OK); }
  if (errors.length > 0) usageError(errors[0]);

  const [first, ...rest] = positionals;

  // Bare quoted string -> intent mode: anything not a known command AND looking
  // like natural language (more than one word). A single unknown word is an
  // unknown command (exit 2), per the CLI contract.
  const isCommand = first && COMMANDS.includes(first);
  if (!isCommand && first && first.startsWith('-')) usageError(`unknown input '${first}'`, first);
  if (!isCommand && positionals.length === 1 && !/\s/.test(first)) usageError(`unknown command '${first}'`, first);
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
    dir: flags.dir,
    operationId: flags.operationId,
    identity: flags.identity,
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
    if ((command === 'evidence' || command === 'explain' || command === 'recover') && !args.operationId && rest.length > 0) args.operationId = rest[0];
  }

  if (Number.isNaN(args.timeoutMs)) usageError('--timeout must be a number (ms)');
  if (args.maxBudget !== undefined && Number.isNaN(args.maxBudget)) usageError('--max-budget must be a number');
  if (args.approvalThreshold !== undefined && Number.isNaN(args.approvalThreshold)) usageError('--approval-threshold must be a number');

  try {
    // Hosted rail routing (default): subsystem commands run against the live
    // Payload Rail with zero local setup — invoke -> free quote ->
    // payment/authorization -> result. Set CALLX402_LOCAL=1 to prefer the
    // local v2.0.0 runtime tree instead (advanced self-hosted mode).
    if (rail.isRailCommand(actionName) && !rail.preferLocal()) {
      const railResult = await rail.invokeRail(actionName,
        { ...args, txHash: flags.txHash, payerAuth: flags.payerAuth, creditId: flags.creditId },
        { yes: args.approve, json: args.json });
      if (args.json) {
        console.log(JSON.stringify(railResult, null, 2));
      } else if (railResult.ok) {
        console.log(`\nResult (via ${railResult.via}, invocation ${railResult.invocation_id}):`);
        const ex = railResult.execution;
        if (ex && ex.executed) {
          if (ex.disposition) console.log(ex.disposition);
          if (ex.result !== undefined) console.log(JSON.stringify(ex.result, null, 2));
        } else if (ex && ex.error) {
          console.log(`Note: ${ex.error}`);
        }
        if (railResult.notice) console.log(railResult.notice);
      } else {
        console.error(`callx402: ${railResult.error}`);
        if (railResult.quote) console.error(`Quote was: $${railResult.quote.price_usd} (${railResult.quote.quote_id})`);
      }
      process.exit(railResult.ok ? EXIT.OK : EXIT.FAIL);
    }
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
