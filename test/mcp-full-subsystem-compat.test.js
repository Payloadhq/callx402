'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const readline=require('node:readline');

test('configured full doctor remains preferred to free fallback after npm packaging fix',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'callx402-legacy-compat-'));
 const d=path.join(temp,'lib','mcp');fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(d,'doctor.js'),
   "module.exports={FLAG:'FAKE_DOCTOR',enabled:()=>true,runMcpDoctor:()=>({whatFailed:'CONFIGURED_DOCTOR_USED',stages:[]})};\n");
 const proc=spawn(process.execPath,[path.join(__dirname,'..','mcp','index.js')],{
   cwd:temp,env:{
     ...process.env,CALLX402_V2_ROOT:temp,CALLX402_MODE:'local',
     CALLX402_CONFIG:path.join(temp,'not-present.json'),
     CALLX402_TIMEOUT_MS:'5000'
   },stdio:['pipe','pipe','pipe']
 });
 let id=0,err='';const pending=new Map();
 proc.stderr.on('data',b=>err+=b);
 readline.createInterface({input:proc.stdout}).on('line',line=>{
   try{const r=JSON.parse(line),fn=pending.get(r.id);if(fn){pending.delete(r.id);fn(r);}}catch{}
 });
 function rpc(method,params){
   return new Promise((resolve,reject)=>{
     const n=++id,t=setTimeout(()=>{pending.delete(n);reject(Error('timeout '+err.slice(0,200)));},4000);
     pending.set(n,v=>{clearTimeout(t);resolve(v);});
     proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');
   });
 }
 try {
   const r=await rpc('tools/call',{name:'x402_diagnose',
     arguments:{evidence:JSON.stringify({httpStatus:402})}});
   assert.equal(r.result?.isError,false,JSON.stringify(r));
   const payload=JSON.parse(r.result.content[0].text);
   assert.equal(payload.data.report.whatFailed,'CONFIGURED_DOCTOR_USED',
     'configured full-subsystem dispatch must not silently be replaced by free approximation');
 }finally{proc.kill('SIGTERM');fs.rmSync(temp,{recursive:true,force:true});}
});