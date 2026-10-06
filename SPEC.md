# callx402 — Universal Action Layer — Build Spec

**FUNDAMENTAL RULE: callx402 is the ACTION, not the product name.**
The flagship keeps a separate unique brand (forthcoming). Do NOT rename Sentinel,
Rescue, Doctor, Router, Valuator, SpendGuard, Settlement Resolver, MCP fabric,
RevRule, the Payload brand, or any marketplace listing. callx402 is an
access/dispatch layer that CALLS existing subsystems. Architecture:

```
UNIQUE PRODUCT BRAND  →  accessed through  →  callx402
```

## 1. Non-negotiables

- **NEVER modify** `~/workspace/products/x402-paid-api-starter-kit/v2.0.0/`. Import from it
  via relative require. Verify at the end with `git` status or a checksum spot-check
  that the tree is untouched (it is not a git repo necessarily; at minimum do not
  write any file under it).
- **Real working code only.** No placeholders, no stubs presented as functional.
  If a subsystem is feature-flag disabled or needs live infra that isn't reachable,
  the command must say so clearly and exit non-zero. Never fake success.
- **No logic duplication.** Every command dispatches into the existing subsystem.
- **Do NOT publish** to npm, PyPI, or Docker Hub. Packages must be publish-*ready*
  only. (npm `payloadtools` account suspended until 2026-10-07 12:14 CDT;
  PyPI blocked on owner's account + 2FA.)
- **Do NOT** create an MCP tool named exactly `call_x402` (collides with an existing
  live tool on the fiatdock marketplace). MCP identity stays a DEFERRED decision doc.
- Behavioral language only ("Need to diagnose x402? callx402."). Never claim
  exclusive trademark ownership of the phrase.
- Stdlib only for the core/CLI/HTTP server. No new external dependencies.
  (Python SDK: stdlib only — `subprocess`, `json`, `argparse`, `shutil`.)
- Node >= 18 (runtime here is v24.20.0). Python >= 3.9 (runtime 3.12.3).

## 2. Directory layout (all under ~/workspace/products/callx402/)

```
SPEC.md
package.json                  # name: callx402, version 0.1.0, MIT, bin {callx402: ./bin/callx402.js},
                              # main ./sdk/js/index.js, homepage + repository
                              # https://github.com/Payloadhq/callx402
bin/callx402.js               # CLI entry (shebang, stdlib only, requires ../core)
core/
  index.js                    # runAction(name, args, opts), runIntent(text, opts), getStatus()
  subsystems.js               # lazy require map of v2.0.0 modules + enabled() checks
  config.js                   # config file (~/.config/callx402/config.json, $CALLX402_CONFIG),
                              # env overrides (CALLX402_*), safe defaults
  envelope.js                 # result envelope builders + exit codes
  pipeline.js                 # intent pipeline stage orchestration
sdk/js/
  index.js                    # callx402({...}) -> Promise<result envelope>
sdk/python/
  pyproject.toml              # name callx402, version 0.1.0, console_scripts callx402,
                              # bundles ../bin + ../core as package data, invokes via node
  callx402/__init__.py        # callx402(...) -> dict (subprocess to bundled CLI --json)
  callx402/cli.py             # argparse main() -> same path
server/
  index.js                    # node:http server: GET /health, GET /openapi.json,
                              # POST /call /rescue /route /resolve /diagnose
  openapi.yaml
docs/
  README.md                   # callx402 is the action; flagship brand separate/forthcoming
  ACTION_LANGUAGE.md           # behavioral phrases
  MCP_IDENTITY.md             # DEFERRED decision doc
test/                         # (test agent) node --test suite
```

## 3. Subsystem module map (v2.0.0 root = ../../x402-paid-api-starter-kit/v2.0.0)

Default v2Root: `path.resolve(__dirname, '../../x402-paid-api-starter-kit/v2.0.0')`.
Overridable via `CALLX402_V2_ROOT` env or config `v2Root`. All requires lazy (inside
functions) so `status` can report per-module reachability.

| Subsystem          | Require path (from v2Root)        | Key exports |
|--------------------|----------------------------------|-------------|
| Sentinel           | `lib/sentinel/index.js`           | `createSentinel(opts)`, `createInertSentinel()`, `INCIDENT_TYPES`, `FLAG` (`PAYLOAD_SENTINEL`?), `enabled()` |
| Rescue             | `lib/rescue/index.js`             | `createRescue({...})`, `incidents`, `detector`, `actions`, `autorescue`, `receipts`, `pricing`, `RESCUE_VERSION`, `FLAG='PAYLOAD_RESCUE'`, `enabled()` |
| Doctor             | `lib/mcp/doctor.js`              | `runMcpDoctor(evidence)`, `classifyMcpFailure`, `STAGES`, `FLAG='PAYLOAD_MCP_DOCTOR'`, `enabled()` |
| Router             | `lib/mcp/smart-router.js`         | `selectTool`, `rankTools`, `normalizeCandidate`, `totalCost`, `POLICIES`, `DEFAULTS`, `enabled()` |
| Router (paths)     | `lib/mcp/route-decider.js`        | `choosePath`, `selectPath`, `expectedCost`, `enabled()` |
| Valuator           | `valuator/quote.js`               | inspect before use |
| SpendGuard         | `lib/mcp/spendguard.js`           | `createTaskSpendGuard({...})`, `DEFAULT_PHASES`, `enabled()` |
| Settlement Resolver| `lib/settlement-resolver.js`      | `resolve(evidence)`, `STATES`, `POLICY_MATRIX`, `createMockChain`, `createMockFacilitator`, `FLAG='PAYLOAD_SETTLEMENT_RESOLVER'`, `enabled()` |
| Intent Engine      | `lib/mcp/intent-engine.js`        | `parse(text)` / `parseIntent`, `createEngine`, `GOALS`, `enabled()` |
| Capability Graph   | `lib/mcp/capability-graph.js`     | `createGraph()` → `{upsertTool, getToolProfile, findTools, recordObservation, stats, save, load}`, `enabled()` |
| Economic Planner   | `lib/mcp/economic-planner.js`     | `planGoal(opts)`, `scorePlan`, `OBJECTIVES`, `DEFAULTS`, `enabled()` |
| MCP fabric         | `lib/mcp/index.js`                | `transactional, saga, spendguard, resultRecovery, effectProof, executionKernel, ...` |
| RevRule            | `lib/revrule-events.js`           | `createEmitter({sink, idempotencyRegistry})`, `buildEvent`, `createMemorySink`, `enabled()` |
| Preflight          | `lib/mcp/preflight.js`            | `runMcpPreflight`, `buildChecks`, `enabled()` |
| Effect Proof       | `lib/mcp/effect-proof.js`         | `issueEffectProof`, `verifyEffectProof`, `enabled()` |
| Execution Kernel   | `lib/mcp/execution-kernel.js`     | `createKernel`, `STATES`, `TERMINAL`, `enabled()` |
| Result Recovery    | `lib/mcp/result-recovery.js`      | `createRecoveryStore`, `createResultRecoveryCache`, `buildOperationIdentity`, `enabled()` |

**Flag rule:** every module exposes `enabled()` (checks `process.env[FLAG]==='1'`)
and `FLAG`. Before dispatch, call `enabled()`. If false, return
`subsystemStatus: 'disabled'` naming the flag — do NOT fake success.
(You may document that the user can export the flag; do not silently force-enable
anything that guards real money movement. Read-only/diagnostic modules may note
the flag to enable.)

**Status honesty:** `getStatus()` must report per subsystem: `reachable` (require
succeeded), `enabled` (flag on), `version` where available, and `note` for
prototype/stub status (e.g. rescue-service `_rescue-stub.js` exists — inspect and
report honestly; never present a stub as production).

## 4. Result envelope (JSON everywhere: CLI --json, SDKs, HTTP)

```json
{
  "ok": true,
  "action": "diagnose",
  "disposition": "human-readable outcome",
  "subsystem": "doctor",
  "subsystemStatus": "ok | disabled | unreachable | prototype",
  "data": {},
  "settlement": "DEFINITELY_PAID | DEFINITELY_NOT_PAID | AUTHORIZED_NOT_SETTLED | PENDING | CONFLICT | UNKNOWN | null",
  "txHash": "0x... | null",
  "receipt": {},
  "idempotencyKey": "string | null",
  "deduped": false,
  "error": { "code": "string", "message": "string" }
}
```

`error` is null on success. `ok:false` whenever `error` is set.

**Exit codes (CLI):** 0 ok · 1 generic failure · 2 usage/validation error ·
3 subsystem disabled or unreachable · 4 budget refused (SpendGuard) ·
5 settlement UNKNOWN (must never auto-retry/repay — surface and stop).

**Money-safety invariants (hard):**
- Settlement `UNKNOWN` → never auto-retry, never repay. Return exit 5 with
  instructions for manual resolution.
- An explicit `--force-retry`/`retry` flag on execute MUST be rejected when the
  prior settlement state is UNKNOWN (unsafe retry refusal).
- Over-budget intent → SpendGuard refusal, exit 4, zero execution side effects.
- Duplicate `idempotencyKey` → return the ORIGINAL stored result with
  `deduped:true`; do not re-execute. Use result-recovery store.

## 5. Config (`core/config.js`)

- File: `~/.config/callx402/config.json`, overridable by `$CALLX402_CONFIG`.
- Env overrides: `CALLX402_V2_ROOT`, `CALLX402_MODE` (local|remote),
  `CALLX402_REMOTE_URL`, `CALLX402_AUTH_TOKEN`, `CALLX402_DEFAULT_NETWORK`,
  `CALLX402_DEFAULT_ASSET`, `CALLX402_DEFAULT_BUDGET_USD`, `CALLX402_APPROVAL_THRESHOLD_USD`.
- `config get|set|list` via CLI (`callx402 config list`, `callx402 config set key value`).
- Safe defaults: mode local, no auto-spend, budget default 1.00 USD, approval
  threshold default 5.00 USD (above → require explicit `--approve` or fail closed).
- Remote mode: CLI/SDK dispatch via HTTP to a callx402 server (auth header when
  `CALLX402_AUTH_TOKEN` set). Unreachable remote → clear error, non-zero exit.

## 6. Intent pipeline (`core/pipeline.js`)

`runIntent(text, opts)` stages (each honest about availability):
1. **Intent Engine** `parse(text)` → structured intent (extract budget like
   "under $1" → maxBudget).
2. **Capability Graph** `findTools` → candidate tools.
3. **Economic Planner** `planGoal` → costed plan.
4. **SpendGuard** `createTaskSpendGuard` → budget check vs `maxBudget`
   (opts override; default from config). Over → refuse (exit 4).
5. **Router** `selectTool`/`choosePath` → route.
6. **x402/MCP execution** via execution kernel — ONLY if a live executable route
   exists; otherwise return `disposition: 'no executable route available'`
   with `subsystemStatus` honest, no fake execution.
7. **Effect Proof** `issueEffectProof`/`verifyEffectProof`.
8. **Settlement** `resolve` → settlement state recorded; UNKNOWN → exit 5 path.
9. **Delivery + Reconciliation** → receipt.
10. **RevRule** `createEmitter` → emit economic event (idempotent).

Options: `maxBudget, deadline, speed ('fast'|'balanced'|'cheap'), risk
('low'|'medium'|'high'), networks[], assets[], providers[], approvalThreshold,
idempotencyKey, timeoutMs, dryRun`.

`runAction(name, args, {deps}={})` — `deps` is an internal/test seam allowing
subsystem handle overrides. Document as internal.

## 7. CLI contract (`bin/callx402.js`)

```
callx402 <command> [args] [options]
callx402 "natural language intent"        # intent mode
callx402 --help | -h
callx402 --version | -v
callx402 status [--json]
callx402 diagnose [--target ...] [--json]
callx402 rescue --incident <id> [--json]  # auth-gated; without auth -> clear error
callx402 route --goal <text> [--json]
callx402 resolve --evidence <json|@file> [--json]
callx402 doctor [--json]
callx402 execute --intent <text> [--max-budget 1.00] [--dry-run] [--idempotency-key K]
callx402 monitor [--once|--watch] [--json]
callx402 preflight [--json]
callx402 inspect [--query <text>] [--json]
callx402 config list | get <k> | set <k> <v>
```
- Global: `--json` (envelope on stdout), `--timeout <ms>`.
- Unknown command → usage error, exit 2, list valid commands.
- Malformed input (bad JSON, bad flags) → exit 2 with clear message.
- Default (no --json): concise human-readable summary + key fields.

## 8. JS SDK (`sdk/js/index.js`)

```js
const { callx402 } = require('callx402'); // or require('./sdk/js')
const result = await callx402({
  intent: 'complete this job for under $1',
  maxBudget: 1.00, deadline: '2026-10-07T00:00:00Z',
  speed: 'balanced', risk: 'low',
  networks: ['base'], assets: ['USDC'], providers: [],
  approvalThreshold: 5.00, idempotencyKey: '...', timeoutMs: 30000, dryRun: false,
});
// result: envelope (see §4). Also export: callx402.version, callx402.status(), sub-actions
// callx402.diagnose(), .rescue(), .route(), .resolve(), .doctor(), .execute(), .monitor(), .preflight(), .inspect()
```
Requires `../..` core directly (same process). No duplication.

## 9. Python SDK (`sdk/python/`)

- `pyproject.toml`: name `callx402`, version `0.1.0`, `console_scripts: callx402 =
  callx402.cli:main`. Bundles `../../bin` + `../../core` as package data;
  at runtime finds `node` via `shutil.which('node')` and invokes the bundled
  `bin/callx402.js --json`. If node missing → clear RuntimeError.
- `callx402/__init__.py`: `def callx402(intent=None, max_budget=None, deadline=None,
  speed=None, risk=None, networks=None, assets=None, providers=None,
  approval_threshold=None, idempotency_key=None, timeout_ms=None, dry_run=False,
  action=None, **kwargs) -> dict`. Maps kwargs → CLI argv, parses stdout JSON.
  Internal helper module may be named `call_x402.py` ONLY if needed for
  snake_case conventions; the PUBLIC import stays `callx402`.
- `callx402/cli.py`: `main()` with argparse mirroring the node CLI surface
  (subset: command + common options + --json passthrough).

## 10. HTTP server (`server/index.js`, node:http only)

- `GET /health` → `{ok, version, subsystems: {...}}` (reuse getStatus).
- `GET /openapi.json` → serves openapi.yaml as JSON (convert or embed).
- `POST /call` → `{intent, maxBudget, deadline, speed, risk, networks, assets, providers, approvalThreshold, idempotencyKey, dryRun}` → runIntent.
- `POST /rescue` → `{incidentId, ...}` → rescue dispatch.
- `POST /route` → `{goal, ...}` → router dispatch.
- `POST /resolve` → `{evidence}` → settlement resolve.
- `POST /diagnose` → `{target/evidence}` → doctor dispatch.
- Auth: if `CALLX402_AUTH_TOKEN` set, require `Authorization: Bearer` — else 401.
- `openapi.yaml`: document all routes + envelope schema.

## 11. Docs

- `docs/README.md`: what callx402 is (the action), what it is not (not the product
  name), architecture diagram (brand → callx402 → subsystems), quickstart
  (install from GitHub, `callx402 status`, `callx402 "…"`, SDK snippets),
  money-safety rules, link to v2.0.0 subsystem docs.
- `docs/ACTION_LANGUAGE.md`: the five behavioral phrases, framed as usage
  language, explicitly NOT trademark claims.
- `docs/MCP_IDENTITY.md`: DEFERRED. Proposed pattern: server name tied to future
  flagship brand; tool `[future_brand]_call`; description "Call x402
  infrastructure for routing, rescue, diagnosis, settlement resolution and
  execution." Rationale for avoiding bare `call_x402` (live collision on
  fiatdock). Mark clearly: DO NOT FINALIZE until flagship brand chosen.

## 12. Definition of done (per builder)

- `node bin/callx402.js --help`, `--version`, `status` all work for real.
- Every command dispatches to the real subsystem or reports honestly why not.
- `npm install` works offline (zero deps). `npm link` exposes `callx402`.
- Python: `pip install -e ./sdk/python` works; `python -c "import callx402"`.
- No file written under v2.0.0. No publish attempted.
- Smoke-test every command you build and report the literal outputs.
