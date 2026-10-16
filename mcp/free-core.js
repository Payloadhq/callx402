'use strict';
// Local, read-only, dependency-free MCP diagnosis.
function run(name, args = {}) {
  if(name === 'x402_status') return {status:'READY', mode:'FREE_MCP', tools:6};
  let evidence = args.evidence || {};
  if(typeof evidence === 'string') evidence = JSON.parse(evidence);
  if(!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Evidence must be a JSON object');
  }
  const status = Number(evidence.httpStatus || evidence.status || 0);
  if(name === 'x402_diagnose') return {
    classification: status === 402 ? 'PAYMENT_CHALLENGE' :
      status >= 500 ? 'SERVER_ERROR' :
      status === 401 || status === 403 ? 'AUTH_DENIED' : 'INSUFFICIENT_EVIDENCE',
    evidenceSource: 'USER_SUPPLIED', verifiedSettlement:false
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
