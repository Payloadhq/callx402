# MCP Identity — DECISION DOCUMENT

**Status: DEFERRED.** No MCP server code ships in this pass. This document
records the proposed pattern and the reason the permanent identifier must not
be finalized yet.

## Proposed pattern (not final)

- MCP server name: tied to the future flagship brand (TBD).
- Tool name: `[future_brand]_call`.
- Tool description: "Call x402 infrastructure for routing, rescue, diagnosis,
  settlement resolution and execution."

## Why not `call_x402`

A live tool named exactly `call_x402` already exists on the fiatdock
marketplace. Publishing or registering another tool under that exact name
creates a real collision risk: users and agents cannot reliably tell the two
apart, and marketplace listings may conflict. Do not use the bare
`call_x402` tool name.

## Decision

**DO NOT FINALIZE the permanent MCP identifier until the flagship brand is
chosen.** When the brand lands, the MCP server takes the brand name and the
tool becomes `[brand]_call` with the description above. Until then, MCP
identity stays a deferred decision and no MCP server code is written.
