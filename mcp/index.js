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
 * All six tools load without sibling packages. Free evidence and settlement
 * assessments remain conservative: caller evidence is not authenticated,
 * and local tools cannot certify a real payment or automatically retry.
 *
 * Usage (Claude Desktop / MCP client config):
 *   { "command": "node", "args": ["/path/to/callx402/mcp/index.js"] }
 * Env: CALLX402_CONFIG, CALLX402_V2_ROOT, CALLX402_TIMEOUT_MS (default 30000).
 */
const readline = require('node:readline');

const VERSION = '1.0.5';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'callx402';
const TIMEOUT_MS = Number(process.env.CALLX402_TIMEOUT_MS || 30000);

// The free MCP artifact must be functional when installed alone. The CLI's
// optional v2 subsystem tree is not a dependency of these read-only tools.
const freeCore = require('./free-core.js');

/* ------------------------------------------------------------------ */
/* Tool definitions: packaged read-only diagnostics only.             */
/*                                                                     */
/* Caller-supplied evidence is unverified. No private ledger or funds.  */
/* ------------------------------------------------------------------ */
const TREE_REQUIRED = ' Local read-only inference from caller-supplied evidence, included in npm. Does not independently verify payments or access private infrastructure.';
const ledgerRequired = () => ' Returns only caller-supplied evidence; no remote/private ledger is included and no on-chain data is verified.';
const LEDGER_REQUIRED = ledgerRequired();

const TOOLS = [
  {
    name: 'x402_diagnose',
    action: 'diagnose',
    description:
      'Run the x402 doctor over supplied evidence. Use when something went ' +
      'wrong with an x402 payment or MCP/x402 interaction and you need a ' +
      'diagnosis. Input: evidence as a JSON string or object describing the ' +
      'failure (error strings, responses, tx hashes). Read-only.' +
      TREE_REQUIRED,
    inputSchema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'string',
          description: 'JSON string describing non-sensitive failure evidence; local file references are unsupported.',
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
      'Show caller-supplied operation evidence only; no private or hosted ledger is included. ' +
      'Missing evidence returns NO_BASIS, never an invented ledger record. Read-only.' +
      LEDGER_REQUIRED,
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'The operation ID to look up.' },
        evidence: { type: 'string', description: 'Optional sanitized JSON evidence; otherwise NO_BASIS.' },
      },
      required: ['operationId'],
    },
  },
  {
    name: 'x402_explain',
    action: 'explain',
    description:
      'Provide a conservative interpretation of caller-supplied evidence only; ' +
      'no independent payment or settlement verification is performed. Read-only.' +
      LEDGER_REQUIRED,
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'The operation ID to explain.' },
        evidence: { type: 'string', description: 'Optional sanitized JSON evidence; otherwise NO_BASIS.' },
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
      'Without an authoritative settlement source, return HUMAN_REVIEW and never retry. ' +
      'This free diagnostic cannot execute recovery.' +
      ledgerRequired(),
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
      'Classify caller-provided settlement evidence conservatively. Returns UNKNOWN ' +
      'without authoritative chain verification; no retry is performed. Read-only.' +
      TREE_REQUIRED,
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
      'available). Use to verify the tool is operational before diagnosing. ' +
      'Read-only. Works with zero setup on a bare npm install. ' +
      'reports the availability of the packaged free tools independently of optional subsystems.',
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
    const r = freeCore.run(tool.name, args);
    result(id, {
      content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
      isError: false,
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
