import assert from 'node:assert/strict';
let sessionSeq = 0; const tokenUses = new Map();
export const TEST_KEY = 'sk-e2e-not-a-real-key';
export function invoice(bad = false) {
  return { document_type: 'purchase_invoice', fields: Object.entries({ supplier_name: 'E2E Supplier', invoice_no: 'INV-E2E-001', invoice_date: bad ? '26/10/2026' : '2026-10-26', currency: 'SGD', total_amount: bad ? '12.00' : '10.00' }).map(([key, value]) => ({ key, value, page: 1, bbox: [100, 100, 200, 500], confidence: 0.99 })), line_items: [{ description: 'E2E service', quantity: '1', unit_price: '10.00', amount: '10.00' }] };
}
export function targeted() {
  return { document_type: 'unknown', fields: Object.entries({ document_no: 'DOC-TARGET-001', transaction_date: '2026-10-26', remarks: 'Targeted delivery' }).map(([key, value]) => ({ key, value, page: 1, bbox: [100, 100, 200, 500], confidence: 0.99 })), line_items: [1, 2].map(n => Object.fromEntries(Object.entries({ row_no: String(n), stock_code: `SKU-${n}`, stock_description: `Stock ${n}`, quantity: '2', uom: 'PCS', unit_price: '5.00', line_subtotal: '10.00' }).map(([key, value]) => [key, { value, page: 1, bbox: [300 + n * 50, 100, 340 + n * 50, 900], confidence: 0.98 }]))) };
}
export function responseStream(text) {
  const item = { id: 'msg_e2e', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  const response = { id: 'resp_e2e', object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: 'demo-auto', output: [item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    ['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
    ['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
    ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text }],
    ['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text }],
    ['response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
    ['response.output_item.done', { output_index: 0, item }],
    ['response.completed', { response }],
  ];
  return events.map(([type, body], sequence_number) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number, ...body })}\n\n`).join('');
}
export function toolResponseStream(name, args, id) {
  const item = { id: `fc_${id}`, type: 'function_call', call_id: id, name, arguments: JSON.stringify(args), status: 'completed' };
  // The real gateway emits an empty reasoning item before every tool call.
  const reasoning = { id: `rs_${id}`, type: 'reasoning', content: [], summary: [] };
  const response = { id: `resp_${id}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: 'demo-auto', output: [reasoning, item], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [
    ['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
    ['response.output_item.added', { output_index: 0, item: reasoning }],
    ['response.output_item.done', { output_index: 0, item: reasoning }],
    ['response.output_item.added', { output_index: 1, item: { ...item, arguments: '', status: 'in_progress' } }],
    ['response.function_call_arguments.delta', { item_id: item.id, output_index: 1, delta: item.arguments }],
    ['response.function_call_arguments.done', { item_id: item.id, output_index: 1, arguments: item.arguments }],
    ['response.output_item.done', { output_index: 1, item }],
    ['response.completed', { response }],
  ];
  return events.map(([type, body], sequence_number) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number, ...body })}\n\n`).join('');
}
export async function installMocks(b, { baseURL, live = false } = {}) {
  const origin = new URL(baseURL).origin;
  const providers = new Set(['api.openai.com', 'openrouter.ai', 'generativelanguage.googleapis.com', 'gpt.yapweijun1996.com']);
  let variant = 'valid'; let replies = 0;
  const requests = []; const violations = []; const pending = new Set();
  const extractionPages = [];
  const attempts = new Map();
  const handle = async e => {
    const r = e.request; const u = new URL(r.url);
    if (!['http:', 'https:'].includes(u.protocol)) { await b.send('Fetch.continueRequest', { requestId: e.requestId }); return; }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if ((live && u.origin === origin && ['GET', 'HEAD'].includes(r.method)) || (!live && local && u.origin === origin)) {
      await b.send('Fetch.continueRequest', { requestId: e.requestId }); return;
    }
    requests.push({ url: r.url, method: r.method, headers: r.headers, body: r.postData || '' });
    if (!providers.has(u.hostname) || live) {
      violations.push(`Blocked ${r.method} ${u.origin}${u.pathname}`);
      await b.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }); return;
    }
    const cors = [ { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: r.headers['Access-Control-Request-Headers'] || r.headers['access-control-request-headers'] || '*' }, { name: 'Access-Control-Allow-Credentials', value: 'true' } ];
    const fulfill = (status, body, type = 'application/json') => b.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: status, responseHeaders: [...cors, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
    if (r.method === 'OPTIONS') { await fulfill(204, ''); return; }
    if (r.method === 'POST' && u.hostname === 'gpt.yapweijun1996.com' && u.pathname === '/demo/session') {
      await fulfill(201, JSON.stringify({ token: `dmo_e2e_${++sessionSeq}`, token_type: 'Bearer', expires_in: 900, expires_at: new Date(Date.now() + 900000).toISOString(), model: 'demo-auto' })); return;
    }
    if (variant === 'network-error' && r.method === 'POST' && u.pathname.endsWith('/responses')) { await b.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }); return; }
    if (variant === 'rate-limit') { await fulfill(429, JSON.stringify({ error: { message: 'E2E rate limit', type: 'rate_limit_error' } })); return; }
    if (r.method === 'POST' && ((u.hostname === 'api.openai.com' && u.pathname === '/v1/responses') || (u.hostname === 'gpt.yapweijun1996.com' && u.pathname === '/demo/v1/responses'))) {
      if (u.hostname === 'gpt.yapweijun1996.com' && Object.hasOwn(JSON.parse(r.postData || '{}'), 'max_output_tokens')) {
        await fulfill(400, JSON.stringify({ error: { message: 'max_output_tokens is disabled for the demo' } })); return;
      }
      if (u.hostname === 'gpt.yapweijun1996.com' && (JSON.parse(r.postData || '{}').input || []).some?.(item => item?.type === 'reasoning')) {
        await fulfill(400, JSON.stringify({ error: { message: 'content is not allowed in reasoning items', code: 'DEMO_FIELD_DISABLED', type: 'invalid_request_error' } })); return;
      }
      if (u.hostname === 'gpt.yapweijun1996.com') {
        const token = String(r.headers.Authorization || r.headers.authorization || '');
        const uses = (tokenUses.get(token) ?? 0) + 1; tokenUses.set(token, uses);
        if (uses > 20) { await fulfill(429, JSON.stringify({ error: { message: 'demo session request limit reached', code: 'DEMO_SESSION_REQUEST_LIMIT', type: 'rate_limit_error' } })); return; }
      }
      const payload = JSON.parse(r.postData || '{}');
      const prompt = JSON.stringify(payload.input ?? []);
      if (u.hostname === 'gpt.yapweijun1996.com' && (prompt.match(/"type"\s*:\s*"input_image"/g) ?? []).length > 4) {
        await fulfill(400, JSON.stringify({ error: { message: 'demo image page limit exceeded', code: 'DEMO_IMAGE_COUNT_EXCEEDED', type: 'invalid_request_error' } })); return;
      }
      if (JSON.stringify(payload).includes('Segment documents.')) {
        const pages = [...new Set([...prompt.matchAll(/Page (\d+):/g)].map(m => Number(m[1])))];
        await fulfill(200, responseStream(JSON.stringify({ pages: pages.map(page => ({
          page, document_type: variant === 'six-page' ? 'unknown' : 'purchase_invoice', starts_new_document: variant === 'six-page' ? page === 1 : (page - 1) % 5 === 0,
          confidence: variant === 'windowed' && page === 11 ? 0.5 : 1,
        })) })), 'text/event-stream');
        return;
      }
      const start = Number(prompt.match(/Images in order: Page (\d+)/)?.[1] ?? 1);
      extractionPages.push(start);
      attempts.set(start, (attempts.get(start) ?? 0) + 1);
      if (variant === 'windowed' && start === 16 && attempts.get(start) <= 2) {
        await fulfill(200, responseStream('not JSON: forced segment failure'), 'text/event-stream');
        return;
      }
      replies++;
      if (variant === 'agent-tools') {
        const payload = JSON.parse(r.postData || '{}');
        const hasOutput = Array.isArray(payload.input) && payload.input.some(item => item.type === 'function_call_output');
        await fulfill(200, hasOutput
          ? toolResponseStream('submit_result', { json: invoice() }, 'submit_e2e')
          : toolResponseStream('crop_zoom', { page: 1, ymin: 100, xmin: 100, ymax: 500, xmax: 900, scale: 6 }, 'crop_e2e'), 'text/event-stream');
        return;
      }
      const output = variant === 'targeted' || variant === 'validation-targeted' ? targeted() : invoice(variant === 'bad');
      if (variant === 'validation-targeted') {
        output.fields.find(f => f.key === 'document_no').value = '';
        output.fields.find(f => f.key === 'remarks').confidence = 0.5;
      }
      output.fields.forEach(field => { field.page = start; });
      if (variant === 'six-page') {
        output.document_type = 'unknown';
        output.fields = start === 1 ? [{ key: 'reference', value: 'SIX-PAGES', page: 1, bbox: [100, 100, 200, 500], confidence: 1 }] : [];
        output.line_items = [{ description: `Pages ${start}-${start + 1}`, quantity: '1', unit_price: '10.00', amount: '10.00' }];
      } else if (JSON.stringify(payload).includes('Earlier pages of this same document')) {
        output.fields = [];
        output.line_items = [];
      }
      const text = variant === 'invalid' || (variant === 'repair' && replies === 1) ? 'not JSON: E2E invalid reply' : JSON.stringify(output);
      await fulfill(200, responseStream(text), 'text/event-stream'); return;
    }
    violations.push(`Unimplemented provider request ${r.method} ${u.origin}${u.pathname}`);
    await fulfill(500, JSON.stringify({ error: { message: 'Unexpected E2E provider endpoint' } }));
  };
  b.on('Fetch.requestPaused', e => { const p = handle(e); pending.add(p); p.finally(() => pending.delete(p)).catch(() => {}); return p; });
  // Catch all destinations, not only provider patterns: an unexpected host must never receive bytes.
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return { requests, violations, extractionPages, setVariant(value) { variant = value; replies = 0; attempts.clear(); }, async assertSafe() {
    await Promise.all([...pending]);
    assert.deepEqual(violations, [], 'Unexpected network destinations/endpoints');
    for (const request of requests) if (new URL(request.url).hostname === 'gpt.yapweijun1996.com' && new URL(request.url).pathname.endsWith('/responses')) {
      const input = JSON.stringify(JSON.parse(request.body || '{}').input ?? []);
      assert.ok((input.match(/"type"\s*:\s*"input_image"/g) ?? []).length <= 4, 'Demo request exceeded four images including tool outputs');
    }
  } };
}
export function redact(value) { return String(value).replaceAll(TEST_KEY, '[REDACTED]').replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]'); }
