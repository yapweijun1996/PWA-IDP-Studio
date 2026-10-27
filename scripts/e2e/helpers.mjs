import assert from 'node:assert/strict';
export const js = JSON.stringify;
export async function text(b, value) { await b.wait(`document.body.innerText.includes(${js(value)})`, `visible text: ${value}`); }
export async function click(b, label, selector = 'button,[role="tab"],[role="menuitem"]') {
  const expression = `(() => { const nodes = [...document.querySelectorAll(${js(selector)})].filter(e => e.getClientRects().length && (e.getAttribute('aria-label') === ${js(label)} || e.textContent.trim().replace(/ [↑↓]$/, '') === ${js(label)})); if (nodes.length !== 1) throw new Error('Expected one control: ' + ${js(label)} + ', found ' + nodes.length); if(nodes[0].disabled || nodes[0].getAttribute('aria-disabled') === 'true') throw new Error('Disabled control: ' + ${js(label)}); nodes[0].focus(); nodes[0].click(); return true; })()`;
  await b.eval(expression);
}
export async function radio(b, group, value) { await b.eval(`(() => { const e = document.querySelector('[role="radiogroup"][aria-label='+${js(js(group))}+'] input[value='+${js(js(value))}+']'); if(!e) throw new Error('Missing radio'); e.click(); })()`); }
export async function fill(b, selector, value) {
  await b.eval(`(() => { const e = document.querySelector(${js(selector)}); if(!e) throw new Error('Missing input: '+${js(selector)}); const setter = Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(e, ${js(value)}); e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
}
export async function field(b, label, value) {
  const selector = await b.eval(`(() => { const l = [...document.querySelectorAll('label')].find(e => e.textContent.trim().startsWith(${js(label)})); if(!l) throw new Error('Missing label '+${js(label)}); const e = l.control || l.querySelector('input'); if(!e) throw new Error('Missing labelled input'); return '#'+CSS.escape(e.id); })()`);
  await fill(b, selector, value);
}
export async function route(b, hash, heading) { await b.eval(`location.hash = ${js(hash)}`); if (heading) await b.wait(`[...document.querySelectorAll('h1')].some(e => e.textContent === ${js(heading)})`, `route ${hash}`); }
export async function reload(b) { await b.eval('window.__e2eBeforeReload = true'); await b.send('Page.reload'); await b.wait('!window.__e2eBeforeReload && document.readyState === "complete" && !!document.querySelector("main h1")', 'reload app'); }
export async function drop(b, name = 'invoice.png', base64, { expectProcessed = true } = {}) {
  await b.eval(`(async () => {
    let blob;
    if (${js(base64 || null)}) blob = new Blob([Uint8Array.from(atob(${js(base64 || '')}), c => c.charCodeAt(0))], {type:'application/pdf'});
    else { const canvas = document.createElement('canvas'); canvas.width=200; canvas.height=200; const c=canvas.getContext('2d'); c.fillStyle='white'; c.fillRect(0,0,200,200); c.fillStyle='black'; c.fillText('E2E Invoice 10.00',10,30); blob=await new Promise(resolve=>canvas.toBlob(resolve,${js(name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png')})); }
    const dataTransfer=new DataTransfer(); dataTransfer.items.add(new File([blob],${js(name)},{type:blob.type}));
    const zone=document.querySelector('section[aria-label="Drag and drop documents here"]'); if(!zone) throw new Error('Missing dropzone'); zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
  })()`);
  if (!expectProcessed) return;
  await b.wait('location.hash.startsWith("#/doc/") && !!document.querySelector("main h1") && !document.body.innerText.includes("Loading document…")', `processed upload ${name}`, 120000);
  await b.wait(`document.querySelector('main h1')?.textContent === ${js(name)}`, `workspace ${name}`);
}
export async function batches(b) {
  return b.eval(`new Promise((resolve,reject)=>{const r=indexedDB.open('idp-studio');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const t=d.transaction('batches','readonly');const q=t.objectStore('batches').getAll();t.oncomplete=()=>{d.close();resolve(q.result.map(r=>r.batch))};t.onerror=()=>{d.close();reject(t.error)}}})`);
}
export async function fullJSON(b) { await click(b, 'JSON'); await radio(b, 'JSON format', 'full'); await b.wait('!!document.querySelector("pre")', 'full JSON'); return b.eval('JSON.parse(document.querySelector("pre").textContent)'); }
export function checkEnvelope(batch) {
  assert.equal(batch.schema_version, '2.0.0');
  for (const key of ['batch','source_files','pages','documents','transactions','evidence','issues','reviews','validation']) assert.ok(Object.hasOwn(batch, key), `Full JSON missing ${key}`);
  assert.equal(batch.source_files[0].page_count, batch.pages.length);
  for (const tx of batch.transactions) {
    assert.ok(batch.documents.some(d => d.document_id === tx.document_id));
    for (const ids of Object.values(tx.field_evidence)) for (const id of ids) assert.ok(batch.evidence.some(e => e.evidence_id === id));
  }
}
export async function overflow(b) { assert.equal(await b.eval('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'Horizontal viewport overflow'); }
export async function key(b, key, modifiers = 0) { const code = {Tab:9,Escape:27,Enter:13}[key]; await b.send('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,modifiers,windowsVirtualKeyCode:code}); await b.send('Input.dispatchKeyEvent', {type:'keyUp',key,code:key,modifiers,windowsVirtualKeyCode:code}); }
export async function settled(b) { await b.eval('new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); }
