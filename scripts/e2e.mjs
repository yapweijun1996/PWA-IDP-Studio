#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './e2e/cdp.mjs';
import { buildApp, startServer } from './e2e/server.mjs';
import { installMocks, redact } from './e2e/mocks.mjs';
import { failureArtifacts, report } from './e2e/report.mjs';
import { scenarios, liveScenarios } from './e2e/scenarios/index.mjs';

class Skip extends Error {}
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
let server; let browser; let buildB; let stopping=false;
async function cleanup() { if(browser){const b=browser;browser=null;await b.close()} if(server){const s=server;server=null;await s.close()} if(buildB){await rm(buildB,{recursive:true,force:true});buildB=null} }
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{stopping=true;cleanup().finally(()=>process.exit(signal==='SIGINT'?130:143))});
const run= new Date().toISOString().replace(/[:.]/g,'-');
const directory=resolve('artifacts/e2e',run);
const results=[];
try {
  if(typeof WebSocket!=='function') throw new Error('Node 23+ with global WebSocket and fetch is required');
  let only; let liveURL;
  for(const arg of process.argv.slice(2)) {
    if(arg.startsWith('--only=')) only=arg.slice(7);
    else if(arg.startsWith('--base-url=')) liveURL=arg.slice(11);
    else throw new Error(`Unknown option: ${arg}`);
  }
  let selected=liveURL?liveScenarios:scenarios;
  if(only) { selected=selected.filter(s=>s.name===only); if(!selected.length)throw new Error(`Unknown scenario ${only}; choose ${ (liveURL?liveScenarios:scenarios).map(s=>s.name).join(', ') }`); }
  let url;
  if(liveURL) { const target=new URL(liveURL); if(!['http:','https:'].includes(target.protocol))throw new Error('base-url must use HTTP(S)'); target.hash='';target.search='';if(!target.pathname.endsWith('/'))target.pathname+='/'; url=target.href; for(const s of scenarios)results.push({name:s.name,status:'SKIP',reason:'Live mode: local uploads, fixtures and storage mutations are prohibited'}); }
  else { await buildApp('e2e-1'); server=await startServer('dist');url=server.url;buildB=await mkdtemp(join(tmpdir(),'idp-e2e-build-b-')); }
  for(const scenario of selected) {
    let flaky=false;
    for(let attempt=0;attempt<2;attempt++) {
      if(stopping) throw new Error('Run interrupted');
      let mocks; let outcome;
      try {
        if(server)server.setRoot('dist');
        browser=await launchBrowser({profile:scenario.profile||'desktop'});
        mocks=await installMocks(browser,{baseURL:url,live:!!liveURL});
        if(!scenario.beforeLoad) { await browser.navigate(url); await browser.wait('!!document.querySelector("main h1")','application initial render',30000); }
        await scenario.run({b:browser,browser,url,mocks,server,buildApp,buildB,assert,skip:reason=>{throw new Skip(reason)}});
        await mocks.assertSafe();
        assert.deepEqual(browser.errors,[],'Browser console/page errors');
        outcome={name:scenario.name,status:'PASS',flaky};
      } catch(e) {
        if(mocks?.violations.length) e = new Error(mocks.violations.join('; '));
        // Capture every failed attempt before destroying its isolated profile.
        await failureArtifacts(browser,join(directory,scenario.name,`attempt-${attempt+1}`),e);
        if(e.transport && attempt===0) { flaky=true; }
        else { outcome={name:scenario.name,status:e instanceof Skip?'SKIP':'FAIL',reason:redact(e.message),flaky}; }
      } finally {
        if(browser){const b=browser;browser=null;try{await b.close()}catch(e){outcome={name:scenario.name,status:'FAIL',reason:`Chrome cleanup: ${redact(e.message)}`,flaky}}}
        if(server)server.setRoot('dist');
      }
      if(outcome){results.push(outcome);break;}
    }
  }
} catch(e) { results.push({name:'runner',status:'FAIL',reason:redact(e.message)}); await failureArtifacts(browser,join(directory,'runner'),e); }
finally { try{await cleanup()}catch(e){results.push({name:'cleanup',status:'FAIL',reason:redact(e.message)})} }
process.exitCode=await report(results,directory);
