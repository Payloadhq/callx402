# Callx402 Visual Library — Manifest

Staged for review. Nothing published. All terminal pixels below each prompt
line come from real runs of `~/workspace/products/callx402/bin/callx402.js`
(callx402 0.1.0) on 2026-10-06. Sample inputs are synthetic; outputs are real.
Raw captures live in `raw/` (one file per asset, exact CLI stdout).

Working directory for all runs: `~/workspace/products/callx402`.

## Assets

| # | File | Command (exact) | Status |
|---|------|-----------------|--------|
| 01 | [01-action-map.png](01-action-map.png) | `callx402 --help` | live-verified. Rendered from `../cli-help-verified-2026-10-06.txt`; live `--help` output verified byte-identical on 2026-10-06 (exit 0). |
| 02 | [02-diagnose.png](02-diagnose.png) | `PAYLOAD_MCP_DOCTOR=1 node bin/callx402.js diagnose --evidence '{"operationId":"op_visual_001","settlement":{"state":"failed","error":"insufficient_funds","transaction":null}}'` | live-verified (exit 0). Doctor subsystem genuinely dispatched against the v2.0.0 tree; doctor read the settlement evidence and reported `SETTLEMENT: settlement failed: insufficient_funds`. |
| 03 | [03-resolve.png](03-resolve.png) | `PAYLOAD_SETTLEMENT_RESOLVER=1 node bin/callx402.js resolve --evidence '{"operationId":"op_visual_002","txHash":"0x9f2a...a1b"}'` | live-verified (exit 5). Real money-safety behavior: settlement UNKNOWN, no auto-retry, no repay; operator override required. |
| 04 | [04-route.png](04-route.png) | `PAYLOAD_MCP_ROUTES=1 node bin/callx402.js route --goal "cheap reliable x402 settlement"` | live-verified (exit 0). Router ran; no candidate tools in the local capability graph, so no route selected and nothing executed. (`--candidates` is not a CLI flag in this build, so candidate-supplied routing cannot be exercised from the CLI.) |
| 05 | [05-preflight.png](05-preflight.png) | `PAYLOAD_MCP_PREFLIGHT=1 node bin/callx402.js preflight` | live-verified (exit 0). Plain run captured as specified. Note: the plain disposition reads "Preflight checks complete." while the `--json` envelope (verified separately, not pictured) shows verdict `BLOCKED` with per-check detail, because no MCP context was supplied. |
| 06 | [06-inspect.png](06-inspect.png) | `PAYLOAD_MCP_FABRIC=1 node bin/callx402.js inspect --json` | live-verified (exit 0). Real result envelope: local capability graph is empty (0 nodes, 0 edges, 0 tools). `inspect --query "x402 settlement"` was also tried and honestly failed with `intent-compiler: catalog must be a non-empty array` (empty catalog in this environment). |
| 07 | [07-status.png](07-status.png) | `node bin/callx402.js status` | live-verified (exit 0). Default environment: 15/15 subsystems reachable, 0/15 enabled (fail-closed by default). |
| 08 | [08-architecture.svg](08-architecture.svg) | n/a (diagram, not a CLI capture) | Factual only. Developer/Agent -> callx402 action layer -> per-action dispatch into v2.0.0 subsystems -> Veyline / x402 protocol / MCP infrastructure. Footnote states the verified facts: nothing here executes payments by itself; subsystems are disabled by default and each is enabled by its own `PAYLOAD_*` flag. |

## Verification notes

- Subsystem enablement: without its enable flag, every action fail-closes
  (verified on 2026-10-06: `subsystem_disabled`, exit 3, "Nothing was executed").
  Each flag is the one the CLI itself names in its disabled message
  (e.g. `PAYLOAD_MCP_DOCTOR=1`), so the enabled runs are the documented way to
  exercise the real code paths locally.
- The dispatch target is the real v2.0.0 tree at
  `~/workspace/products/x402-paid-api-starter-kit/v2.0.0` (per
  `core/subsystems.js` default `v2Root`); modules were genuinely required.
- Renderer: `render_terminal.py` (PIL, DejaVu Sans Mono, bg #181A20).
  Prompt lines reproduce the exact commands run; wrap-only, no text edits.
- No command output could not be captured: all 8 assets are built from real
  runs. The one deliberate choice: 05 shows the plain run (thin but exact);
  the richer `--json` preflight envelope exists in the raw capture history
  and can replace it if review prefers.
- Drift check: re-run these commands and diff against `raw/` before any
  publish; the editorial framework requires regenerating on CLI changes.
