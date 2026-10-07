#!/usr/bin/env node
'use strict';
/**
 * callx402 drift check (node stdlib only).
 *
 * Compares the live implementation against the documented surface:
 *   1. `bin/callx402.js --help` vs docs/cli-help-verified-2026-10-06.txt
 *   2. core/index.js ACTIONS registration (+ runAction switch cases) vs the
 *      documented action surface (docs/action-reference.md when published;
 *      docs/README.md section 4 "Current action surface" until then)
 *   3. server/openapi.yaml route paths vs the HTTP table in docs/README.md
 *
 * Exit 0: clean. Exit 1: drift found; a diff report is printed.
 *
 * Usage: node scripts/drift-check.js   (run from the callx402 repo root)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const VERIFIED_HELP = path.join(ROOT, 'docs', 'cli-help-verified-2026-10-06.txt');
const README = path.join(ROOT, 'docs', 'README.md');
const ACTION_REF = path.join(ROOT, 'docs', 'action-reference.md');
const CORE_INDEX = path.join(ROOT, 'core', 'index.js');
const OPENAPI = path.join(ROOT, 'server', 'openapi.yaml');
const SERVER_INDEX = path.join(ROOT, 'server', 'index.js');
const BIN = path.join(ROOT, 'bin', 'callx402.js');

const findings = [];

function normLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
}

function checkHelpSurface() {
  let actual;
  try {
    actual = execFileSync(process.execPath, [BIN, '--help'], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 15000,
    });
  } catch (err) {
    findings.push('HELP: could not run bin/callx402.js --help: ' + err.message);
    return;
  }
  const actualLines = normLines(actual.trim());
  const verifiedLines = normLines(fs.readFileSync(VERIFIED_HELP, 'utf8').trim());

  const actualSet = new Set(actualLines);
  const verifiedSet = new Set(verifiedLines);
  const added = actualLines.filter((l) => !verifiedSet.has(l));
  const removed = verifiedLines.filter((l) => !actualSet.has(l));

  if (added.length === 0 && removed.length === 0) {
    console.log('[ok] CLI help matches ' + path.relative(ROOT, VERIFIED_HELP));
  } else {
    findings.push('HELP DRIFT: live --help differs from ' + path.relative(ROOT, VERIFIED_HELP));
    for (const l of removed) findings.push('  - removed: ' + l);
    for (const l of added) findings.push('  + added:   ' + l);
  }
}

function parseActionsFromCore() {
  const src = fs.readFileSync(CORE_INDEX, 'utf8');
  const m = src.match(/const\s+ACTIONS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) {
    findings.push('ACTIONS: could not parse ACTIONS array in core/index.js');
    return { registered: [], switchCases: [] };
  }
  const registered = [...m[0].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  // runAction switch: every `case '<name>':` between `function runAction` and the default.
  const runActionSrc = src.slice(src.indexOf('function runAction'));
  const switchCases = [...new Set([...runActionSrc.matchAll(/case\s+'([a-z]+)'\s*:/g)].map((x) => x[1]))];
  return { registered, switchCases };
}

function parseDocumentedActions() {
  // Prefer the full action reference page; fall back to the README landing
  // index's current-action-surface listing while that page is still planned.
  if (fs.existsSync(ACTION_REF)) {
    const src = fs.readFileSync(ACTION_REF, 'utf8');
    const names = [...new Set([...src.matchAll(/^#{1,3}\s+`?([a-z]+)`?/gm)].map((x) => x[1]))];
    return { names, source: 'docs/action-reference.md' };
  }
  const src = fs.readFileSync(README, 'utf8');
  const section = src.split('## 4. Action reference')[1];
  if (!section) {
    findings.push('ACTIONS: could not locate section 4 in docs/README.md');
    return { names: [], source: 'docs/README.md (missing section 4)' };
  }
  const block = section.split('## 5.')[0];
  const names = [...new Set([...block.matchAll(/`([a-z]+)`/g)].map((x) => x[1]))];
  return { names, source: 'docs/README.md (section 4; action-reference.md still planned)' };
}

function checkActionSurface() {
  const { registered, switchCases } = parseActionsFromCore();
  if (registered.length === 0) return;
  const { names: documented, source } = parseDocumentedActions();
  if (documented.length === 0) return;

  // config is a client-side CLI command (bin/callx402.js), not a core action;
  // it is documented separately and is not drift when excluded from ACTIONS.
  const docSet = new Set(documented.filter((n) => n !== 'config'));
  const codeOnly = registered.filter((a) => !docSet.has(a));
  const docsOnly = documented.filter((a) => a !== 'config' && !registered.includes(a));

  const switchOnly = switchCases.filter((c) => !registered.includes(c));
  const unregistered = registered.filter((a) => !switchCases.includes(a));

  const clean = codeOnly.length === 0 && docsOnly.length === 0 &&
    switchOnly.length === 0 && unregistered.length === 0;

  if (clean) {
    console.log(`[ok] core actions (${registered.length}) match documented surface (${source})`);
  } else {
    findings.push('ACTION DRIFT: core vs docs (' + source + ')');
    for (const a of codeOnly) findings.push('  - in core, not in docs: ' + a);
    for (const a of docsOnly) findings.push('  - in docs, not in core: ' + a);
    for (const a of switchOnly) findings.push('  - switch case not in ACTIONS list: ' + a);
    for (const a of unregistered) findings.push('  - ACTIONS entry with no switch case: ' + a);
  }
  if (!fs.existsSync(ACTION_REF)) {
    console.log('[info] docs/action-reference.md not published yet; compared against ' + source);
  }
}

function parseOpenApiPaths() {
  const src = fs.readFileSync(OPENAPI, 'utf8');
  // Top-level route paths are 2-space indented `/name:` lines under `paths:`.
  const inPaths = src.split(/^paths:/m)[1] || '';
  return [...inPaths.matchAll(/^  (\/[A-Za-z0-9._\-/{}]+):\s*$/gm)].map((x) => x[1]);
}

function parseDocumentedRoutes() {
  const src = fs.readFileSync(README, 'utf8');
  const section = src.split('### HTTP server')[1];
  if (!section) {
    findings.push('ROUTES: could not locate the HTTP table in docs/README.md');
    return [];
  }
  const rows = [...section.split('## ')[0].matchAll(/^\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`?(\/[^\s|`]+)`?/gm)];
  return rows.map((r) => ({ method: r[1], path: r[2] }));
}

function checkHttpSurface() {
  let openapiPaths;
  try {
    openapiPaths = parseOpenApiPaths();
  } catch (err) {
    findings.push('ROUTES: could not read server/openapi.yaml: ' + err.message);
    return;
  }
  const documented = parseDocumentedRoutes();
  if (documented.length === 0 && findings.length === 0) return;

  const openapiSet = new Set(openapiPaths);
  const documentedSet = new Set(documented.map((d) => d.path));

  const missingInDocs = openapiPaths.filter((p) => !documentedSet.has(p));
  const extraInDocs = [...documentedSet].filter((p) => !openapiSet.has(p));

  // Cross-check server implementation routes against openapi.yaml.
  const serverSrc = fs.readFileSync(SERVER_INDEX, 'utf8');
  const postRoutes = [...serverSrc.matchAll(/'(\/[a-z]+)'\s*:\s*'[a-z]+'/g)].map((x) => x[1]);
  const getRoutes = ['/health', '/openapi.json', '/openapi.yaml'];
  const implSet = new Set([...getRoutes, ...postRoutes]);
  const implNotInSpec = [...implSet].filter((p) => !openapiSet.has(p));
  const specNotInImpl = openapiPaths.filter((p) => !implSet.has(p));

  const clean = openapiPaths.length === documented.length &&
    missingInDocs.length === 0 && extraInDocs.length === 0 &&
    implNotInSpec.length === 0 && specNotInImpl.length === 0;

  if (clean) {
    console.log(`[ok] HTTP surface: ${openapiPaths.length} routes in openapi.yaml, ` +
      `all documented and all implemented (docs: ${documented.length})`);
  } else {
    findings.push(`ROUTE DRIFT: openapi.yaml has ${openapiPaths.length} route(s), ` +
      `docs README lists ${documented.length}`);
    for (const p of missingInDocs) findings.push('  - in openapi.yaml, not documented: ' + p);
    for (const p of extraInDocs) findings.push('  - documented, not in openapi.yaml: ' + p);
    for (const p of implNotInSpec) findings.push('  - implemented in server/index.js, not in openapi.yaml: ' + p);
    for (const p of specNotInImpl) findings.push('  - in openapi.yaml, not implemented in server/index.js: ' + p);
  }
}

checkHelpSurface();
checkActionSurface();
checkHttpSurface();

if (findings.length > 0) {
  console.log('\n=== DRIFT REPORT ===');
  for (const f of findings) console.log(f);
  console.log('=== DRIFT FOUND ===');
  process.exit(1);
} else {
  console.log('\nDRIFT CHECK: CLEAN');
  process.exit(0);
}
