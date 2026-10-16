'use strict';
// Local, read-only, dependency-free MCP diagnosis.
function run(name, args = {}) {
  if(name === 'x402_status') return {status:'READY', mode:'FREE_MCP', tools:6};
  let evidence = args.evidence || {};
  if(typeof evidence === 'string') evidence = JSON.parse(evidence);
  if(!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Evidence must be a JSON object');
  }
  const status = Number(evidence.httpStatus || evidence.status || evidence.response?.status || 0);
  let challenge = evidence.challenge || evidence.paymentRequired || evidence.responseBody || {};
  if(typeof challenge === 'string') {
    try { challenge = JSON.parse(challenge); } catch { challenge = {}; }
  }
  const accept = (Array.isArray(challenge.accepts) && challenge.accepts[0]) ||
    challenge.paymentRequirements || challenge;
  const network = accept.network || evidence.network || null;
  const legacy = ['base','base-sepolia','solana','solana-devnet','ethereum','arbitrum','optimism','polygon'];
  const known = typeof network === 'string' && (
    /^(eip155:\\d+|solana:[A-Za-z0-9]+)$/.test(network) || legacy.includes(network));
  const terms = !!(network && accept.asset && (accept.amount != null || accept.maxAmountRequired != null));
  const version = challenge.x402Version || evidence.x402Version || null;
  if(name === 'x402_diagnose') return {
    classification: status === 402 ? (terms ? (known ? 'RECOGNIZED_CHALLENGE' : 'UNKNOWN_NETWORK')
        : 'INCOMPLETE_CHALLENGE') :
      status >= 500 ? 'SERVER_ERROR' :
      status === 401 || status === 403 ? 'AUTH_DENIED' : 'INSUFFICIENT_EVIDENCE',
    network, x402Version: version, termsPresent: terms,
    legacySlugInV2: !!(version === 2 && known && network && !network.includes(':')),
    evidenceSource: 'USER_SUPPLIED', verifiedSettlement:false,
    note:'Recognition does not verify payability or on-chain settlement.'
  };
  if(name === 'x402_evidence') return {
    operationId: args.operationId || null, evidence,
    basis: Object.keys(evidence).length ? 'USER_SUPPLIED' : 'NO_BASIS'
  };
  if(name === 'x402_explain') return {
    operationId: args.operationId || null, summary:'Local supplied evidence only',
    basis: Object.keys(evidence).length ? 'USER_SUPPLIED' : 'NO_BASIS'
  };
  if(name === 'x402_recover') return {decision:'HUMAN_REVIEW', canRetry:false, executed:false};
  if(name === 'x402_resolve') return {settlement:'UNKNOWN', canRetry:false};
  throw new Error('Unknown MCP tool');
}
module.exports = {run};
