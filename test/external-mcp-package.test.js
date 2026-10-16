'use strict';
// Consumer smoke test for the actual npm artifact. Uses npm pack locally,
// installs nothing, sends no financial transactions or production requests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const readline=require('node:readline');

test('npm-packed callx402 exposes usable free MCP diagnosis to a clean consumer',async()=>{
 const root=path.resolve(__dirname,'..');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'callx402-npm-consumer-'));
 let proc;
 try{
   const pack=cp.spawnSync('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],{
     cwd:root,encoding:'utf8',timeout:30000});
   assert.equal(pack.status,0,pack.stderr);
   // Newer npm versions differ in --json metadata; inspect the actual artifact
   // instead of relying on a particular stdout schema.
   const filename=fs.readdirSync(temp).find(name=>name.endsWith('.tgz'));
   assert.ok(filename,'npm pack must produce a tarball in '+temp+
     ' (stdout: '+pack.stdout.slice(0,500)+')');
   const bundle=path.join(temp,filename);
   assert.ok(fs.existsSync(bundle),'packed npm tarball present');
   const extracted=cp.spawnSync('tar',['-xzf',bundle,'-C',temp],{encoding:'utf8'});
   assert.equal(extracted.status,0,extracted.stderr);
   const entry=path.join(temp,'package','mcp','index.js');
   assert.ok(fs.existsSync(entry),'MCP executable included in distributed npm archive');
   proc=cp.spawn(process.execPath,[entry],{
     cwd:temp,
     env:{
       ...process.env,
       CALLX402_V2_ROOT:path.join(temp,'absent-v2'),
       CALLX402_CONFIG:path.join(temp,'empty-config.json'),
       CALLX402_MODE:'local',
       CALLX402_CORE_PATH:path.join(temp,'package','core')
     },
     stdio:['pipe','pipe','pipe']
   });
   let stderr='';proc.stderr.on('data',d=>stderr+=d);
   let id=0;const wait=new Map();
   readline.createInterface({input:proc.stdout}).on('line',line=>{
     try{const r=JSON.parse(line),fn=wait.get(r.id);if(fn){wait.delete(r.id);fn(r);}}catch{}
   });
   const rpc=(method,params)=>new Promise((resolve,reject)=>{
     const n=++id,t=setTimeout(()=>{wait.delete(n);reject(new Error('MCP timeout '+stderr.slice(0,300)));},5000);
     wait.set(n,result=>{clearTimeout(t);resolve(result);});
     proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');
   });
   assert.ok((await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},
     clientInfo:{name:'fresh-npm-consumer',version:'1.0'}})).result);
   const tools=(await rpc('tools/list',{})).result?.tools||[];
   for(const name of ['x402_diagnose','x402_evidence','x402_explain','x402_recover','x402_resolve','x402_status'])
     assert.ok(tools.some(t=>t.name===name),'missing advertised tool '+name);
   const diagnostic=await rpc('tools/call',{
     name:'x402_diagnose',
     arguments:{evidence:JSON.stringify({httpStatus:402,
       failure:'client could not parse challenge',network:'base'})}
   });
   assert.ok(diagnostic.result,'MCP tool response exists');
   const output=JSON.stringify(diagnostic.result);
   assert.ok(!/subsystem_unreachable|Cannot find module|missing v2\.0\.0|could not be loaded/i.test(output),
     'fresh npm package must not demand an unpublished sibling module: '+output.slice(0,600));
   assert.equal(diagnostic.result.isError,false,
     'free diagnostic must work from a clean published-style npm artifact: '+output.slice(0,600));
   for (const [name,args] of [
     ['x402_status',{}],
     ['x402_evidence',{operationId:'operation-fixture'}],
     ['x402_explain',{operationId:'operation-fixture'}],
     ['x402_recover',{operationId:'operation-fixture'}],
     ['x402_resolve',{evidence:JSON.stringify({txHash:'0x'+'a'.repeat(64),network:'base'})}]
   ]) {
     const response=await rpc('tools/call',{name,arguments:args});
     assert.equal(response.result?.isError,false,
       name+' must respond safely on clean npm install: '+JSON.stringify(response));
     const data=JSON.parse(response.result.content[0].text);
     if(name==='x402_recover') assert.equal(data.canRetry,false,'no unauthenticated automatic recovery');
     if(name==='x402_resolve') assert.equal(data.settlement,'UNKNOWN','no synthetic proof of settlement');
     if(name==='x402_evidence') assert.equal(data.basis,'NO_BASIS','no invented private ledger entries');
   }
 }finally{if(proc)proc.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
});