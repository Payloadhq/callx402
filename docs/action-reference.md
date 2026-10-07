# Callx402 Action Reference

**Version:** 0.1.0 · **Status:** staged for review, not published · **Verified against:** `cli-help-verified-2026-10-06.txt`, `SPEC.md`, `core/` action implementations, and the `node --test` suite on 2026-10-06.

Every entry follows the same fields. "CAN IT MOVE MONEY?" and "CAN IT CREATE OR RETRY AN AUTHORIZATION?" are answered against the actual implementation, not the action's name. VERIFICATION STATUS cites the test files that exercise the action; the full suite is green (see the per-entry notes for skips).

Shared notes for all actions:

- Every dispatch returns the SPEC section 4 result envelope (`ok`, `action`, `disposition`, `subsystem`, `subsystemStatus`, `data`, `settlement`, `txHash`, `receipt`, `idempotencyKey`, `deduped`, `error`). CLI adds `--json` to print it; the default is a concise human-readable summary.
- Exit codes: 0 ok · 1 failure · 2 usage · 3 disabled/unreachable · 4 budget refused · 5 settlement unknown.
- Before dispatch, callx402 checks the subsystem's `enabled()` flag. If it is off, the action exits 3 naming the flag and does nothing. Nothing that guards money movement is ever force-enabled.
- Feature flags default to off. On a fresh checkout, `callx402 status` reports 15/15 subsystems reachable, 0/15 enabled.

---

## diagnose

- **ACTION:** `diagnose`
- **PURPOSE:** Run the x402 doctor over supplied evidence to determine what failed in an x402 or MCP flow. [implementation]
- **WHEN TO USE IT:** A paid request or MCP tool call failed and you need a deterministic classification of the failure stage from the evidence you already have.
- **INPUT:** `--target ...` or `--evidence <json|@file>` (the two are merged; JSON may be inline or read from a file with `@path`). HTTP: `POST /diagnose` with `target` and/or an `evidence` object.
- **OUTPUT:** The envelope with `data.report` holding the doctor report (stages, `whatFailed` classification), and a disposition like "Diagnosis complete: \<stage\>". `settlement` is null.
- **SIDE EFFECTS:** None. The doctor evaluates stages deterministically from the supplied evidence; it performs no live probing and changes no state.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** doctor subsystem disabled or unreachable → exit 3 naming the flag; malformed evidence JSON → exit 2 ("malformed evidence JSON"); `--timeout` firing → exit 1.
- **EXAMPLE:** `callx402 diagnose --evidence '{"txHash":"0xabc..."}' --json` (command form from the verified CLI; the envelope's `data.report` carries the real stage classification).
- **CURRENT LIMITATIONS:** The diagnosis is only as good as the evidence supplied; the doctor does not gather evidence itself.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "diagnose: disabled subsystem -> exit 3, honest disabled envelope", "diagnose: enabled -> exit 0, real doctor report with stages", "malformed input: bad JSON evidence -> exit 2 with clear message".

## doctor

- **ACTION:** `doctor`
- **PURPOSE:** Alias of `diagnose`. Runs the same MCP doctor dispatch.
- **WHEN TO USE IT:** Same as `diagnose`; the shorter name for interactive use.
- **INPUT / OUTPUT / SIDE EFFECTS:** Identical to `diagnose`. Note: the envelope's `action` field is `"diagnose"`, because the alias funnels through the same handler. [implementation]
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Same as `diagnose`.
- **EXAMPLE:** `callx402 doctor --json`
- **CURRENT LIMITATIONS:** Same as `diagnose`.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "doctor: alias of diagnose -> envelope action is diagnose", "doctor dispatch executes real runMcpDoctor and returns stages".

## rescue

- **ACTION:** `rescue`
- **PURPOSE:** Incident triage for stuck or failed x402 transactions: detect the incident, quote the rescue, and present the free-vs-paid offer. [implementation]
- **WHEN TO USE IT:** A transaction appears stuck or failed and you want a read-only triage plus a costed quote before deciding what to do.
- **INPUT:** `--incident <id>` (matched against the detected incident's id or type); optional `--network`; optional `--auth` flag. Authorization is accepted from `--auth`, config `authToken`/`rescueAuth`, or `CALLX402_AUTH_TOKEN`. HTTP: `POST /rescue` with `incidentId`.
- **OUTPUT:** The envelope with `data.incident`, `data.quote`, `data.offer`, and `data.version`; disposition "Rescue triage (free, read-only): \<type\>. Paid execution was NOT performed; quote requires explicit paid engagement."
- **SIDE EFFECTS:** None. Even with auth, the dispatch runs detection and quoting only; paid execution is never performed by this command.
- **CAN IT MOVE MONEY?** No. The command is read-only with or without auth; detection and quote tiers are free.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** No authorization supplied → `auth_required`, exit 3 ("Detection/quote tiers are free and read-only; execution never happens without auth."); rescue subsystem disabled or unreachable → exit 3.
- **EXAMPLE:** `callx402 rescue --incident inc_123 --auth --json` (auth may also come from config or env; without it the command refuses with exit 3).
- **CURRENT LIMITATIONS:** Triage and quotes only. Performing an actual paid rescue is a paid on-demand callx402 action (per-action fee; see https://payloadhq.github.io/agents.json) — this local command performs triage only and never executes it.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "rescue: enabled but no auth -> auth_required, exit 3, nothing executed", "rescue: with --auth -> real rescue triage, read-only, exit 0", "rescue dispatch calls the real rescue module surface; no token -> auth_required exit 3".

## route

- **ACTION:** `route`
- **PURPOSE:** Select a tool or route for a goal under a routing policy, using the smart router over ranked candidates. [implementation]
- **WHEN TO USE IT:** You have a goal with cost constraints and want the cheapest viable route selected before any spend decision.
- **INPUT:** `--goal <text>` (required); `--speed fast|balanced|cheap` maps to `FASTEST_VERIFIED` / `LOWEST_TOTAL_COST` / `BEST_VALUE` (default `BEST_VALUE`); optional `--networks`, `--assets`, `--candidates`, `--paths`. HTTP: `POST /route` with `goal`. Candidates come from the capability graph when it is enabled, otherwise from an explicit candidate set.
- **OUTPUT:** The envelope with `data.goal`, `data.policy`, `data.ranked`, `data.selected`, and `data.pathChoice`; disposition "Route selected under \<policy\> policy. Selection only: nothing executed, no money moved."
- **SIDE EFFECTS:** None. Selection only.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Missing `--goal` → exit 2; router disabled or unreachable → exit 3. With no candidates at all, the action is honest ("No candidate tools available... No route selected; nothing executed.") and still exits 0.
- **EXAMPLE:** `callx402 route --goal "fetch 100 product prices for under $0.50" --speed cheap --json`
- **CURRENT LIMITATIONS:** Without registered tools in the capability graph (experimental; requires `PAYLOAD_MCP_FABRIC=1`) there is nothing to rank, so routing returns an honest no-route result. Route selects; it never executes.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "route: disabled subsystem -> exit 3", "route: enabled, no candidates -> honest no-route, exit 0", "route: missing --goal -> usage error, exit 2", "router dispatch honors the fast speed policy", "router dispatch runs real selectTool/rankTools over candidates".

## resolve

- **ACTION:** `resolve`
- **PURPOSE:** Resolve the settlement state of a payment from supplied evidence, using the settlement resolver. [implementation]
- **WHEN TO USE IT:** You need to know whether a payment actually settled before deciding to retry, repay, or deliver. This is the action to use for settlement questions.
- **INPUT:** `--evidence <json|@file>` (required form; empty evidence is accepted and yields UNKNOWN). HTTP: `POST /resolve` with an `evidence` object. The envelope's `txHash` is taken from `evidence.txHash` when present.
- **OUTPUT:** The envelope with `settlement` set to one of `DEFINITELY_PAID`, `DEFINITELY_NOT_PAID`, `AUTHORIZED_NOT_SETTLED`, `SETTLEMENT_PENDING`, `CONFLICT`, or `UNKNOWN` (the implementation's states, from `lib/settlement-resolver.js`), plus `data.resolution` with the full resolution and confidence. When the state is UNKNOWN, the envelope is `ok:false` with code `settlement_unknown` and the disposition instructs manual resolution.
- **SIDE EFFECTS:** None. Resolution is read-only analysis; it never retries, repays, or touches the chain.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No. Explicitly: "resolve(evidence) is read-only analysis; never retries or repays."
- **FAIL-CLOSED CONDITIONS:** Empty or inconclusive evidence → settlement UNKNOWN, exit 5; settlement subsystem disabled or unreachable → exit 3; malformed evidence JSON → exit 2. Over HTTP, UNKNOWN maps to status 409.
- **EXAMPLE:** `callx402 resolve --evidence '{"txHash":"0xabc..."}' --json`
- **CURRENT LIMITATIONS:** Resolution quality depends entirely on the evidence supplied; with no evidence the honest answer is UNKNOWN. State names in SPEC section 4 (`PENDING`) differ from the code (`SETTLEMENT_PENDING`); the code's names are what the implementation returns.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "resolve: disabled subsystem -> exit 3", "resolve: empty evidence -> settlement UNKNOWN, exit 5", "settlement dispatch resolves real states (DEFINITELY_PAID evidence)". `test/safety.test.js`: "settlement UNKNOWN: exit 5, fail-closed, no retry/repay instruction".

## execute

- **ACTION:** `execute`
- **PURPOSE:** Run the 10-stage intent pipeline: idempotency dedupe, intent parsing, tool discovery, costed planning, SpendGuard budget check, route selection, execution (only with a live route), effect proof, settlement resolution, and RevRule event emission. [implementation]
- **WHEN TO USE IT:** You want a natural-language intent turned into a budgeted, guarded plan, and (once a live route exists) executed under explicit budget control.
- **INPUT:** `--intent <text>` (required); `--max-budget N`, `--approval-threshold N`, `--dry-run`, `--idempotency-key K`, `--approve`, `--force-retry`/`--retry`, `--speed fast|balanced|cheap`, `--risk low|medium|high`, `--networks`, `--assets`, `--providers`, `--deadline`, `--timeout`. Budget defaults come from config (default $1.00) and from budget hints parsed out of the intent text (e.g. "under $1"). HTTP: `POST /call` with the same option keys.
- **OUTPUT:** The envelope with `data.stages` (every stage recorded with status and detail: idempotency, intent, capabilities, planner, spendguard, budget, router, execution, effect_proof, settlement, delivery, revrule), `data.plannedCost`, `data.maxBudget`, `data.route`, `data.executed`, `data.dryRun`. `settlement` and `receipt` are populated only on real execution. A duplicate `idempotencyKey` returns the original stored result with `deduped:true`.
- **SIDE EFFECTS:** Budget-gated. Over-budget plans refuse with exit 4 and zero side effects. Planned cost above the approval threshold without `--approve` (unless `--dry-run`) refuses with exit 4. `--dry-run` guarantees planning only. **Current build:** the dispatch layer wires no live tool endpoints, so the execution stage reports "no executable route available," moves no money, issues no effect proof, and settles nothing. The RevRule stage emits a planning event to a memory sink (idempotent; a real sink only under `PAYLOAD_REVRULE_EVENTS=1`).
- **CAN IT MOVE MONEY?** It is the only action designed with execution side effects, and it is budget-gated, dry-run capable, and idempotent. In the current build it cannot move money: no live executable route is wired, so execution honestly does not happen. [implementation, tested]
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No in the current build. `--force-retry` after a stored run whose settlement is UNKNOWN is explicitly refused (`unsafe_retry_refused`, exit 5) to prevent double-spend.
- **FAIL-CLOSED CONDITIONS:** Missing `--intent` → exit 2; over budget → exit 4, zero side effects; above approval threshold without `--approve` → exit 4; retry after UNKNOWN → exit 5; individual stages (intent engine, planner, router, kernel) disabled or unreachable are recorded in `data.stages` and planning continues honestly.
- **EXAMPLE:** `callx402 execute --intent "complete this job for under $1" --max-budget 1.00 --dry-run --idempotency-key job-42 --json`
- **CURRENT LIMITATIONS:** No live executable route is wired in this build; `execute` currently plans honestly and stops. Effect proofs, settlement resolution, and receipts are only populated on real execution. Live execution would require a wired route plus an enabled execution kernel.
- **VERIFICATION STATUS:** Tested. `test/intent-pipeline.test.js` (8 tests, incl. "execute: dry-run intent -> exit 0, honest no-route disposition", "cost above approval threshold without --approve fails closed, exit 4", "explicit --approve passes the threshold gate", "over-budget intent -> budget_refused, exit 4, zero side effects", "duplicate idempotencyKey: second call deduped with ORIGINAL result", "unsafe retry refusal", "intent pipeline walks stages in order", "networks/assets/providers constrain planner, router and spendguard"). `test/safety.test.js` (7 tests) covers the money-safety invariants end to end. Real CLI run verified 2026-10-06: intent-mode dispatch returns the honest "no executable route available" disposition with per-stage detail.

## monitor

- **ACTION:** `monitor`
- **PURPOSE:** Report a Sentinel snapshot of x402 incident state, once or as a stream. [implementation]
- **WHEN TO USE IT:** You want a point-in-time view of tracked incidents, or a live stream of snapshots while watching an incident window.
- **INPUT:** `--once` (single snapshot; the default behavior) or `--watch` (stream snapshots, JSON lines, until interrupted), optional `--interval`/`--intervalMs` (default 5000 ms).
- **OUTPUT:** The envelope with `data.snapshot` (`inert`, `enabled`, `incidentTypes`, note). Default state is an inert sentinel: "Sentinel snapshot (inert): no live tracking." unless `PAYLOAD_SENTINEL=1` enables the live tracker.
- **SIDE EFFECTS:** None. Read-only snapshot.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** sentinel subsystem disabled or unreachable → exit 3; `--timeout` cuts off `--watch` → exit 1.
- **EXAMPLE:** `callx402 monitor --once --json`
- **CURRENT LIMITATIONS:** The default sentinel is inert; incident types are reported from the module's `INCIDENT_TYPES` keys, not from live tracking, unless the flag is enabled.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "monitor: disabled sentinel -> exit 3", "monitor: inert sentinel snapshot -> exit 0", "timeout via CLI --timeout: monitor --watch is cut off -> exit 1".

## status

- **ACTION:** `status`
- **PURPOSE:** Report per-subsystem reachability, enabled state, feature flag, version, and an honest note for all 15 subsystem handles. [implementation]
- **WHEN TO USE IT:** Before anything else: to see what is actually available and which flags to set.
- **INPUT:** None (optional `--json`).
- **OUTPUT:** The envelope with `data.version`, `data.v2Root`, and `data.subsystems` (per subsystem: `reachable`, `enabled`, `flag`, `version`, `note`, `subsystemStatus`, optional `error`); disposition like "callx402 status: 15/15 subsystems reachable, 0/15 enabled."
- **SIDE EFFECTS:** None. Requires nothing; works even when every subsystem is disabled. In remote mode it reports over HTTP. HTTP: `GET /health` serves the same report.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** A subsystem whose `require` fails is reported `unreachable` with the error; one whose `enabled()` throws is reported `disabled`. `status` itself always exits 0 on success. Real run 2026-10-06: 15/15 reachable, 0/15 enabled, exit 0.
- **EXAMPLE:** `callx402 status --json`
- **CURRENT LIMITATIONS:** Reports availability only; it does not enable anything.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "status: exit 0, all subsystems reported". `test/subsystems.test.js` covers the reachability/enabled/flag reporting.

## preflight

- **ACTION:** `preflight`
- **PURPOSE:** Run the MCP preflight checks over a supplied context before a paid run. [implementation]
- **WHEN TO USE IT:** Before spending: validate the setup (checks run deterministically on the supplied context).
- **INPUT:** Supplied context via args (`--ctx` form; the help surface documents the command with no extra flags). Optional `--json`.
- **OUTPUT:** The envelope with `data.report` holding the preflight report; disposition "Preflight checks complete."
- **SIDE EFFECTS:** None. Deterministic checks on supplied context.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** preflight subsystem disabled or unreachable → exit 3.
- **EXAMPLE:** `callx402 preflight --json`
- **CURRENT LIMITATIONS:** Checks evaluate supplied context only; they do not provision or repair anything.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "preflight: disabled -> exit 3; enabled -> exit 0 with report".

## inspect

- **ACTION:** `inspect`
- **PURPOSE:** Look up tools in the capability graph by query, or report capability-graph statistics. [implementation]
- **WHEN TO USE IT:** To see what tools the graph knows about and how they perform, or to find candidates for a goal before routing.
- **INPUT:** `--query <text>` (optional). Without a query, returns graph stats only.
- **OUTPUT:** The envelope with `data.query`, `data.stats`, and `data.candidates`; disposition "Capability lookup for \"\<query\>\": N candidate(s)." or "Capability graph stats."
- **SIDE EFFECTS:** None. Lookups only.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** capability subsystem disabled or unreachable → exit 3. The graph itself is experimental: `createGraph()` throws unless `PAYLOAD_MCP_FABRIC=1`, which surfaces as a `failed` error, exit 1.
- **EXAMPLE:** `callx402 inspect --query "price feeds" --json`
- **CURRENT LIMITATIONS:** With no registered tools, lookups return zero candidates; the graph holds no tools until they are registered under the fabric flag.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "inspect: capability stats without query -> exit 0", "inspect: disabled -> exit 3".

## evidence

- **ACTION:** `evidence`
- **PURPOSE:** Show the recorded evidence for an operation from the Veyline operation ledger: its events, latest per-plane states, and protocols. [implementation]
- **WHEN TO USE IT:** You need the factual basis for an operation before explaining it, recovering it, or deciding anything about its settlement.
- **INPUT:** `<operationId>` (required positional); `--dir <path>` to point at a ledger directory (default `<cwd>/.veyline`); optional `--evidence <json|@file>` is accepted by the handler shape. Gate: `PAYLOAD_VEYLINE_LEDGER=1`.
- **OUTPUT:** The envelope with `data.operationId`, `data.events`, `data.states`, `data.protocols`, `data.eventCount`, and `data.basis` ("recorded ledger evidence", or "no_basis: no events recorded for this operation" when the operation is unknown). Unknown operations are honest, still exit 0.
- **SIDE EFFECTS:** None. Ledger reads only.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Veyline modules unreachable → exit 3; flag off (`PAYLOAD_VEYLINE_LEDGER=1` not set) → exit 3 ("veyline disabled: nothing executed."); missing `operationId` → exit 2.
- **EXAMPLE:** `callx402 evidence op_123 --dir ./.veyline --json`
- **CURRENT LIMITATIONS:** Reads only the ledger at `--dir` (or a shared file-backed cache); if nothing was recorded for the operation, there is no basis for claims. The Veyline recovery modules resolve from `CALLX402_VEYLINE_ROOT`, config `veylineRoot`, or the default relative path.
- **VERIFICATION STATUS:** Tested. `test/veyline-commands.test.js` (12 tests, incl. "evidence: disabled flag -> exit 3, nothing executed", "evidence: reports recorded events for a known operation", "evidence: unknown operation is honest no_basis, still exit 0").

## explain

- **ACTION:** `explain`
- **PURPOSE:** Explain an operation's state in plain language from its recorded ledger evidence. [implementation]
- **WHEN TO USE IT:** You have an operationId and want a human-readable assessment of where it stands, without reading the raw event log.
- **INPUT:** `<operationId>` (required positional); `--dir <path>` (default `<cwd>/.veyline`); optional `--evidence <json|@file>`. Gate: `PAYLOAD_VEYLINE_LEDGER=1`.
- **OUTPUT:** The envelope with `data.operationId`, `data.states` (payment, execution, delivery planes), `data.assessment`, `data.trail` (one line per event), and `data.eventCount`. Assessments: `NO_BASIS` (nothing recorded, no claim can be made), `INCOMPLETE` (a plane is UNKNOWN: do not retry, do not repay), `KNOWN_SAFE` (paid, executed, delivered), `RECOVERY_CANDIDATE` (delivery lost: run `recover`), `PARTIAL` (some planes resolved, some not).
- **SIDE EFFECTS:** None. Ledger reads only.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Same gating as `evidence`: unreachable modules → exit 3; flag off → exit 3; missing `operationId` → exit 2.
- **EXAMPLE:** `callx402 explain op_123 --json`
- **CURRENT LIMITATIONS:** The assessment is derived from recorded events only; `NO_BASIS` means no claim can be made. `INCOMPLETE` explicitly instructs: do not retry, do not repay; gather fresh evidence or escalate to human review.
- **VERIFICATION STATUS:** Tested. `test/veyline-commands.test.js`: "explain: missing operationId -> usage error", "explain: plain-language assessment of an operation".

## recover

- **ACTION:** `recover`
- **PURPOSE:** Report the safe recovery decision the network would make for an operation: `RECOVERABLE`, `SAFE_RETRY`, `EXECUTED_BUT_UNRECOVERABLE`, or `SETTLEMENT_UNKNOWN`, mapped to `KNOWN_SAFE` or `HUMAN_REVIEW`. Read-only; it never charges, never executes, never repays. [implementation]
- **WHEN TO USE IT:** Delivery was lost or an operation is otherwise incomplete and you need the safe recovery decision before any operator action. Performing the approved safe action stays with the operator's own adapters.
- **INPUT:** `<operationId>` (required positional); an operation identity, via `--identity <id>` or `--evidence` with `toolName`/`payer`/`paymentAuthFingerprint` (+`args`/`traceId`); `--dir <path>` for the shared file-backed recovery cache (default `<cwd>/.veyline`). Gate: `PAYLOAD_VEYLINE_RECOVERY=1`.
- **OUTPUT:** The envelope with `data.operationId`, `data.decision` (recovery state and reasoning), and `data.terminal` (`KNOWN_SAFE` or `HUMAN_REVIEW`); disposition "Recovery decision for \<id\>: \<state\> -> \<terminal\>. Read-only: nothing charged, nothing executed."
- **SIDE EFFECTS:** None. Reports the decision; takes no action.
- **CAN IT MOVE MONEY?** No. The file header states it explicitly: it never charges, never executes, never repays.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Flag off (`PAYLOAD_VEYLINE_RECOVERY=1` not set) → exit 3; Veyline modules unreachable → exit 3; missing identity and insufficient evidence fields → exit 2; unknown identity with no evidence → `SETTLEMENT_UNKNOWN` (never a repay).
- **EXAMPLE:** `callx402 recover op_123 --identity op-identity-abc --json`
- **CURRENT LIMITATIONS:** The decision is advisory; performing the safe action is the operator's responsibility with their own adapters. Cache sharing between CLI and server depends on `--dir` pointing at the same recovery substrate.
- **VERIFICATION STATUS:** Tested. `test/veyline-commands.test.js`: "recover: RECOVERABLE decision returned read-only with the prior result", "recover: builds the identity from evidence fields when --identity is absent", "recover: disabled flag -> exit 3", "recover: missing identity and insufficient evidence fields -> usage error", "recover: unknown identity with no evidence -> SETTLEMENT_UNKNOWN, never a repay".

## intent mode

- **ACTION:** `callx402 "natural language intent"` (bare quoted string, no command word)
- **PURPOSE:** The plain-language entry point: a quoted intent dispatches to `execute` and runs the intent pipeline. Plans, never executes blindly. [implementation, tested]
- **WHEN TO USE IT:** When the caller thinks in goals ("complete this job for under $1") rather than command names.
- **INPUT:** The quoted string is the intent text. Global options (`--json`, `--timeout`, `--dry-run`, `--max-budget`, `--idempotency-key`, `--speed`, `--risk`, `--networks`, `--assets`, `--providers`, `--deadline`, `--approval-threshold`, `--approve`, `--force-retry`) apply.
- **OUTPUT:** Same as `execute`: the envelope with `data.stages`, `data.plannedCost`, `data.maxBudget`, `data.route`, `data.executed`, `data.dryRun`.
- **SIDE EFFECTS:** Same as `execute`: budget-gated; none in the current build beyond RevRule planning-event emission to a memory sink.
- **CAN IT MOVE MONEY?** Same as `execute`: designed budget-gated; cannot in the current build (no live route wired).
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No in the current build; retry after UNKNOWN is refused.
- **FAIL-CLOSED CONDITIONS:** Same as `execute`: empty intent text → exit 2; over budget → exit 4; retry after UNKNOWN → exit 5.
- **EXAMPLE:** `callx402 "complete this job for under $1" --dry-run --json`
- **CURRENT LIMITATIONS:** Same as `execute`. Real CLI run verified 2026-10-06: dispatches to `execute` and returns the honest "no executable route available" disposition with per-stage detail.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "intent mode: bare quoted string dispatches execute", "empty intent text -> usage error, exit 2".

## config

- **ACTION:** `config`
- **PURPOSE:** Manage callx402's local configuration: `list`, `get <key>`, `set <key> <value>`. [implementation]
- **WHEN TO USE IT:** To inspect or change defaults (budget, approval threshold, network, asset, mode, remote URL, auth token, v2 root, rescue auth) without editing files by hand.
- **INPUT:** `callx402 config list`, `callx402 config get <key>`, `callx402 config set <key> <value>`. Valid keys: `mode`, `remoteUrl`, `authToken`, `v2Root`, `defaultNetwork`, `defaultAsset`, `defaultBudgetUsd`, `approvalThresholdUsd`, `rescueAuth`. Handled directly by the CLI, not a core subsystem dispatch. Values persist to `~/.config/callx402/config.json` (override path with `CALLX402_CONFIG`); `CALLX402_*` environment variables override file values at runtime and are never persisted. Numeric keys (`defaultBudgetUsd`, `approvalThresholdUsd`) must be numbers; unknown keys are rejected. Unknown config subcommands are usage errors (exit 2).
- **OUTPUT:** Human-readable list or value; `set` rewrites the config file and shows the effective merged config.
- **SIDE EFFECTS:** Writes the operator's own config file only.
- **CAN IT MOVE MONEY?** No.
- **CAN IT CREATE OR RETRY AN AUTHORIZATION?** No.
- **FAIL-CLOSED CONDITIONS:** Unknown key → error, nothing written; invalid JSON in the config file → clear error at load; non-numeric value for a numeric key → error.
- **EXAMPLE:** `callx402 config set defaultBudgetUsd 2.00` then `callx402 config get defaultBudgetUsd`
- **CURRENT LIMITATIONS:** CLI only; not exposed over HTTP, and not reachable through the JS SDK (`action:'config'` passes SDK validation but the core rejects it as `unknown_action`) or the Python SDK (no helper). Defaults: mode `local`, default budget $1.00, approval threshold $5.00, rescue auth off.
- **VERIFICATION STATUS:** Tested. `test/cli-dispatch.test.js`: "config list/get/set round-trip with isolated config file".

---

## Cross-action notes

- **Only `execute` (and intent mode, which is `execute`) has execution side effects**, and it is budget-gated, dry-run capable, and idempotent. Every other action is read-only or, in rescue's case, triage-only.
- **Settlement UNKNOWN is the universal stop sign.** `resolve` surfaces it with exit 5; `execute` refuses `--force-retry` after it with exit 5; `recover` returns it as a decision, never a repay. No action in this reference will retry or repay on UNKNOWN.
- **Disabled subsystems exit 3 and name the flag.** Typical flags: `PAYLOAD_SENTINEL=1` (monitor), `PAYLOAD_MCP_FABRIC=1` (intent parsing, capability graph), `PAYLOAD_MCP_PLANNER=1` (planner), `PAYLOAD_SETTLEMENT_RESOLVER=1` (resolve), `PAYLOAD_VEYLINE_LEDGER=1` (evidence, explain), `PAYLOAD_VEYLINE_RECOVERY=1` (recover). `callx402 status` reports them all.
- **HTTP coverage is a subset:** `POST /call` (execute), `/rescue`, `/route`, `/resolve`, `/diagnose`, plus `GET /health` and `GET /openapi.json`. `monitor`, `status` (as POST), `preflight`, `inspect`, `evidence`, `explain`, `recover`, and `config` are CLI/SDK only.
- **UNVERIFIED:** the exact flag names above were read from `core/subsystems.js` notes and `status` output; individual subsystem `FLAG` constants live in the v2.0.0 tree and were spot-checked, not exhaustively re-verified for all 15 subsystems on 2026-10-06. Nothing in this reference invents behavior beyond what `core/`, `bin/`, `server/`, and the test suite establish.
