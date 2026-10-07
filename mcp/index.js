#!/usr/bin/env node
'use strict';
/**
 * callx402 MCP server — node stdlib ONLY, zero dependencies.
 *
 * Exposes production-safe, read-only callx402 diagnostic actions as MCP tools
 * over stdio (JSON-RPC 2.0), per the MCP 2024-11-05 protocol surface:
 *   initialize / notifications/initialized / tools/list / tools/call
 *
 * Tools (namespaced x402_*; never `call_x402` — live fiatdock collision):
 *   x402_diagnose  run the x402 doctor over supplied evidence
 *   x402_evidence  show recorded evidence for an operation
 *   x402_explain   explain an operation's state in plain language
 *   x402_recover   read-only safe-recovery decision (nothing charged/executed)
 *   x402_resolve   resolve settlement state from evidence
 *   x402_status    subsystem reachability
 *
 * Only read-only / diagnostic actions are exposed. Actions with side effects
 * (execute, rescue mutations) are intentionally NOT tools here.
 *
 * Usage (Claude Desktop / MCP client config):
 *   { "command": "node", "args": ["/path/to/callx402/mcp/index.js"] }
 * Env: CALLX402_CONFIG, CALLX402_V2_ROOT, CALLX402_TIMEOUT_MS (default 30000).
 */
const readline = require('node:readline');

const VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'callx402';
const TIMEOUT_MS = Number(process.env.CALLX402_TIMEOUT_MS || 30000);

const core = require(process.env.CALLX402_CORE_PATH ||
  require('node:path').join(__dirname, '..', 'core'));

/* ------------------------------------------------------------------ */
/* Tool definitions: name, description, input schema, core action.     */
/* ------------------------------------------------------------------ */
const TOOLS = [
  {
    name: 'x402_diagnose',
    action: 'diagnose',
    description:
      'Run the x402 doctor over supplied evidence. Use when something went ' +
      'wrong with an x402 payment or MCP/x402 interaction and you need a ' +
      'diagnosis. Input: evidence as a JSON string or object describing the ' +
      'failure (error strings, responses, tx hashes). Read-only. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.', 
    inputSchema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'string',
          description: 'JSON string (or @file path) describing the failure evidence.',
        },
        target: {
          type: 'string',
          description: 'Optional: URL or identifier of the x402 endpoint involved.',
        },
      },
      required: ['evidence'],
    },
  },
  {
    name: 'x402_evidence',
    action: 'evidence',
    description:
      'Show recorded ledger evidence for an operation: event trail, latest ' +
      'per-plane states (payment / execution / delivery), protocols involved. ' +
      'Use FIRST in any incident — establishes ground truth before acting. Read-only. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.', 
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'The operation ID to look up.' },
        dir: { type: 'string', description: 'Optional ledger directory.' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'x402_explain',
    action: 'explain',
    description:
      'Explain an operation\'s state in plain language from recorded evidence. ' +
      'Returns an assessment: NO_BASIS, INCOMPLETE (do not retry, do not repay), ' +
      'KNOWN_SAFE, RECOVERY_CANDIDATE, or PARTIAL. Use to understand an incident ' +
      'before deciding whether to retry, refund, or escalate. Read-only. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.', 
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'The operation ID to explain.' },
        dir: { type: 'string', description: 'Optional ledger directory.' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'x402_recover',
    action: 'recover',
    description:
      'Report the safe recovery decision for an operation whose result was lost ' +
      '(paid but no result). READ-ONLY: nothing is charged, nothing is executed. ' +
      'Returns RECOVERABLE/SAFE_RETRY -> KNOWN_SAFE, or HUMAN_REVIEW. Use for ' +
      'the exact situation where blind retry would double-pay or double-execute. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'The operation ID.' },
        identity: { type: 'string', description: 'Operation identity (or supply evidence with toolName/payer/paymentAuthFingerprint).' },
        evidence: { type: 'string', description: 'Optional JSON evidence string.' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'x402_resolve',
    action: 'resolve',
    description:
      'Resolve settlement state from evidence (e.g. settlement_pending: was the ' +
      'broadcast transaction confirmed on chain?). Use instead of blind retry. Read-only. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.', 
    inputSchema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'string',
          description: 'JSON string with txHash and network, e.g. {"txHash":"0x...","network":"base"}.',
        },
      },
      required: ['evidence'],
    },
  },
  {
    name: 'x402_status',
    action: 'status',
    description:
      'Check callx402 subsystem reachability (which diagnostic subsystems are ' +
      'available). Use to verify the tool is operational before diagnosing. Read-only. ' +
      ' Free read-only diagnostic surface: no payment, no auth, never Veyline-gated. For the paid on-demand callx402 action path, see https://payloadhq.github.io/agents.json.', 
    inputSchema: { type: 'object', properties: {} },
  },
];

/* ------------------------------------------------------------------ */
/* JSON-RPC over stdio.                                                */
/* ------------------------------------------------------------------ */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleToolsCall(id, params) {
  const name = params && params.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    error(id, -32602, `unknown tool '${name}'`);
    return;
  }
  const args = (params && params.arguments) || {};
  try {
    const { result: r, exitCode } = await core.runAction(tool.action, args, { timeoutMs: TIMEOUT_MS });
    const ok = exitCode === 0;
    result(id, {
      content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
      isError: !ok,
    });
  } catch (e) {
    result(id, {
      content: [{ type: 'text', text: JSON.stringify({ error: e && e.message ? e.message : String(e) }) }],
      isError: true,
    });
  }
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      });
      break;
    case 'notifications/initialized':
      break; // no response for notifications
    case 'tools/list':
      result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      break;
    case 'tools/call':
      if (id === undefined || id === null) break;
      await handleToolsCall(id, params);
      break;
    case 'ping':
      result(id, {});
      break;
    default:
      if (id !== undefined && id !== null) error(id, -32601, `method not found: ${method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let buffer = '';
  rl.on('line', (line) => {
    buffer += line;
    // Handle one complete JSON message per line (MCP stdio framing).
    try {
      const msg = JSON.parse(buffer);
      buffer = '';
      handleMessage(msg).catch((e) => {
        if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, String((e && e.message) || e));
      });
    } catch {
      // Incomplete JSON — keep buffering. Guard against unbounded growth.
      if (buffer.length > 4 * 1024 * 1024) buffer = '';
    }
  });
  rl.on('close', () => process.exit(0));
}

if (require.main === module) main();
module.exports = { TOOLS, SERVER_NAME, VERSION, PROTOCOL_VERSION };
