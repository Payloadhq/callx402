'use strict';

/**
 * CLI dispatch coverage: every command runs the REAL bin/callx402.js as a
 * subprocess with --json. Asserts the SPEC §4 envelope shape, the action
 * name, and the expected exit code. Also covers unknown commands,
 * malformed input, --version/--help, and intent mode.
 */

const { test } = require('node:test');
const { scratchDir, cliEnv, runCLI, assertEnvelope } = require('./helpers');

const scratch = scratchDir('cli');

function env(extra) {
  return cliEnv(scratch, extra);
}

test('diagnose: disabled subsystem -> exit 3, honest disabled envelope', async (t) => {
  const r = await runCLI(['diagnose', '--json'], env());
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'diagnose');
  t.assert.strictEqual(r.json.ok, false);
  t.assert.strictEqual(r.json.subsystem, 'doctor');
  t.assert.strictEqual(r.json.subsystemStatus, 'disabled');
  t.assert.strictEqual(r.json.error.code, 'subsystem_disabled');
  t.assert.match(r.json.error.message, /PAYLOAD_MCP_DOCTOR=1/);
});

test('diagnose: enabled -> exit 0, real doctor report with stages', async (t) => {
  const r = await runCLI(['diagnose', '--json'], env({ PAYLOAD_MCP_DOCTOR: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'diagnose');
  t.assert.strictEqual(r.json.ok, true);
  t.assert.strictEqual(r.json.subsystem, 'doctor');
  t.assert.ok(Array.isArray(r.json.data.report.stages), 'report carries stages');
  t.assert.strictEqual(r.json.data.report.stages.length, 14);
  t.assert.strictEqual(typeof r.json.data.report.whatFailed, 'string');
});

test('doctor: alias of diagnose -> envelope action is diagnose', async (t) => {
  const r = await runCLI(['doctor', '--json'], env({ PAYLOAD_MCP_DOCTOR: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'diagnose');
});

test('rescue: enabled but no auth -> auth_required, exit 3, nothing executed', async (t) => {
  const r = await runCLI(['rescue', '--incident', 'inc-1', '--json'], env({ PAYLOAD_RESCUE: '1' }));
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'rescue');
  t.assert.strictEqual(r.json.ok, false);
  t.assert.strictEqual(r.json.error.code, 'auth_required');
  t.assert.match(r.json.error.message, /authorization/i);
  t.assert.match(r.json.disposition, /no authorization/i);
});

test('rescue: with --auth -> real rescue triage, read-only, exit 0', async (t) => {
  const r = await runCLI(['rescue', '--incident', 'inc-1', '--auth', '--json'], env({ PAYLOAD_RESCUE: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'rescue');
  t.assert.strictEqual(r.json.ok, true);
  t.assert.match(r.json.disposition, /read-only/i);
});

test('route: disabled subsystem -> exit 3', async (t) => {
  const r = await runCLI(['route', '--goal', 'pick a tool', '--json'], env());
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'route');
  t.assert.strictEqual(r.json.error.code, 'subsystem_disabled');
});

test('route: enabled, no candidates -> honest no-route, exit 0', async (t) => {
  const r = await runCLI(['route', '--goal', 'pick a tool', '--json'], env({ PAYLOAD_MCP_ROUTES: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'route');
  t.assert.strictEqual(r.json.ok, true);
  t.assert.match(r.json.disposition, /No candidate tools available/);
  t.assert.strictEqual(r.json.data.candidates, 0);
});

test('route: missing --goal -> usage error, exit 2', async (t) => {
  const r = await runCLI(['route', '--json'], env({ PAYLOAD_MCP_ROUTES: '1' }));
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'route');
  t.assert.strictEqual(r.json.error.code, 'usage');
});

test('resolve: empty evidence -> settlement UNKNOWN, exit 5', async (t) => {
  const r = await runCLI(['resolve', '--evidence', '{}', '--json'], env({ PAYLOAD_SETTLEMENT_RESOLVER: '1' }));
  t.assert.strictEqual(r.code, 5);
  assertEnvelope(t, r.json, 'resolve');
  t.assert.strictEqual(r.json.ok, false);
  t.assert.strictEqual(r.json.settlement, 'UNKNOWN');
  t.assert.strictEqual(r.json.error.code, 'settlement_unknown');
});

test('resolve: disabled subsystem -> exit 3', async (t) => {
  const r = await runCLI(['resolve', '--evidence', '{}', '--json'], env());
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'resolve');
  t.assert.strictEqual(r.json.error.code, 'subsystem_disabled');
});

test('execute: dry-run intent -> exit 0, honest no-route disposition', async (t) => {
  const r = await runCLI(['execute', '--intent', 'summarize this for under 1 dollar', '--max-budget', '1', '--dry-run', '--json'], env());
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'execute');
  t.assert.strictEqual(r.json.ok, true);
  t.assert.ok(Array.isArray(r.json.data.stages) && r.json.data.stages.length > 0, 'stages recorded');
  t.assert.strictEqual(r.json.settlement, null);
});

test('execute: missing --intent -> usage error, exit 2', async (t) => {
  const r = await runCLI(['execute', '--json'], env());
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'execute');
  t.assert.strictEqual(r.json.error.code, 'usage');
});

test('intent mode: bare quoted string dispatches execute', async (t) => {
  const r = await runCLI(['do something useful for under 1 dollar', '--json'], env());
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'execute');
});

test('monitor: disabled sentinel -> exit 3', async (t) => {
  const r = await runCLI(['monitor', '--once', '--json'], env());
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'monitor');
  t.assert.strictEqual(r.json.error.code, 'subsystem_disabled');
});

test('monitor: inert sentinel snapshot -> exit 0', async (t) => {
  const r = await runCLI(['monitor', '--once', '--json'], env({ PAYLOAD_SENTINEL: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'monitor');
  t.assert.strictEqual(r.json.subsystem, 'sentinel');
  t.assert.ok(r.json.data.snapshot, 'snapshot present');
});

test('status: exit 0, all subsystems reported', async (t) => {
  const r = await runCLI(['status', '--json'], env());
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'status');
  const subs = r.json.data.subsystems;
  t.assert.strictEqual(Object.keys(subs).length, 15);
  for (const [name, s] of Object.entries(subs)) {
    t.assert.strictEqual(typeof s.reachable, 'boolean', `${name}.reachable`);
    t.assert.strictEqual(typeof s.enabled, 'boolean', `${name}.enabled`);
  }
  t.assert.strictEqual(subs.doctor.flag, 'PAYLOAD_MCP_DOCTOR');
});

test('preflight: disabled -> exit 3; enabled -> exit 0 with report', async (t) => {
  const off = await runCLI(['preflight', '--json'], env());
  t.assert.strictEqual(off.code, 3);
  assertEnvelope(t, off.json, 'preflight');

  const on = await runCLI(['preflight', '--json'], env({ PAYLOAD_MCP_PREFLIGHT: '1' }));
  t.assert.strictEqual(on.code, 0);
  assertEnvelope(t, on.json, 'preflight');
  t.assert.strictEqual(on.json.ok, true);
  t.assert.ok(on.json.data.report, 'preflight report present');
});

test('inspect: capability stats without query -> exit 0', async (t) => {
  const r = await runCLI(['inspect', '--json'], env({ PAYLOAD_MCP_FABRIC: '1' }));
  t.assert.strictEqual(r.code, 0);
  assertEnvelope(t, r.json, 'inspect');
  t.assert.strictEqual(r.json.subsystem, 'capabilities');
  t.assert.ok(r.json.data.stats, 'graph stats present');
});

test('inspect: disabled -> exit 3', async (t) => {
  const r = await runCLI(['inspect', '--json'], env());
  t.assert.strictEqual(r.code, 3);
  assertEnvelope(t, r.json, 'inspect');
});

test('config list/get/set round-trip with isolated config file', async (t) => {
  const list = await runCLI(['config', 'list', '--json'], env());
  t.assert.strictEqual(list.code, 0);
  const cfg = JSON.parse(list.stdout);
  t.assert.strictEqual(cfg.mode, 'local');
  t.assert.strictEqual(cfg.defaultBudgetUsd, 1);

  const set = await runCLI(['config', 'set', 'defaultBudgetUsd', '2.5', '--json'], env());
  t.assert.strictEqual(set.code, 0);

  const get = await runCLI(['config', 'get', 'defaultBudgetUsd'], env());
  t.assert.strictEqual(get.code, 0);
  t.assert.match(get.stdout.trim(), /2\.5/);

  const bad = await runCLI(['config', 'set', 'nope', 'x'], env());
  t.assert.strictEqual(bad.code, 2);
  t.assert.match(bad.stderr, /unknown config key/);
});

test('unknown command -> exit 2 and lists valid commands', async (t) => {
  const r = await runCLI(['frobnicate'], env());
  t.assert.strictEqual(r.code, 2);
  t.assert.match(r.stderr, /unknown command 'frobnicate'/);
  for (const c of ['diagnose', 'rescue', 'route', 'resolve', 'doctor', 'execute', 'monitor', 'status', 'preflight', 'inspect', 'config']) {
    t.assert.match(r.stderr, new RegExp(`\\b${c}\\b`), `valid commands list includes ${c}`);
  }
});

test('malformed input: bad JSON evidence -> exit 2 with clear message', async (t) => {
  const r = await runCLI(['resolve', '--evidence', '{not-json', '--json'], env({ PAYLOAD_SETTLEMENT_RESOLVER: '1' }));
  t.assert.strictEqual(r.code, 2);
  assertEnvelope(t, r.json, 'resolve');
  t.assert.strictEqual(r.json.error.code, 'usage');
  t.assert.match(r.json.error.message, /malformed evidence JSON/);
});

test('malformed input: bad flag values -> exit 2 with clear message', async (t) => {
  const r1 = await runCLI(['execute', '--intent', 'x', '--max-budget', 'abc'], env());
  t.assert.strictEqual(r1.code, 2);
  t.assert.match(r1.stderr, /--max-budget must be a number/);

  const r2 = await runCLI(['status', '--timeout', 'abc'], env());
  t.assert.strictEqual(r2.code, 2);
  t.assert.match(r2.stderr, /--timeout must be a number/);

  const r3 = await runCLI(['status', '--bogus-flag'], env());
  t.assert.strictEqual(r3.code, 2);
  t.assert.match(r3.stderr, /unknown flag/);
});

test('--version prints version and exits 0', async (t) => {
  const r = await runCLI(['--version'], env());
  t.assert.strictEqual(r.code, 0);
  const pkg = require('../package.json');
  t.assert.strictEqual(r.stdout.trim(), `callx402 ${pkg.version}`);
});

test('--help exits 0 and documents commands', async (t) => {
  const r = await runCLI(['--help'], env());
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout, /callx402 <command>/);
  t.assert.match(r.stdout, /Exit codes: 0 ok/);
});

test('<command> --help prints that command usage, not the global help', async (t) => {
  const r = await runCLI(['recover', '--help'], env());
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout, /callx402 recover/);
  t.assert.match(r.stdout, /PAYLOAD_VEYLINE_RECOVERY=1/);
  t.assert.doesNotMatch(r.stdout, /callx402 <command>/);
  const r2 = await runCLI(['resolve', '--help'], env());
  t.assert.strictEqual(r2.code, 0);
  t.assert.match(r2.stdout, /settlement UNKNOWN, exit 5/);
});

test('rail-only paid action as command -> exit 2 with routing hint', async (t) => {
  const r = await runCLI(['safe_retry'], env());
  t.assert.strictEqual(r.code, 2);
  t.assert.match(r.stderr, /unknown command 'safe_retry'/);
  t.assert.match(r.stderr, /paid on-demand rail action, not a CLI command/);
  t.assert.match(r.stderr, /problem-map\.md/);
});

test('human-readable (non-JSON) output is concise', async (t) => {
  const r = await runCLI(['status'], env());
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout, /callx402 status:/);
  t.assert.match(r.stdout, /doctor/);
});
