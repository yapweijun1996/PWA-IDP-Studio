import assert from 'node:assert/strict';
import { text, click, radio, field, fill, route, reload, drop, batches, fullJSON, checkEnvelope, overflow, key, settled, js } from '../helpers.mjs';
import { setProfile, until } from '../cdp.mjs';
import { TEST_KEY, invoice } from '../mocks.mjs';
import { makePDF } from '../pdf.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  assert.deepEqual(nav.filter(n => n.disabled === 'true').map(n => n.label), []);
  assert.equal(await b.eval('!!document.querySelector("aside:not(.ds-collapsed) button[aria-expanded=true]")'), true, 'Expanded sidebar');
  for (const n of nav.filter(n => n.disabled === 'true')) {
    assert.equal(n.reason, 'Coming soon', `${n.label} accessible description`);
    assert.equal(n.badge, 'Coming soon', `${n.label} badge`);
    assert.equal(n.badgeVisible, true, `${n.label} badge visible when expanded`);
    assert.equal(n.href, null);
  }
  assert.deepEqual(nav.filter(n => n.href).map(n => n.href), ['#/','#/documents','#/review','#/label-studio','#/templates','#/json-explorer','#/ai-agents','#/validation','#/settings']);
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
  { name: 'statement-entries', async run({b,mocks}) {
    mocks.setVariant('statement-entries');
    await drop(b, 'statement.png'); await text(b, 'E2E Bank');
    const batch = (await batches(b)).find(v => v.source_files[0].filename === 'statement.png');
    checkEnvelope(batch);
    assert.equal(batch.documents.length, 1);
    assert.equal(batch.transactions.length, 5);
    assert.deepEqual(batch.documents[0].transaction_ids, batch.transactions.map(t => t.transaction_id));
    assert.deepEqual(batch.validation.export_eligible_transaction_ids, ['t_1', 't_1_entry_1', 't_1_entry_2', 't_1_entry_4']);
    assert.deepEqual(await b.eval(`[...document.querySelectorAll('main select optgroup option')].map(e=>e.value)`), batch.documents[0].transaction_ids);
    await field(b, 'Search transactions', 'ENTRY-3');
    assert.deepEqual(await b.eval(`[...document.querySelectorAll('main select option')].map(e=>e.value)`), ['t_1', 't_1_entry_3']);
    await field(b, 'Search transactions', '');
    await b.eval(`(() => { const select=document.querySelector('main select');select.value='t_1_entry_3';select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await text(b, 'Statement entry 3'); await click(b, 'JSON');
    assert.equal(await buttonDisabled(b, 'Download JSON'), true);
    await route(b, `#/doc/${batch.batch.batch_id}/t_1_entry_1`, 'statement.png');
    await click(b, 'Fields'); await text(b, 'Statement entry 1'); await click(b, 'JSON');
    assert.equal(await buttonDisabled(b, 'Download JSON'), false);
    await route(b, '#/review', 'Review Queue');
    assert.equal(await b.eval('document.querySelectorAll("main tbody tr").length'), 1);
    await text(b, 'Date must be a valid YYYY-MM-DD date');
    await route(b, '#/json-explorer', 'JSON Explorer');
    await text(b, 't_1_entry_4');
    await b.eval('window.__statementURL = URL.createObjectURL; URL.createObjectURL = blob => { window.__statementBlob = blob; return window.__statementURL.call(URL, blob); };');
    try {
      await click(b, 'Download full JSON');
      const downloaded = await b.eval('window.__statementBlob.text().then(JSON.parse)');
      assert.deepEqual(downloaded.transactions, batch.transactions);
      assert.deepEqual(downloaded.documents[0].transaction_ids, batch.documents[0].transaction_ids);
    } finally { await b.eval('URL.createObjectURL = window.__statementURL; delete window.__statementURL; delete window.__statementBlob;'); }
  } },
  { name: 'upload-types', async run({b}) {
    await drop(b, 'scan.webp'); await text(b, 'INV-E2E-001');
    const batch = (await batches(b)).find(v => v.source_files[0].filename === 'scan.webp');
    checkEnvelope(batch);
    assert.equal(batch.source_files[0].media_type, 'image/webp');
    assert.equal(batch.pages.length, 1);
    assert.equal(batch.validation.structural_valid, true);
    await home(b);
    await b.eval(`(() => { const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['unsupported'],'scan.tiff',{type:'image/tiff'}));document.querySelector('section[aria-label="Drag and drop documents here"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer})); })()`);
    await text(b, 'Some files were not accepted.');
    await text(b, 'TIFF is not supported.');
    assert.equal((await batches(b)).length, 1);
  } },
  { name: 'label-studio', async run({b,mocks}) {
    mocks.setVariant('windowed');
    await drop(b,'labels.pdf',makePDF(30).toString('base64'));
    let batch=(await batches(b)).find(v=>v.source_files[0].filename==='labels.pdf');
    checkEnvelope(batch);
    const batchId=batch.batch.batch_id;
    const readBatch=async()=> (await batches(b)).find(v=>v.batch.batch_id===batchId);
    const selectDocument=async id=>{
      await b.eval(`(() => { const card=[...document.querySelectorAll('main [aria-label="Documents"] .ds-card')].find(e=>[...e.querySelectorAll('p')].some(p=>p.textContent===${js(id)})); if(!card)throw new Error('Document card missing'); card.querySelector('input').click(); })()`);
    };
    const selectPage=async number=>{
      await b.eval(`(() => { const input=[...document.querySelectorAll('main [aria-label="Pages"] input')].find(e=>e.parentElement.textContent.startsWith(${js('Select page '+number+' (')})); if(!input)throw new Error('Page card missing'); input.click(); })()`);
    };
    const review=async(action,reason)=>{
      const prior=(await readBatch()).reviews.length;
      await click(b,action); await checkLayoutWidths();
      await field(b,'Reason',reason); await click(b,'Apply review');
      await b.wait('!document.querySelector(\'[role="dialog"]\')','review dialog closes');
      batch=await until(async()=>{const v=await readBatch();return v.reviews.length>prior&&v;},'layout review persisted');
      checkEnvelope(batch);
      assert.equal(batch.validation.coverage_valid,true);
      assert.ok(batch.reviews.slice(prior).every(r=>r.actor_id==='local-user'&&r.reason===reason&&r.new_revision===r.prior_revision+1));
    };
    await route(b,'#/label-studio','Label Studio');
    const checkLayoutWidths = async () => {
      for (const profile of ['desktop', 'phone']) {
        await setProfile(b, profile); await settled(b);
        await overflow(b);
      }
      await setProfile(b, 'desktop'); await settled(b);
    };
    await checkLayoutWidths();
    const uncertain=batch.documents.find(d=>d.boundary_status==='needs_review');
    await selectDocument(uncertain.document_id); await review('Confirm boundary','Confirmed page grouping');
    assert.equal(batch.issues.some(i=>i.rule_code==='BOUNDARY_UNCERTAIN'&&i.status==='open'),false);
    const first=batch.documents[0];
    await selectDocument(first.document_id); await selectPage(first.page_refs[1].page_number);
    const count=batch.documents.length;
    await review('Split here','Separate later pages');
    assert.equal(batch.documents.length,count+1);
    const split=batch.documents.find(d=>d.document_id!==first.document_id&&d.transaction_ids.some(id=>batch.transactions.some(t=>t.transaction_id===id&&Object.keys(t.data).length===0)));
    assert.ok(split);
    const empty=batch.transactions.find(t=>t.document_id===split.document_id&&Object.keys(t.data).length===0);
    assert.ok(batch.issues.some(i=>i.target_id===empty.transaction_id&&i.rule_code==='MISSING_REQUIRED'&&i.status==='open'));
    const mergeIds=batch.documents.filter(d=>d.document_id!==split.document_id&&d.document_id!==first.document_id).slice(0,2).map(d=>d.document_id);
    const transactionIds=batch.transactions.map(t=>t.transaction_id);
    for(const id of mergeIds)await selectDocument(id);
    await review('Merge selected','Join related documents');
    assert.deepEqual(batch.transactions.map(t=>t.transaction_id),transactionIds);
    const failed=batch.pages.filter(p=>p.status==='error'||p.status==='pending');
    assert.ok(failed.length);
    const assignmentRevision = batch.batch.revision, assignmentReviews = batch.reviews.length;
    for(const page of failed)await selectPage(page.page_number);
    await click(b,'Assign pages to…');
    await checkLayoutWidths();
    await b.eval(`(() => { const select=document.querySelector('[role="dialog"] select');select.value=${js(first.document_id)};select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await field(b,'Reason','Assign failed pages after visual review'); await click(b,'Apply review');
    await b.wait('!document.querySelector(\'[role="dialog"]\')','assignment persisted');
    batch=await readBatch(); checkEnvelope(batch);
    assert.equal(batch.validation.coverage_valid,true);
    assert.equal(batch.batch.revision,assignmentRevision+failed.length);
    assert.equal(batch.reviews.length,assignmentReviews+failed.length);
    assert.ok(batch.reviews.slice(assignmentReviews).every((r,index)=>r.action==='assign'&&r.actor_id==='local-user'&&r.reason==='Assign failed pages after visual review'&&r.prior_revision===assignmentRevision+index&&r.new_revision===assignmentRevision+index+1));
    assert.ok(batch.pages.every(p=>p.status==='classified'));
    assert.ok(failed.every(p=>batch.pages.find(q=>q.page_number===p.page_number).regions.some(r=>r.document_id===first.document_id)));
    for(const d of batch.documents.filter(d=>d.boundary_status==='needs_review'))await selectDocument(d.document_id);
    await review('Confirm boundary','Confirmed revised boundaries');
    assert.ok(batch.reviews.some(r=>r.action==='assign'));
    assert.ok(batch.reviews.some(r=>r.action==='split'));
    assert.ok(batch.reviews.some(r=>r.action==='merge'));
    await checkLayoutWidths();
    await route(b,`#/doc/${batchId}/${empty.transaction_id}`,'labels.pdf');
    await click(b,'JSON'); assert.equal(await buttonDisabled(b,'Download JSON'),true,'Empty split transaction blocks export after boundary confirmation');
    await click(b,'Fields');
    for(const [name,value] of Object.entries({supplier_name:'Reviewed vendor',invoice_no:'LABEL-SPLIT-001',invoice_date:'2026-10-27',currency:'SGD',total_amount:'50.00'}))await correct(b,name,value);
    await click(b,'JSON');
    assert.equal(await buttonDisabled(b,'Download JSON'),false,'Filling split transaction required data unblocks export');
    batch=await readBatch(); checkEnvelope(batch);
    assert.equal(batch.validation.coverage_valid,true);
    assert.ok(batch.validation.export_eligible_transaction_ids.includes(empty.transaction_id));
  } },
  { name: 'templates', async run({b,mocks}) {
    await route(b, '#/templates', 'Templates');
    await text(b, 'Extraction profiles'); await text(b, 'Built-in · locked');
    await text(b, 'Standard fields by document type'); await overflow(b);
    await setProfile(b, 'phone'); await settled(b); await overflow(b);
    const headers = [{ key: 'document_no', label: 'Document number', type: 'text' }, { key: 'transaction_date', label: 'Transaction date', type: 'text' }, { key: 'remarks', label: 'Remarks', type: 'text' }];
    const columns = [{ key: 'row_no', label: 'Row number', type: 'text' }, { key: 'stock_code', label: 'Stock code', type: 'text' }, { key: 'stock_description', label: 'Stock description', type: 'text' }, { key: 'quantity', label: 'Quantity', type: 'text' }, { key: 'uom', label: 'UOM', type: 'text' }, { key: 'unit_price', label: 'Unit price', type: 'text' }, { key: 'line_subtotal', label: 'Line subtotal', type: 'text' }];
    await click(b, 'Create profile'); await field(b, 'Profile name', 'Shipping');
    for (const [i, item] of headers.entries()) {
      await click(b, 'Add header field'); await field(b, `Header fields ${i + 1} key`, item.key); await field(b, `Header fields ${i + 1} label`, item.label);
    }
    for (const [i, item] of columns.entries()) {
      await click(b, 'Add row column'); await field(b, `Row columns ${i + 1} key`, item.key); await field(b, `Row columns ${i + 1} label`, item.label);
    }
    await overflow(b); await click(b, 'Save profile');
    await b.wait('!document.querySelector(\'[role="dialog"]\')', 'profile saved');
    await click(b, 'Edit Shipping'); await field(b, 'Header fields 1 label', 'Shipping number'); await click(b, 'Save profile');
    await b.wait('!document.querySelector(\'[role="dialog"]\')', 'profile edited');
    await click(b, 'Duplicate Document info'); await click(b, 'Save profile'); await text(b, 'Document info copy');
    const originalCreateObjectURL = 'window.__templatesCreateObjectURL';
    await b.eval(`${originalCreateObjectURL} = URL.createObjectURL; window.__profileBlob = null; URL.createObjectURL = blob => { window.__profileBlob = blob; return ${originalCreateObjectURL}.call(URL, blob); };`);
    let exported;
    try {
      await click(b, 'Export Shipping');
      exported = await b.eval('window.__profileBlob.text().then(JSON.parse)');
      assert.deepEqual(Object.keys(exported).sort(), ['idp_studio_profiles', 'profiles']);
      assert.equal(exported.idp_studio_profiles, 1);
      assert.deepEqual(exported.profiles.map(p => p.name), ['Shipping']);
      assert.deepEqual(exported.profiles[0].fields, [{ ...headers[0], label: 'Shipping number' }, ...headers.slice(1)]);
      assert.deepEqual(exported.profiles[0].rowFields, columns);
      await click(b, 'Export all custom profiles');
      const all = await b.eval('window.__profileBlob.text().then(JSON.parse)');
      assert.deepEqual(all.profiles.map(p => p.name).sort(), ['Document info copy', 'Shipping']);
      assert.ok(all.profiles.every(p => !Object.hasOwn(p, 'builtin')));
    } finally {
      await b.eval(`URL.createObjectURL = ${originalCreateObjectURL}; delete ${originalCreateObjectURL}; delete window.__profileBlob;`);
    }
    const importExport = () => b.eval(`(() => { const input = document.querySelector('input[type=file]'); const transfer = new DataTransfer(); transfer.items.add(new File([${js(JSON.stringify(exported))}], 'profiles.json', {type:'application/json'})); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await importExport(); await text(b, 'Import profile conflicts'); await click(b, 'Cancel');
    assert.equal(await b.eval(`[...document.querySelectorAll('h3')].some(e=>e.textContent==='Shipping copy')`), false);
    await importExport(); await text(b, 'Import profile conflicts'); await click(b, 'Import as copies'); await text(b, 'Shipping copy');
    await overflow(b); await setProfile(b, 'desktop'); await settled(b); await overflow(b);
    await click(b, 'Use Shipping copy for next upload'); await home(b);
    assert.equal(await b.eval(`document.querySelector('input[value="targeted"]')?.checked`), true);
    mocks.setVariant('targeted'); await drop(b, 'templates.png'); await text(b, 'DOC-TARGET-001'); await text(b, 'SKU-1'); await text(b, 'Shipping number');
    assert.ok(posts(mocks).some(r => r.body.includes('stock_code')));
    const batch = (await batches(b)).find(v => v.source_files[0].filename === 'templates.png');
    assert.deepEqual(batch.transactions[0].data, {
      document_no: 'DOC-TARGET-001', transaction_date: '2026-10-26', remarks: 'Targeted delivery',
      line_items: [1, 2].map(n => ({ row_no: String(n), stock_code: `SKU-${n}`, stock_description: `Stock ${n}`, quantity: '2', uom: 'PCS', unit_price: '5.00', line_subtotal: '10.00' })),
    });
    await route(b, '#/templates', 'Templates'); await text(b, 'Used by Targeted mode for the next upload');
    await click(b, 'Delete Shipping'); await click(b, 'Cancel'); await text(b, 'Shipping');
    await click(b, 'Delete Shipping'); await click(b, 'Delete profile');
    await b.wait(`![...document.querySelectorAll('h3')].some(e=>e.textContent==='Shipping')`, 'profile deleted');
    await text(b, 'Shipping copy');
    await settings(b); await text(b, 'Manage templates');
    assert.equal(await b.eval(`document.querySelector('main a[href="#/templates"]')?.textContent`), 'Manage templates');
    assert.equal(await b.eval(`[...document.querySelectorAll('main button')].some(e=>e.textContent==='Create profile')`), false);
  } },
  { name: 'validation', async run({b,mocks}) {
    await drop(b); await text(b, 'INV-E2E-001');
    const defaultWorkspace = await fullJSON(b);
    await home(b); mocks.setVariant('validation-targeted');
    await radio(b, 'Extraction mode', 'targeted');
    await b.eval(`(() => {const e=document.querySelector('main select');e.value='doc-info-rows';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await drop(b, 'validation-targeted.png'); await text(b, 'Targeted delivery');
    const targetedWorkspace = await fullJSON(b);
    const initial = await batches(b);
    assert.equal(initial.length, 2);
    const targetedBatch = initial.find(v => v.source_files[0].filename === 'validation-targeted.png');
    const low = targetedBatch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE');
    assert.ok(low); assert.ok(targetedBatch.issues.some(i => i.rule_code === 'MISSING_REQUIRED'));
    assert.deepEqual(defaultWorkspace.issues, initial.find(v => v.batch.batch_id === defaultWorkspace.batch.batch_id).issues);
    assert.deepEqual(targetedWorkspace.issues, targetedBatch.issues);
    await route(b, '#/validation', 'Validation');
    await text(b, 'Export eligibility');
    const selectFilter = async (label, value) => b.eval(`(() => {const label=[...document.querySelectorAll('label')].find(e=>e.textContent===${js(label)});const e=document.getElementById(label.htmlFor);e.value=${js(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    for (const severity of ['blocking','error','warning','info']) {
      const count = initial.flatMap(v => v.issues).filter(i => i.status === 'open' && i.severity === severity).length;
      await text(b, `Open ${severity}: ${count}`);
    }
    await text(b, '1 eligible · 1 blocked transactions');
    await selectFilter('Batch', targetedBatch.batch.batch_id);
    await selectFilter('Rule', 'LOW_CONFIDENCE');
    assert.equal(await b.eval(`document.querySelectorAll('[aria-label="Validation issues"] tbody tr').length`), 1);
    const issueLink = await b.eval(`document.querySelector('[aria-label="Validation issues"] tbody a')?.getAttribute('href')`);
    assert.ok(issueLink.includes(encodeURIComponent(targetedBatch.batch.batch_id)));
    await click(b, 'Waive');
    await field(b, 'Waiver reason', 'short');
    assert.equal(await buttonDisabled(b, 'Save waiver'), true);
    await field(b, 'Waiver reason', 'Verified original source in validation E2E'); await click(b, 'Save waiver');
    await b.wait(`!document.querySelector('[role=dialog]')`, 'waiver persisted');
    let saved = (await batches(b)).find(v => v.batch.batch_id === targetedBatch.batch.batch_id);
    const waived = saved.issues.find(i => i.issue_id === low.issue_id);
    assert.equal(waived.status, 'waived');
    assert.ok(saved.reviews.some(r => r.review_id === waived.waiver_review_id && r.action === 'waive'));
    assert.equal(saved.reviews.at(-1).reason, 'Verified original source in validation E2E');
    await click(b, 'Revalidate all'); await text(b, 'integrity errors');
    await b.wait(`![...document.querySelectorAll('button')].find(e=>e.textContent==='Revalidate all')?.disabled`, 'all batches revalidated');
    saved = (await batches(b)).find(v => v.batch.batch_id === targetedBatch.batch.batch_id);
    assert.equal(saved.issues.find(i => i.issue_id === low.issue_id).status, 'waived');
    await selectFilter('Status', 'waived'); await click(b, 'Reopen');
    await field(b, 'Waiver reason', 'Reopen after additional source inspection'); await click(b, 'Save reopen');
    await b.wait(`!document.querySelector('[role=dialog]')`, 'reopen persisted');
    await selectFilter('Status', 'open'); await selectFilter('Rule', 'MISSING_REQUIRED');
    await text(b, 'Cannot waive mandatory integrity or extraction rules');
    assert.equal(await b.eval(`[...document.querySelectorAll('[aria-label=\"Validation issues\"] button')].some(e=>e.textContent==='Waive')`), false);
    await click(b, 'Revalidate all'); await text(b, 'integrity errors');
    await b.wait(`![...document.querySelectorAll('button')].find(e=>e.textContent==='Revalidate all')?.disabled`, 'reopened batch revalidated');
    saved = (await batches(b)).find(v => v.batch.batch_id === targetedBatch.batch.batch_id);
    assert.equal(saved.issues.find(i => i.issue_id === low.issue_id).status, 'open');
    assert.equal(saved.reviews.at(-1).action, 'reject');
    assert.equal(saved.issues.find(i => i.issue_id === low.issue_id).waiver_review_id, null);
    await field(b, 'Search rules', 'TOTALS_MISMATCH');
    await click(b, 'TOTALS_MISMATCH');
    await text(b, 'authorized reconciliation exception');
    await overflow(b);
    await setProfile(b, 'phone'); await settled(b); await overflow(b);
    await b.eval(`document.documentElement.dataset.theme='dark'`);
    await overflow(b);
    await setProfile(b, 'desktop'); await settled(b); await overflow(b);
  } },
  { name: 'json-explorer', async run({b,mocks}) {
    await drop(b); await text(b, 'INV-E2E-001');
    await route(b, '#/json-explorer', 'JSON Explorer');
    await b.wait('!!document.querySelector(\'[role="tree"] [role="treeitem"]\')', 'JSON tree rendered');
    assert.equal(await b.eval(`document.querySelector('[data-pointer="/batch"]').getAttribute('aria-expanded')`), 'true', 'Top-level batch metadata starts expanded');
    assert.equal(await b.eval(`document.querySelector('[data-pointer="/transactions"]').getAttribute('aria-expanded')`), 'true', 'Top-level transactions start expanded');
    for (const pointer of ['/transactions/0','/transactions/0/data']) {
      await b.eval(`document.querySelector('[data-pointer="${pointer}"]').click()`);
    }
    assert.equal(await b.eval(`document.querySelector('[data-pointer="/transactions/0/data"]').getAttribute('aria-expanded')`), 'true');
    await field(b, 'Search JSON', 'INV-E2E-001');
    await b.wait(`!![...document.querySelectorAll('[role="status"]')].find(e=>/\\d+ matches/.test(e.textContent)&&!e.textContent.startsWith('0 '))`, 'invoice search completed');
    await click(b, 'Next match');
    assert.match(await b.eval(`document.querySelector('.ds-json-pointer').textContent`), /invoice_no|value/);
    const firstMatch = await b.eval(`document.querySelector('.ds-json-pointer').textContent`);
    await click(b, 'Previous match');
    assert.notEqual(await b.eval(`document.querySelector('.ds-json-pointer').textContent`), firstMatch, 'Previous wraps to another invoice match');
    await click(b, 'Next match');
    assert.equal(await b.eval(`document.querySelector('.ds-json-pointer').textContent`), firstMatch, 'Next returns to the first match');
    await b.send('Browser.grantPermissions', { origin: await b.eval('location.origin'), permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await click(b, 'Copy pointer');
    await text(b, 'Pointer copied.');
    await b.send('Browser.resetPermissions');
    assert.ok(await b.eval(`[...document.querySelectorAll('.ds-badge')].some(e=>e.textContent==='Valid')`), 'Batch validator reports valid');
    await overflow(b);
    await home(b); mocks.setVariant('windowed');
    await drop(b, 'explorer-30.pdf', makePDF(30).toString('base64'));
    const batch = (await batches(b)).find(v => v.source_files[0].filename === 'explorer-30.pdf');
    assert.equal(batch.pages.length, 30);
    const started = Date.now();
    await route(b, '#/json-explorer', 'JSON Explorer');
    await b.eval(`(() => {const e=[...document.querySelectorAll('main select')].find(e=>[...e.options].some(o=>o.value===${js(batch.batch.batch_id)}));e.value=${js(batch.batch.batch_id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click(b, 'Evidence');
    await b.wait(`!!document.querySelector('[role="tab"][aria-selected="true"]')&&[...document.querySelectorAll('[role="tab"]')].some(e=>e.textContent==='Evidence'&&e.getAttribute('aria-selected')==='true')`, 'large batch click responsive', 2000);
    assert.ok(Date.now() - started < 2000, '30-page Explorer opens and handles a click within 2 seconds');
  } },
  { name: 'ai-agents', async run({b,mocks}) {
    await route(b, '#/ai-agents', 'AI Agents');
    await field(b, 'Maximum model turns', '3');
    await b.eval(`(() => { const label = [...document.querySelectorAll('label')].find(e => e.textContent === 'crop_zoom'); label.querySelector('input').click(); })()`);
    await click(b, 'Save agent configuration');
    await text(b, 'Agent configuration saved.');
    mocks.setVariant('agent-tools');
    await home(b); await drop(b, 'agents-history.png'); await text(b, 'INV-E2E-001');
    assert.ok(posts(mocks).every(r => !JSON.parse(r.body).tools.some(t => t.name === 'crop_zoom')));
    await route(b, '#/ai-agents', 'AI Agents');
    await b.wait(`[...document.querySelectorAll('button')].some(e => e.textContent.startsWith('agents-history.png ·'))`, 'saved run');
    await b.eval(`[...document.querySelectorAll('button')].find(e => e.textContent.startsWith('agents-history.png ·')).click()`);
    await b.wait(`!!document.querySelector('ol[aria-label="Step timeline"]')`, 'step timeline');
    assert.ok(await b.eval('document.querySelectorAll("ol[aria-label=\\"Step timeline\\"] li").length > 0'));
    const outcome = await b.eval(`document.querySelector('[aria-label="Run details"] p').textContent.split(' · ')[0]`);
    await b.eval(`(() => { const e = document.querySelector('main select'); e.value = 'cancelled'; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await text(b, 'No runs');
    await b.eval(`(() => { const e = document.querySelector('main select'); e.value = ${js(outcome)}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await text(b, 'agents-history.png');
    await click(b, 'Reset to defaults');
    assert.equal(await b.eval('Number(document.querySelector("main input[type=number]").value)'), 8);
    assert.equal(await b.eval(`JSON.parse(localStorage.getItem('idp-studio.agent-config.v1')).tools.crop_zoom`), true);
    await settings(b); await click(b, 'Clear all local data'); await click(b, 'Delete all local data');
    await route(b, '#/ai-agents', 'AI Agents'); await text(b, 'No runs');
    await overflow(b);
  } },
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
  { name: 'agent-tools', async run({b,mocks}) {
    mocks.setVariant('agent-tools');
    await drop(b, 'agent-tools.png'); await text(b, 'INV-E2E-001');
    const requests = posts(mocks).map(r => JSON.parse(r.body));
    assert.equal(requests.length, 2);
    assert.ok(requests[0].tools.some(t => t.name === 'crop_zoom'));
    const output = requests[1].input.find(item => item.type === 'function_call_output');
    assert.ok(output, 'Tool result is sent to the next model turn');
    assert.ok(Array.isArray(output.output) && output.output.some(part => part.type === 'input_image'), 'Tool result forwards the re-rendered image');
    for (const payload of requests) assert.equal(Object.hasOwn(payload, 'max_output_tokens'), false);
    const batch = (await batches(b)).find(v => v.source_files[0].filename === 'agent-tools.png');
    checkEnvelope(batch);
    assert.equal(batch.transactions[0].data.invoice_no, 'INV-E2E-001');
    assert.notEqual(batch.transactions[0].status, 'approved');
  } },
  { name: 'upload-demo', async run({b,mocks}) {
    await drop(b); await text(b, 'INV-E2E-001');
    const requests = posts(mocks); assert.equal(requests.length, 1);
    const r = requests[0]; assert.ok(r.body.includes('input_image')); assert.ok(Object.entries(r.headers).some(([k,v])=>k.toLowerCase()==='authorization' && String(v).startsWith('Bearer dmo_e2e_')));
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
  { name: 'page-limit', async run({b}) {
    await settings(b); await field(b,'Maximum pages per extraction','12'); await click(b,'Save extraction settings'); await home(b);
    await drop(b,'limited.pdf',makePDF(25).toString('base64'));
    const batch=(await batches(b)).find(v=>v.source_files[0].filename==='limited.pdf');
    checkEnvelope(batch);
    assert.equal(batch.pages.filter(p=>p.status==='classified').length,12);
    assert.deepEqual(batch.pages.filter(p=>p.status==='pending').map(p=>p.page_number),Array.from({length:13},(_,i)=>i+13));
    assert.ok(batch.issues.some(i=>i.rule_code==='PAGE_LIMIT_EXCEEDED'&&i.severity==='blocking'&&i.status==='open'));
    assert.equal(await buttonDisabled(b,'Approve'),true);
    await click(b,'JSON'); assert.equal(await buttonDisabled(b,'Download JSON'),true);
    await settings(b); await field(b,'Maximum pages per extraction','25'); await click(b,'Save extraction settings');
    await route(b,`#/doc/${batch.batch.batch_id}`,'limited.pdf'); await click(b,'Retry extraction');
    const next=await until(async()=>{const v=(await batches(b)).find(x=>x.batch.batch_id===batch.batch.batch_id);return v&&v.pages.filter(p=>p.status==='classified').length===25&&v;},'retry completed',120000);
    assert.equal(next.pages.filter(p=>p.status==='classified').length,25);
    assert.ok(!next.issues.some(i=>i.rule_code==='PAGE_LIMIT_EXCEEDED'&&i.status==='open'));
  } },
  { name: 'windowed-multi-doc', async run({b,mocks}) {
    mocks.setVariant('windowed');
    await drop(b,'multi.pdf',makePDF(30).toString('base64'));
    let batch=(await batches(b)).find(v=>v.source_files[0].filename==='multi.pdf');
    checkEnvelope(batch);
    assert.equal(batch.documents.length,5);
    assert.deepEqual(batch.pages.filter(p=>p.status==='error').map(p=>p.page_number),[16,17,18,19,20]);
    assert.ok(batch.issues.some(i=>i.rule_code==='BOUNDARY_UNCERTAIN'&&i.status==='open'));
    const before=posts(mocks).length;
    const extracted=mocks.extractionPages.length;
    await reload(b); await text(b,'multi.pdf'); await click(b,'Retry extraction');
    const id=batch.batch.batch_id;
    batch=await until(async()=>{const v=(await batches(b)).find(x=>x.batch.batch_id===id);return v&&v.pages.every(p=>p.status==='classified')&&v;},'segment retry completed',120000);
    checkEnvelope(batch);
    assert.equal(batch.documents.length,6);
    assert.deepEqual(batch.documents.flatMap(d=>d.page_refs.map(p=>p.page_number)),Array.from({length:30},(_,i)=>i+1));
    assert.ok(batch.pages.every(p=>p.status==='classified'));
    assert.equal(posts(mocks).length-before,3,'Only the failed document is retried in two-page chunks');
    assert.deepEqual(mocks.extractionPages.slice(extracted),[16,18,20]);
    assert.deepEqual([...new Set(batch.evidence.flatMap(e=>e.sources.map(s=>s.page_number)))],[1,6,11,16,21,26]);
    const uncertain=batch.documents.find(d=>d.boundary_status==='needs_review');
    assert.ok(uncertain);
    await route(b,`#/doc/${batch.batch.batch_id}/${uncertain.transaction_ids[0]}`,'multi.pdf');
    assert.equal(await buttonDisabled(b,'Approve'),true);
    await click(b,'JSON'); assert.equal(await buttonDisabled(b,'Download JSON'),true);
    await route(b,`#/doc/${batch.batch.batch_id}/${batch.transactions[0].transaction_id}`,'multi.pdf');
    await b.wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Approve'&&!e.disabled)`,'unaffected document approval');
    await click(b,'Approve'); await click(b,'JSON');
    assert.equal(await buttonDisabled(b,'Download JSON'),false,'Boundary blocker belongs only to the uncertain document');
  } },
  { name: 'demo-six-page-document', async run({b,mocks}) {
    mocks.setVariant('six-page');
    await drop(b,'six-pages.pdf',makePDF(6).toString('base64'));
    const batch=(await batches(b)).find(v=>v.source_files[0].filename==='six-pages.pdf');
    checkEnvelope(batch);
    assert.equal(batch.documents.length,1);
    assert.deepEqual(batch.documents[0].page_refs.map(p=>p.page_number),[1,2,3,4,5,6]);
    assert.equal(batch.transactions[0].data.reference,'SIX-PAGES');
    assert.deepEqual(batch.transactions[0].data.line_items.map(row=>row.description),['Pages 1-2','Pages 3-4','Pages 5-6']);
    assert.deepEqual(mocks.extractionPages,[1,3,5]);
    assert.equal(posts(mocks).length,5,'Two segmentation windows and three extraction chunks');
    await mocks.assertSafe();
  } },
  { name: 'migration', beforeLoad: true, async run({b,url}) {
    // A same-origin empty resource allows seeding BEFORE any application JavaScript executes.
    await b.navigate(new URL('manifest.webmanifest',url).href);
    const output=invoice(); const extraction=Object.fromEntries(output.fields.map(f=>[f.key,f.value])); extraction.line_items=output.line_items;
    await b.eval(`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const blob=await new Promise(r=>c.toBlob(r,'image/png'));await new Promise((resolve,reject)=>{const r=indexedDB.open('idp-studio',1);r.onupgradeneeded=()=>{r.result.createObjectStore('documents',{keyPath:'id'});r.result.createObjectStore('files')};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const t=d.transaction(['documents','files'],'readwrite');t.objectStore('documents').put({id:'old-e2e',name:'legacy.png',mime:'image/png',size:blob.size,createdAt:1792972800000,pageCount:1,envelope:{schema_version:'1.0',document_id:'old-e2e',document_type:'purchase_invoice',status:'ready',extraction:${js(extraction)},evidence:{},validation:{schema_valid:true,totals_match:true,missing_required:[],low_confidence:[],standards_issues:[],needs_review:false},model:null,audit:[]}});t.objectStore('files').put(blob,'old-e2e');t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>reject(t.error)}})})()`);
    await b.navigate(url); await text(b,'legacy.png'); let rows=await batches(b); assert.equal(rows.length,1); assert.equal(rows[0].batch.batch_id,'legacy_old-e2e');
    await reload(b); await text(b,'legacy.png'); rows=await batches(b); assert.equal(rows.length,1);
    assert.deepEqual(await b.eval(`new Promise((resolve,reject)=>{const r=indexedDB.open('idp-studio');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;const t=d.transaction(['documents','files'],'readonly');const a=t.objectStore('documents').get('old-e2e'),f=t.objectStore('files').get('old-e2e');t.oncomplete=()=>{d.close();resolve([!!a.result, f.result instanceof Blob])}}})`),[true,true]);
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
    await b.eval('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)'); await text(b,'A newer version is available'); assert.equal(b.navigations,initial,'No automatic update reload'); await text(b,'Build e2e-1');
    const promptQuietUntil=Date.now()+3000;
    await until(()=>{assert.equal(b.navigations,initial,'No automatic update reload while prompt waits');return Date.now()>=promptQuietUntil},'update prompt navigation stability',6000);
    await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('e2eReloads',String(Number(sessionStorage.getItem('e2eReloads')||0)+1))`});
    await b.eval(`(()=>{const o=new MutationObserver(()=>{const loader=[...document.querySelectorAll('[role="status"]')].find(e=>e.textContent.includes('Updating IDP Studio'));if(loader?.getClientRects().length&&getComputedStyle(loader).visibility!=='hidden')sessionStorage.setItem('e2eOverlay','seen')});o.observe(document.body,{subtree:true,childList:true,characterData:true})})()`);
    await click(b,'Update now'); await text(b,'Build e2e-2'); assert.equal(await b.eval('sessionStorage.getItem("e2eOverlay")'),'seen','Updating loader observed before navigation');
    await b.wait('navigator.serviceWorker.getRegistration().then(r=>!!r?.active&&!r.waiting&&!r.installing)','updated worker settled'); await settled(b);
    const quietUntil=Date.now()+2000;
    await until(()=>{assert.equal(b.navigations-initial,1,'No update reload loop');return Date.now()>=quietUntil},'post-update navigation stability',5000);
    assert.equal(b.navigations-initial,1,'Exactly one navigation'); assert.equal(await b.eval('sessionStorage.getItem("e2eReloads")'),'1'); assert.equal(await b.eval('document.body.innerText.includes("A newer version is available")'),false);
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
  ...['desktop', 'phone'].map(profile => ({ name: profile === 'desktop' ? 'top-bar-scroll' : 'top-bar-scroll-mobile', profile, async run({b}) {
    await route(b, '#/design', 'Design system');
    await b.eval('document.activeElement?.blur();window.scrollTo(0,0)');
    await b.wait('window.scrollY===0', 'page starts at top');
    assert.equal(await b.eval('!!document.querySelector(\'[aria-label="Scroll to top"]\')'), false);
    const hidden = `getComputedStyle(document.querySelector('.ds-topbar')).transform!=='none'&&document.querySelector('.ds-topbar').getBoundingClientRect().bottom<=1`;
    await b.eval('window.scrollTo(0,window.innerHeight+300)');
    await b.wait(`window.scrollY>window.innerHeight&&${hidden}`, 'topbar hides after downward scrolling');
    await b.wait('!!document.querySelector(\'[aria-label="Scroll to top"]\')', 'scroll-to-top is available');
    await b.eval(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Show toast').click()`);
    await b.wait(`document.querySelector('.ds-scroll-top').getBoundingClientRect().bottom<document.querySelector('.ds-toast').getBoundingClientRect().top`, 'scroll-to-top clears the toast');
    await b.eval(`document.querySelector('[aria-label="Dismiss notification"]').click()`);
    await b.eval('window.scrollBy(0,-80)');
    await b.wait(`getComputedStyle(document.querySelector('.ds-topbar')).transform==='none'`, 'topbar reveals after upward scrolling');
    await b.eval('window.scrollTo(0,32)');
    await b.wait(`getComputedStyle(document.querySelector('.ds-topbar')).transform==='none'`, 'near-top header remains visible');
    await b.eval('window.scrollTo(0,window.innerHeight+300)');
    await b.wait('!!document.querySelector(\'[aria-label="Scroll to top"]\')', 'scroll-to-top returns');
    await b.eval('document.querySelector(\'[aria-label="Scroll to top"]\').click()');
    await b.wait('window.scrollY===0&&!document.querySelector(\'[aria-label="Scroll to top"]\')', 'scroll-to-top returns to top');
    await b.wait(`getComputedStyle(document.querySelector('.ds-topbar')).transform==='none'`, 'header visible at top');
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await b.wait(`getComputedStyle(document.querySelector('.ds-topbar')).transitionDuration==='0s'`, 'reduced motion disables header transition');
    await b.eval('window.scrollTo(0,window.innerHeight+300)');
    await b.wait(hidden, 'reduced-motion scroll still hides header');
    await b.eval('document.querySelector(\'[aria-label="Scroll to top"]\').click()');
    assert.equal(await b.eval('window.scrollY'), 0, 'Reduced-motion scroll-to-top is immediate');
  } })),
  { name: 'unknown-route-update', async run({b,server,buildApp,buildB}) {
    await pwa(b); await reload(b); await b.wait('!!navigator.serviceWorker.controller', 'controlled build A');
    await route(b, '#/missing', 'Page not found');
    await b.wait('navigator.serviceWorker.getRegistration().then(r=>!r.waiting&&!r.installing)', 'no update for current build');
    assert.equal(await b.eval('!![...document.querySelectorAll("button")].find(e=>e.textContent==="Update now")'), false);
    await click(b, 'Go to Home'); await text(b, 'Upload Documents');
    await buildApp('e2e-2', buildB); server.setRoot(buildB);
    const initial = b.navigations;
    await route(b, '#/missing-again', 'Page not found');
    await text(b, 'A newer version is available');
    assert.equal(b.navigations, initial, 'Unknown route does not activate the waiting worker');
    await click(b, 'Update now'); await text(b, 'Build e2e-2');
    await b.wait('navigator.serviceWorker.getRegistration().then(r=>!r.waiting&&!r.installing)', 'new worker settled');
    assert.equal(b.navigations - initial, 1, 'Exactly one update navigation');
    await text(b, 'Page not found'); await click(b, 'Documents');
    await b.wait('location.hash==="#/documents"&&document.querySelector("main h1")?.textContent==="Documents"', 'Documents recovery route');
  } },
  { name: 'install-integrity', async run({b,server,buildApp,buildB}) {
    await pwa(b); await reload(b); await b.wait('!!navigator.serviceWorker.controller', 'controlled build A');
    const originalCaches = await b.eval('caches.keys()');
    await buildApp('e2e-2', buildB);
    await writeFile(join(buildB, 'build-info.json'), JSON.stringify({ build: 'wrong-build' }));
    server.setRoot(buildB);
    await b.eval(`navigator.serviceWorker.getRegistration().then(async r=>{await r.update();window.integrityCandidate=r.installing;return true}).catch(()=>true)`);
    await b.wait('!window.integrityCandidate||window.integrityCandidate.state==="redundant"', 'mixed build rejected');
    assert.equal(await b.eval('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)'), false);
    assert.deepEqual(await b.eval('caches.keys()'), originalCaches, 'Only the failed candidate cache is removed');
    await reload(b); await text(b, 'Build e2e-1');
    assert.equal(await b.eval('document.body.innerText.includes("A newer version is available")'), false);
    await writeFile(join(buildB, 'build-info.json'), JSON.stringify({ build: 'e2e-2' }));
    await b.eval('navigator.serviceWorker.getRegistration().then(r=>r.update()).then(()=>true)');
    await text(b, 'A newer version is available');
    await text(b, 'Build e2e-1');
    const keys = await b.eval('caches.keys().then(names=>Promise.all(names.map(name=>caches.open(name).then(c=>c.keys().then(keys=>keys.map(k=>k.url))))))');
    assert.ok(keys.flat().every(url => !new URL(url).search), 'Canonical precache keys have no query');
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
