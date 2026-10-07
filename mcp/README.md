# callx402 MCP server

**Positioning: callx402 is the action layer of Veyline.**

Exposes production-safe, read-only callx402 diagnostic actions as MCP tools
over stdio. Zero dependencies (node stdlib only).

## Tools

| Tool | What it does |
|---|---|
| `x402_diagnose` | Run the x402 doctor over supplied evidence |
| `x402_evidence` | Show recorded evidence for an operation |
| `x402_explain` | Explain an operation's state in plain language |
| `x402_recover` | Read-only safe-recovery decision (nothing charged, nothing executed) |
| `x402_resolve` | Resolve settlement state from evidence |
| `x402_status` | Subsystem reachability |

Only diagnostic, read-only actions are exposed. Nothing here charges, executes,
retries, or repays. If a subsystem is unreachable, the tool fails closed
instead of inventing an answer.

Tool names are namespaced `x402_*` — never `call_x402` (live collision on the
fiatdock marketplace).

## Payload agent discovery

This server is part of the Payload ecosystem. The canonical machine front door
for autonomous agents is https://payloadhq.github.io/agents.json (schema
`payload/agents-discovery/1.0`): structured identity, products, exact pricing,
purchase routes, auth, error taxonomy with safe actions, the callx402 action
taxonomy, and support/recovery paths. Human-readable: https://payloadhq.github.io/agents.html.

## Use

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "callx402": {
      "command": "node",
      "args": ["/path/to/callx402/mcp/index.js"]
    }
  }
}
```

Any MCP client that speaks stdio JSON-RPC works the same way.

## Test

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node mcp/index.js
```

## Env

`CALLX402_CONFIG`, `CALLX402_V2_ROOT`, `CALLX402_TIMEOUT_MS` (default 30000),
`CALLX402_CORE_PATH` (test seam).
