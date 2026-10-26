import assert from 'node:assert/strict';
export const TEST_KEY = 'sk-e2e-not-a-real-key';
export function invoice(bad = false) {
  return { document_type: 'purchase_invoice', fields: Object.entries({ supplier_name: 'E2E Supplier', invoice_no: 'INV-E2E-001', invoice_date: bad ? '26/10/2026' : '2026-10-26', currency: 'SGD', total_amount: bad ? '12.00' : '10.00' }).map(([key, value]) => ({ key, value, page: 1, bbox: [100, 100, 200, 500], confidence: 0.99 })), line_items: [{ description: 'E2E service', quantity: '1', unit_price: '10.00', amount: '10.00' }] };
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
export async function installMocks(b, { baseURL, live = false } = {}) {
  const origin = new URL(baseURL).origin;
  const providers = new Set(['api.openai.com', 'openrouter.ai', 'generativelanguage.googleapis.com', 'gpt.yapweijun1996.com']);
  let variant = 'valid'; let replies = 0;
  const requests = []; const violations = []; const pending = new Set();
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
      await fulfill(201, JSON.stringify({ token: 'dmo_e2e_fake', token_type: 'Bearer', expires_in: 900, expires_at: new Date(Date.now() + 900000).toISOString(), model: 'demo-auto' })); return;
    }
    if (variant === 'rate-limit') { await fulfill(429, JSON.stringify({ error: { message: 'E2E rate limit', type: 'rate_limit_error' } })); return; }
    if (r.method === 'POST' && ((u.hostname === 'api.openai.com' && u.pathname === '/v1/responses') || (u.hostname === 'gpt.yapweijun1996.com' && u.pathname === '/demo/v1/responses'))) {
      replies++;
      const text = variant === 'invalid' || (variant === 'repair' && replies === 1) ? 'not JSON: E2E invalid reply' : JSON.stringify(invoice(variant === 'bad'));
      await fulfill(200, responseStream(text), 'text/event-stream'); return;
    }
    violations.push(`Unimplemented provider request ${r.method} ${u.origin}${u.pathname}`);
    await fulfill(500, JSON.stringify({ error: { message: 'Unexpected E2E provider endpoint' } }));
  };
  b.on('Fetch.requestPaused', e => { const p = handle(e); pending.add(p); p.finally(() => pending.delete(p)).catch(() => {}); return p; });
  // Catch all destinations, not only provider patterns: an unexpected host must never receive bytes.
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return { requests, violations, setVariant(value) { variant = value; replies = 0; }, async assertSafe() { await Promise.all([...pending]); assert.deepEqual(violations, [], 'Unexpected network destinations/endpoints'); } };
}
export function redact(value) { return String(value).replaceAll(TEST_KEY, '[REDACTED]').replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]').replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]'); }
