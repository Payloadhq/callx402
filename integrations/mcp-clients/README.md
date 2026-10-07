# callx402 MCP server — client setup

The callx402 MCP server (`mcp/index.js` in this repo) exposes 6 production-safe,
**read-only** diagnostic tools over stdio JSON-RPC. Zero dependencies (node
stdlib only). Nothing charges, executes, retries, or repays.

| Tool | Use it when |
|---|---|
| `x402_diagnose` | Something went wrong with an x402 payment; need the diagnosis |
| `x402_evidence` | First step in any incident: ground truth from recorded evidence |
| `x402_explain` | Need a plain-language state assessment before deciding what to do |
| `x402_recover` | Paid but no result; need the safe recovery decision (read-only) |
| `x402_resolve` | Settlement state is uncertain; resolve from evidence, not blind retry |
| `x402_status` | Verify the diagnostic subsystems are reachable |

Tool names are namespaced `x402_*` — never `call_x402` (live collision on the
fiatdock marketplace).

## Install the server

```sh
git clone https://github.com/Payloadhq/callx402
cd callx402
# no npm install needed for the MCP server: node stdlib only
```

## Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "callx402": {
      "command": "node",
      "args": ["/absolute/path/to/callx402/mcp/index.js"]
    }
  }
}
```

Restart Claude Desktop. Ask it to "list MCP tools" to confirm the six
`x402_*` tools appear.

## Cursor

Add to `~/.cursor/mcp.json` (user scope) or `.cursor/mcp.json` (project scope):

```json
{
  "mcpServers": {
    "callx402": {
      "command": "node",
      "args": ["/absolute/path/to/callx402/mcp/index.js"]
    }
  }
}
```

Cursor picks it up on next launch (or toggle the server in
Cursor Settings → MCP). Because the tools are read-only, they are safe to
enable for every workspace.

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "callx402": {
      "command": "node",
      "args": ["/absolute/path/to/callx402/mcp/index.js"]
    }
  }
}
```

Restart Windsurf. The server appears under MCP servers; the six `x402_*`
tools are then available to Cascade.

## Any stdio MCP client

```json
{ "command": "node", "args": ["/absolute/path/to/callx402/mcp/index.js"] }
```

## Smoke test (no client needed)

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node mcp/index.js
```

You should see a `tools/list` result naming all six `x402_*` tools.

## Environment

- `CALLX402_TIMEOUT_MS` — per-tool timeout (default 30000)
- `CALLX402_CONFIG` — config file path
- `CALLX402_V2_ROOT` — v2 root override
- `CALLX402_CORE_PATH` — core dispatcher path (test seam)

## From the free diagnostics to paid on-demand

These local tools are the free read-only surface. When an agent needs the
hosted on-demand actions (paid per action, x402 USDC on Base or Stripe, or
metered under a Veyline subscription), the machine front door is
https://payloadhq.github.io/agents.json — 13 actions, live fee schedule,
payment paths, and fail-closed rules.

## Registry installs (when published)

`server.json` at the repo root declares this server for the Official MCP
Registry (`io.github.payloadhq/callx402`), which unlocks one-click installs
in Smithery, Glama, and registry-aware clients. Until the npm package and
registry entry are published, use the git-clone stdio configs above.
