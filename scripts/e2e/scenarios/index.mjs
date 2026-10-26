import assert from 'node:assert/strict';
import { text, click, radio, field, fill, route, reload, drop, batches, fullJSON, checkEnvelope, overflow, key, settled, js } from '../helpers.mjs';
import { setProfile, until } from '../cdp.mjs';
import { TEST_KEY, invoice } from '../mocks.mjs';
import { makePDF } from '../pdf.mjs';

const posts = mocks => mocks.requests.filter(r => r.method === 'POST' && r.url.endsWith('/responses'));
const buttonDisabled = (b, label) => b.eval(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${js(label)})?.disabled`);
async function home(b) { await route(b, '#/', 'Upload Documents'); }
async function settings(b) { await route(b, '#/settings', 'Settings'); }
async function correct(b, name, value) {
  await b.eval(`(() => {const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${js('Edit ' + name.replaceAll('_',' ').replace(/^./, c=>c.toUpperCase()))});if(!e)throw new Error('Missing field edit');e.click()})()`);
  await field(b, `Edit ${name}`, value); await field(b, 'Correction reason', `E2E correction of ${name}`); await click(b, 'Save correction');
  await b.wait(`![...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Save correction')`, 'correction persisted');
}
async function shell(b, live = false) {
  await b.wait('!!document.querySelector("main table")', 'initial batches loaded');
  await text(b, 'Upload Documents'); await text(b, 'gpt.yapweijun1996.com');
  const nav = await b.eval(`[...document.querySelectorAll('aside nav a')].map(e=>{
    const ids = (e.getAttribute('aria-describedby') || '').trim().split(/\\s+/).filter(Boolean);
    const descriptions = ids.map(id => document.getElementById(id));
    const badge = e.querySelector('.ds-badge');
    return {label:e.getAttribute('aria-label')||e.querySelector('span')?.textContent,
      disabled:e.getAttribute('aria-disabled'),href:e.getAttribute('href'),
      reason:ids.length && descriptions.every(Boolean) ? descriptions.map(d=>d.textContent.trim()).join(' ') : null,
      badge:badge?.textContent, badgeVisible:!!badge && badge.checkVisibility()};
  })`);
  assert.deepEqual(nav.map(n => n.label), ['Home','Documents','Review Queue','Label Studio','Templates','JSON Explorer','AI Agents','Validation','Settings']);
  assert.deepEqual(nav.filter(n => n.disabled === 'true').map(n => n.label), ['Label Studio','Templates','JSON Explorer','AI Agents','Validation']);
  assert.equal(await b.eval('!!document.querySelector("aside:not(.ds-collapsed) button[aria-expanded=true]")'), true, 'Expanded sidebar');
  for (const n of nav.filter(n => n.disabled === 'true')) {
    assert.equal(n.reason, 'Coming soon', `${n.label} accessible description`);
    assert.equal(n.badge, 'Coming soon', `${n.label} badge`);
    assert.equal(n.badgeVisible, true, `${n.label} badge visible when expanded`);
    assert.equal(n.href, null);
  }
  assert.deepEqual(nav.filter(n => n.href).map(n => n.href), ['#/','#/documents','#/review','#/settings']);
  const footer = await b.eval('document.querySelector("aside footer")?.textContent');
  assert.match(footer || '', /Version \S+ · Build \S+/);
  if (!live) assert.ok(footer.endsWith('Build e2e-1'), 'Expected deterministic build ID');
}
async function pwa(b) {
  assert.ok(await b.eval('!!document.querySelector(\'link[rel="manifest"]\')'), 'Manifest link');
  await b.wait(`navigator.serviceWorker.getRegistration().then(r=>!!r?.active)`, 'active service worker', 60000);
  await b.eval(`Promise.race([navigator.serviceWorker.ready.then(()=>true),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SW ready timeout')),30000))])`);
}
export const scenarios = [
  { name: 'targeted-mode', async run({b,mocks}) {
    mocks.setVariant('targeted');
    await radio(b, 'Extraction mode', 'targeted');
    await b.eval(`(() => { const e = document.querySelector('main select'); e.value = 'doc-info-rows'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await drop(b, 'targeted.png'); await text(b, 'DOC-TARGET-001');
    for (const name of ['document_no','transaction_date','remarks','row_no','stock_code','stock_description','quantity','uom','unit_price','line_subtotal']) assert.ok(posts(mocks).some(r => r.body.includes(name)), `Prompt includes ${name}`);
    for (const label of ['Document number','Transaction date','Remarks','Row number','Stock code','Stock description','Quantity','UOM','Unit price','Line subtotal']) await text(b, label);
    assert.equal(await b.eval('document.querySelectorAll("table tbody tr").length'), 2);
    await b.eval(`document.querySelector('button[aria-label="Edit Stock code row 1"]').click()`);
    await field(b, 'Edit Stock code', 'SKU-EDIT'); await click(b, 'Save correction'); await text(b, 'SKU-EDIT');
    await click(b, 'JSON');
    const output = await b.eval('JSON.parse(document.querySelector("pre").textContent)');
    assert.deepEqual(Object.keys(output).sort(), ['document_no','transaction_date','remarks','line_items'].sort());
    assert.equal(output.line_items[0].stock_code, 'SKU-EDIT');
    assert.deepEqual(Object.keys(output.line_items[0]).sort(), ['row_no','stock_code','stock_description','quantity','uom','unit_price','line_subtotal'].sort());
  } },
  { name: 'shell', async run({b}) { await shell(b); } },
  { name: 'upload-demo', async run({b,mocks}) {
    await drop(b); await text(b, 'INV-E2E-001');
    const requests = posts(mocks); assert.equal(requests.length, 1);
    const r = requests[0]; assert.ok(r.body.includes('input_image')); assert.ok(Object.entries(r.headers).some(([k,v])=>k.toLowerCase()==='authorization' && v==='Bearer dmo_e2e_fake'));
    assert.equal(new URL(r.url).pathname, '/demo/v1/responses');
    const payload = JSON.parse(r.body);
    assert.equal(Object.hasOwn(payload, 'max_output_tokens'), false);
    assert.equal(payload.store, false);
    assert.ok(!JSON.stringify(mocks.requests).includes(TEST_KEY), 'No BYOK key in demo traffic');
    await home(b); await text(b, 'invoice.png');
    const stats = await b.eval(`[...document.querySelectorAll('dl')].map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent])`);
    assert.deepEqual(stats, [['Pages processed','1'],['Documents detected','1'],['Transactions extracted','1']]);
    await b.eval(`document.querySelector('tbody tr').click()`); await text(b, 'INV-E2E-001');
  } },
  { name: 'review-flow', async run({b,mocks}) {
    mocks.setVariant('bad'); await drop(b); assert.equal(await buttonDisabled(b,'Approve'), true); await text(b, 'blocking issues before approval');
    await b.eval(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.startsWith('Issues')).click()`);
    await b.wait(`!![...document.querySelectorAll('main h2')].find(e=>/date/i.test(e.textContent))`, 'readable date issue title');
    await click(b, 'Fields'); await correct(b, 'invoice_date', '2026-10-26');
    let batch = (await batches(b))[0]; assert.ok(batch.issues.some(i=>i.rule_code==='STANDARDS_ISO8601' && i.status==='resolved'));
    // The bad fixture deliberately has TWO blockers. Fixing the date must not hide the totals blocker.
    assert.equal(await buttonDisabled(b,'Approve'), true); await correct(b, 'total_amount', '10.00');
    await b.wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Approve'&&!e.disabled)`, 'approval enabled');
    await click(b, 'Invoice date');
    await b.wait(`!!document.querySelector('[role="img"][aria-label="Invoice date (selected) — read-only evidence"]')`, 'selected evidence box');
    assert.equal(await b.eval(`document.querySelector('.ds-evidence-viewer img[alt="Page 1"]')!==null`), true);
    assert.equal(await b.eval(`[...document.querySelectorAll('.ds-evidence-viewer button, .ds-evidence-viewer input, .ds-evidence-viewer [draggable="true"]')].some(e=>/draw|move|resize|edit.*box/i.test(e.textContent+' '+e.getAttribute('aria-label')))`), false, 'No box editing controls');
    await click(b, 'Approve'); await text(b, 'Approved'); await click(b, 'JSON');
    const clean = await b.eval('JSON.parse(document.querySelector("pre").textContent)');
    batch = await fullJSON(b); checkEnvelope(batch); assert.notDeepEqual(clean,batch); assert.equal(clean.invoice_date,'2026-10-26');
    assert.equal(batch.transactions[0].status,'approved'); assert.deepEqual(batch.reviews.map(r=>r.action),['correct','correct','approve']);
    assert.ok(batch.reviews.every(r=>r.reason && r.new_revision===r.prior_revision+1));
  } },
  { name: 'repair-turn', async run({b,mocks}) {
    mocks.setVariant('repair'); await drop(b,'repaired.png'); await text(b,'INV-E2E-001'); assert.equal(posts(mocks).length,2); assert.ok(posts(mocks)[1].body.includes('Your reply was invalid'));
    mocks.setVariant('invalid'); await home(b); const before=posts(mocks).length; await drop(b,'invalid.png'); await text(b,'Model output was not valid');
    assert.equal(posts(mocks).length-before,2); const failed=(await batches(b)).find(v=>v.source_files[0].filename==='invalid.png');
    assert.equal(failed.batch.status,'failed'); assert.equal(failed.transactions.length,0); assert.ok(failed.issues.some(i=>i.rule_code==='EXTRACTION_FAILED'));
    assert.ok(await b.eval(`!!document.querySelector('main [role="alert"], main .ds-notice')`), 'Visible error notice');
  } },
  { name: 'byok', async run({b,mocks}) {
    await settings(b); await radio(b,'AI provider','openai'); await field(b,'OpenAI (BYOK) API key',TEST_KEY); await click(b,'Save extraction settings');
    await home(b); await drop(b,'byok.png'); await text(b,'INV-E2E-001');
    const r=posts(mocks)[0]; assert.equal(new URL(r.url).hostname,'api.openai.com');
    assert.ok(Object.entries(r.headers).some(([k,v])=>k.toLowerCase()==='authorization'&&v===`Bearer ${TEST_KEY}`));
    for(const q of mocks.requests) { assert.ok(!q.url.includes(TEST_KEY)); assert.ok(!q.body.includes(TEST_KEY)); for(const [k,v] of Object.entries(q.headers)) if(String(v).includes(TEST_KEY)) assert.ok(new URL(q.url).hostname==='api.openai.com'&&k.toLowerCase()==='authorization'); }
    await reload(b);
    const stored=await b.eval(`(async()=>{const names=await indexedDB.databases();const values=[];for(const {name} of names){await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const stores=[...d.objectStoreNames];if(!stores.length){d.close();resolve();return}const t=d.transaction(stores,'readonly');for(const s of stores){const q=t.objectStore(s).getAll();q.onsuccess=()=>values.push(q.result)}t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>reject(t.error)}})}return JSON.stringify(values)})()`);
    assert.ok(!stored.includes(TEST_KEY),'Key absent from all IndexedDB stores');
    await settings(b); await field(b,'OpenAI (BYOK) API key',''); await click(b,'Save extraction settings'); await home(b); const count=mocks.requests.length;
    await drop(b,'missing-key.png'); await text(b,'key in Settings first'); assert.equal(mocks.requests.length,count,'Missing key sends no request');
    // Exercise the second provider's HTTP failure without spending or synthetic successful data.
    await settings(b); await radio(b,'AI provider','openrouter'); await field(b,'OpenRouter (BYOK) API key','sk-e2e-openrouter-not-real'); await click(b,'Save extraction settings'); mocks.setVariant('rate-limit'); await home(b); await drop(b,'rate-limited.png'); await text(b,'E2E rate limit');
    assert.ok(mocks.requests.some(r=>r.method==='POST'&&new URL(r.url).hostname==='openrouter.ai'));
    assert.equal((await batches(b)).find(v=>v.source_files[0].filename==='rate-limited.png').batch.status,'failed');
  } },
  { name: 'network-failure-retry', async run({b,mocks}) {
    mocks.setVariant('network-error');
    await drop(b,'IMG_0454.png',undefined,{expectProcessed:false});
    await b.wait('location.hash.startsWith("#/doc/")','workspace route'); await text(b,'Could not reach the AI service');
    const page=await b.eval('document.body.innerText'); assert.ok(!page.includes('Page limit'),'no misleading page-limit message'); assert.ok(!page.includes('Upload the original again'),'no re-upload instruction');
    const failed=(await batches(b)).find(v=>v.source_files[0].filename==='IMG_0454.png'); assert.equal(failed.batch.status,'failed'); assert.ok(!failed.issues.some(i=>i.rule_code==='PAGE_LIMIT_EXCEEDED'));
    mocks.setVariant('valid'); await click(b,'Retry extraction'); await text(b,'INV-E2E-001');
    const ok=(await batches(b)).find(v=>v.source_files[0].filename==='IMG_0454.png'); assert.equal(ok.batch.status==='failed',false); assert.equal(ok.batch.batch_id,failed.batch.batch_id);
    assert.equal((await batches(b)).filter(v=>v.source_files[0].filename==='IMG_0454.png').length,1,'retry reuses the stored original, no duplicate');
  } },
  { name: 'page-limit', async run({b,mocks}) {
    const pdf=makePDF(25).toString('base64'); await drop(b,'limited.pdf',pdf);
    const batch=await fullJSON(b); checkEnvelope(batch); assert.equal(batch.pages.length,25); assert.equal(batch.pages.filter(p=>p.status==='pending').length,5);
    assert.ok(batch.issues.some(i=>i.rule_code==='PAGE_LIMIT_EXCEEDED'&&i.severity==='blocking'&&i.status==='open'));
    assert.equal(await buttonDisabled(b,'Approve'),true); assert.equal(await buttonDisabled(b,'Download JSON'),true); assert.equal(await buttonDisabled(b,'Copy JSON'),true);
    await click(b,'Export'); assert.equal(await b.eval(`[...document.querySelectorAll('[role="menuitem"]')].every(e=>e.disabled)`),true); await key(b,'Escape');
    await settings(b); await field(b,'Maximum pages per extraction','25'); await click(b,'Save extraction settings'); await home(b); await drop(b,'complete.pdf',pdf);
    const next=(await batches(b)).find(v=>v.source_files[0].filename==='complete.pdf'); assert.equal(next.pages.filter(p=>p.status==='classified').length,25); assert.equal(next.pages.filter(p=>p.status==='pending').length,0);
    const input=JSON.parse(posts(mocks).at(-1).body); const countImages=v=>!v||typeof v!=='object'?0:(v.type==='input_image'?1:0)+Object.values(v).reduce((n,x)=>n+(Array.isArray(x)?x.reduce((s,y)=>s+countImages(y),0):countImages(x)),0);
    assert.equal(countImages(input),25,'25 images sent at raised page limit');
  } },
  { name: 'migration', beforeLoad: true, async run({b,url}) {
    // A same-origin empty resource allows seeding BEFORE any application JavaScript executes.
    await b.navigate(new URL('manifest.webmanifest',url).href);
    const output=invoice(); const extraction=Object.fromEntries(output.fields.map(f=>[f.key,f.value])); extraction.line_items=output.line_items;
    await b.eval(`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const blob=await new Promise(r=>c.toBlob(r,'image/png'));await new Promise((resolve,reject)=>{const r=indexedDB.open('idp-studio',1);r.onupgradeneeded=()=>{r.result.createObjectStore('documents',{keyPath:'id'});r.result.createObjectStore('files')};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const t=d.transaction(['documents','files'],'readwrite');t.objectStore('documents').put({id:'old-e2e',name:'legacy.png',mime:'image/png',size:blob.size,createdAt:1792972800000,pageCount:1,envelope:{schema_version:'1.0',document_id:'old-e2e',document_type:'purchase_invoice',status:'ready',extraction:${js(extraction)},evidence:{},validation:{schema_valid:true,totals_match:true,missing_required:[],low_confidence:[],standards_issues:[],needs_review:false},model:null,audit:[]}});t.objectStore('files').put(blob,'old-e2e');t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>reject(t.error)}})})()`);
    await b.navigate(url); await text(b,'legacy.png'); let rows=await batches(b); assert.equal(rows.length,1); assert.equal(rows[0].batch.batch_id,'legacy_old-e2e');
    await reload(b); await text(b,'legacy.png'); rows=await batches(b); assert.equal(rows.length,1);
    assert.deepEqual(await b.eval(`new Promise((resolve,reject)=>{const r=indexedDB.open('idp-studio',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const t=d.transaction(['documents','files'],'readonly');const a=t.objectStore('documents').get('old-e2e'),f=t.objectStore('files').get('old-e2e');t.oncomplete=()=>{d.close();resolve([!!a.result, f.result instanceof Blob])}}})`),[true,true]);
  } },
  { name: 'theme-sidebar', async run({b}) {
    assert.equal(await b.eval('document.documentElement.dataset.theme'),'light'); await settings(b); await radio(b,'Theme','dark'); await b.wait('document.documentElement.dataset.theme==="dark"','dark theme'); await reload(b); assert.equal(await b.eval('document.documentElement.dataset.theme'),'dark');
    await radio(b,'Theme','system'); for(const value of ['light','dark','light']) { await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]}); await b.wait(`document.documentElement.dataset.theme===${js(value)}`,'system theme '+value); }
    await click(b,'Collapse sidebar'); await reload(b); assert.equal(await b.eval('!!document.querySelector("aside.ds-collapsed")'),true);
    await b.eval(`document.querySelector('aside nav a[aria-label="Home"]').focus()`); await b.wait(`!![...document.querySelectorAll('[role="tooltip"]')].find(e=>e.textContent==='Home')`,'rail focus tooltip');
    await b.eval(`document.querySelector('aside nav a[aria-label="Home"]').blur()`);
    await b.wait(`![...document.querySelectorAll('[role="tooltip"]')].some(e=>e.textContent==='Home')`,'rail focus tooltip dismissed');
    const point=await b.eval(`(()=>{const r=document.querySelector('aside nav a[aria-label="Home"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await b.wait(`!![...document.querySelectorAll('[role="tooltip"]')].find(e=>e.textContent==='Home')`,'rail hover tooltip');
  } },
  { name: 'mobile', profile: 'phone', async run({b}) {
    await drop(b); const hash=await b.eval('location.hash');
    for(const [hashValue,heading] of [['#/','Upload Documents'],['#/documents','Documents'],['#/review','Review Queue'],[hash,'invoice.png'],['#/settings','Settings'],['#/design','Design system']]) { await route(b,hashValue,heading); await settled(b); await overflow(b); }
    await home(b); await click(b,'Toggle navigation'); await b.wait('!!document.querySelector("aside[role=dialog]")','drawer open');
    await b.eval(`(()=>{const d=document.querySelector('aside[role=dialog]');const e=[...d.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];e.at(-1).focus()})()`); await key(b,'Tab');
    assert.equal(await b.eval(`document.activeElement===document.querySelector('aside[role="dialog"] button')`),true,'Tab wraps to first drawer control'); await key(b,'Tab',8);
    assert.equal(await b.eval(`document.activeElement===[...document.querySelectorAll('aside[role="dialog"] button:not(:disabled),aside[role="dialog"] a[href],aside[role="dialog"] [tabindex="0"]')].at(-1)`),true,'Shift Tab wraps');
    await key(b,'Escape'); await b.wait('!document.querySelector("aside[role=dialog]")','drawer closed'); assert.equal(await b.eval('document.activeElement?.getAttribute("aria-label")'),'Toggle navigation');
  } },
  { name: 'offline', async run({b,mocks}) {
    await drop(b,'stored.png'); const hash=await b.eval('location.hash'); await pwa(b); await reload(b); await home(b);
    await b.wait('!!navigator.serviceWorker.controller','controlled page'); await b.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await reload(b); await text(b,'Upload Documents'); await text(b,'Offline'); await route(b,hash,'stored.png'); await text(b,'INV-E2E-001'); await home(b);
    const before=mocks.requests.length; const batchCount=(await batches(b)).length;
    await drop(b,'offline.png',undefined,{expectProcessed:false});
    await b.wait(`/offline|no internet|network unavailable/i.test(document.querySelector('main').innerText)`,'offline upload explanation');
    assert.equal(mocks.requests.length,before,'Offline upload must not contact provider');
    assert.equal((await batches(b)).length,batchCount,'Offline upload must not create a batch');
    await b.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});
    await text(b,'Online'); await drop(b,'offline.png'); await text(b,'INV-E2E-001');
    const recovered=await batches(b);
    assert.equal(recovered.length,batchCount+1,'Online upload creates one batch');
    await home(b);
    await b.wait(`![...document.querySelectorAll('main .ds-notice, main [role="alert"]')].some(e=>/offline|no internet|network unavailable/i.test(e.innerText))`,'offline Notice cleared');
  } },
  { name: 'sw-update', async run({b,server,buildApp,buildB}) {
    await pwa(b); await reload(b); await b.wait('!!navigator.serviceWorker.controller','controlled build A'); await text(b,'Build e2e-1');
    await buildApp('e2e-2',buildB); server.setRoot(buildB); const initial=b.navigations;
    await b.eval('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)'); await text(b,'New version available.'); assert.equal(b.navigations,initial,'No automatic update reload'); await text(b,'Build e2e-1');
    const promptQuietUntil=Date.now()+3000;
    await until(()=>{assert.equal(b.navigations,initial,'No automatic update reload while prompt waits');return Date.now()>=promptQuietUntil},'update prompt navigation stability',6000);
    await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('e2eReloads',String(Number(sessionStorage.getItem('e2eReloads')||0)+1))`});
    await b.eval(`(()=>{const o=new MutationObserver(()=>{const loader=[...document.querySelectorAll('[role="status"]')].find(e=>e.textContent.includes('Updating IDP Studio'));if(loader?.getClientRects().length&&getComputedStyle(loader).visibility!=='hidden')sessionStorage.setItem('e2eOverlay','seen')});o.observe(document.body,{subtree:true,childList:true,characterData:true})})()`);
    await click(b,'Update now'); await text(b,'Build e2e-2'); assert.equal(await b.eval('sessionStorage.getItem("e2eOverlay")'),'seen','Updating loader observed before navigation');
    await b.wait('navigator.serviceWorker.getRegistration().then(r=>!!r?.active&&!r.waiting&&!r.installing)','updated worker settled'); await settled(b);
    const quietUntil=Date.now()+2000;
    await until(()=>{assert.equal(b.navigations-initial,1,'No update reload loop');return Date.now()>=quietUntil},'post-update navigation stability',5000);
    assert.equal(b.navigations-initial,1,'Exactly one navigation'); assert.equal(await b.eval('sessionStorage.getItem("e2eReloads")'),'1'); assert.equal(await b.eval('document.body.innerText.includes("New version available.")'),false);
  } },
  { name: 'settings-updates', async run({b,server,buildApp,buildB}) {
    await pwa(b); await reload(b); await b.wait('!!navigator.serviceWorker.controller','controlled build A'); await settings(b);
    await text(b,'Version 0.'); await text(b,'Build e2e-1'); await click(b,'Check for updates');
    await b.wait(`document.querySelector('[data-update-phase]')?.dataset.updatePhase==='ready'&&document.querySelector('[data-update-phase]').innerText.includes('latest version')`,'up-to-date status after check');
    assert.equal(await b.eval(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Update now')`),false,'No Update now when already current');
    await buildApp('e2e-2',buildB); server.setRoot(buildB); const initial=b.navigations;
    await click(b,'Check for updates');
    await b.wait(`document.querySelector('[data-update-phase]')?.dataset.updatePhase==='available'`,'update found by manual check');
    assert.equal(b.navigations,initial,'Check must not reload'); assert.equal(await b.eval(`document.querySelectorAll('main button').length>0&&[...document.querySelectorAll('main button')].some(e=>e.textContent.trim()==='Update now')`),true,'Update now inside Settings');
    await b.eval(`[...document.querySelectorAll('main button')].find(e=>e.textContent.trim()==='Update now').click()`);
    await text(b,'Build e2e-2'); await b.wait('navigator.serviceWorker.getRegistration().then(r=>!!r?.active&&!r.waiting&&!r.installing)','updated worker settled');
    assert.equal(b.navigations-initial,1,'Exactly one navigation');
  } },
  { name: 'search-docs', async run({b}) {
    await drop(b,'alpha.png'); await home(b); await drop(b,'zulu.png'); await home(b);
    for(const hash of ['#/','#/documents']) {
      await route(b,hash,hash==='#/'?'Upload Documents':'Documents'); await fill(b,'input[type="search"]','alpha'); await b.wait('document.querySelector("tbody")?.innerText.includes("alpha.png")&&!document.querySelector("tbody")?.innerText.includes("zulu.png")','filtered documents');
      await fill(b,'input[type="search"]',''); await b.wait('document.querySelector("tbody")?.innerText.includes("zulu.png")','cleared search');
    }
    await click(b,'File name'); assert.equal(await b.eval(`document.querySelector('th[aria-sort="ascending"]')?.textContent.trim()`),'File name ↑');
    assert.deepEqual(await b.eval(`[...document.querySelectorAll('tbody tr')].map(e=>e.querySelector('td').textContent)`),['alpha.png','zulu.png']);
    await click(b,'File name'); assert.equal(await b.eval(`document.querySelector('th[aria-sort="descending"]')?.textContent.trim()`),'File name ↓');
    assert.deepEqual(await b.eval(`[...document.querySelectorAll('tbody tr')].map(e=>e.querySelector('td').textContent)`),['zulu.png','alpha.png']);
    await click(b,'Actions for alpha.png'); await click(b,'Delete'); await text(b,'Delete upload?'); assert.equal((await batches(b)).length,2);
    await click(b,'Cancel'); assert.equal((await batches(b)).length,2); await click(b,'Actions for alpha.png'); await click(b,'Delete'); await b.wait('!!document.querySelector("[role=dialog]")','delete confirmation');
    await click(b,'Delete','[role="dialog"] button');
    await b.wait('!document.querySelector("[role=dialog]")','delete completed'); const left=await batches(b); assert.deepEqual(left.map(v=>v.source_files[0].filename),['zulu.png']); await text(b,'zulu.png');
  } },
];
export const liveScenarios = [{ name:'live-read-only', async run({b}) {
  await shell(b,true); await pwa(b);
  const manifest=await b.eval(`fetch(document.querySelector('link[rel="manifest"]').href).then(r=>{if(!r.ok)throw new Error('Manifest fetch failed');return r.json()})`); assert.ok(manifest.name); assert.ok(manifest.start_url);
  for(const profile of ['phone','tablet','desktop']) { await setProfile(b,profile); await settled(b); await overflow(b); }
  await route(b,'#/design','Design system'); await b.wait('document.querySelector("main").innerText.includes("Buttons")','design component sheet'); for(const profile of ['phone','desktop']) { await setProfile(b,profile); await settled(b); await overflow(b); }
} }];
