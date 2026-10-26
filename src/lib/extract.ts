import { Agent, type AgentEvent, type StreamFn } from '@mariozechner/pi-agent-core';
import { streamSimple, type AssistantMessage } from '@mariozechner/pi-ai';
import { apiKeyFor, buildModel, sanitizePayload } from './providers';
import type { RenderedPage } from './pdf';
import type { Settings } from './settings';
import { modelFor } from './settings';
import { checkModelOutput, parseModelJson } from './validate';
import { DOCUMENT_TYPES } from './types';
import { buildBatch, type BuildInput } from '../contract/build';
import type { Batch } from '../contract/types';

export const SYSTEM_PROMPT = `You are a document-processing agent for ERP data entry.
Read the attached page images. Detect the document type, extract header fields and line items.
Reply with ONE JSON object and nothing else:
{
  "document_type": one of ${DOCUMENT_TYPES.join(' | ')},
  "fields": [{"key": snake_case_name, "value": string|number|null, "page": 1-based page number,
              "bbox": [ymin, xmin, ymax, xmax] integers 0..1000 of the page (top-left origin) around where the value is printed, or null,
              "confidence": 0..1}],
  "line_items": [{"description": string, "quantity": decimal_string, "unit_price": decimal_string, "amount": decimal_string}]
}
Use these keys when present: supplier_name, customer_name, payer_name, invoice_no, order_no, po_no, do_no, receipt_no, credit_note_no, payment_no,
invoice_date/order_date/po_date/delivery_date/receipt_date/credit_note_date/payment_date (YYYY-MM-DD), currency (ISO code), total_amount, amount.
Never guess: use null with low confidence when a value is not readable. Amounts and quantities are decimal strings with no thousands separators. Never set approval or claim page coverage.`;

export interface ExtractOptions {
  batchId: string;
  createdAt: string;
  file: BuildInput['file'];
  manifest: BuildInput['pages'];
  pages: RenderedPage[];
  settings: Settings;
  signal?: AbortSignal;
  onStatus?: (msg: string) => void;
  /** test seam: replaces the network stream */
  streamFn?: StreamFn;
}

const lastText = (messages: unknown[]): string => {
  const m = [...messages].reverse().find((x) => (x as AssistantMessage).role === 'assistant') as
    | AssistantMessage
    | undefined;
  if (!m) throw new Error('Model returned no reply');
  if (m.stopReason === 'error') throw new Error(m.errorMessage || 'Provider error');
  return m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
};

/**
 * Harness loop: ask → parse + validate → on invalid output, one follow-up repair turn.
 * The model can never set status to approved; the envelope builder decides.
 */
export async function runExtraction(opts: ExtractOptions): Promise<Batch> {
  const { settings, pages, onStatus } = opts;
  const model = buildModel(settings);
  const agent = new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [] },
    streamFn: opts.streamFn ?? streamSimple,
    getApiKey: () => apiKeyFor(settings),
    onPayload: (payload) => sanitizePayload(settings.provider, payload),
  });
  opts.signal?.addEventListener('abort', () => agent.abort());
  agent.subscribe((e: AgentEvent) => {
    if (e.type === 'turn_start') onStatus?.('Reading document…');
    if (e.type === 'message_update') onStatus?.('Extracting fields…');
  });

  await agent.prompt(
    `Extract this document (${pages.length} page${pages.length > 1 ? 's' : ''}).`,
    pages.map((p) => ({ type: 'image' as const, data: p.data, mimeType: p.mimeType })),
  );
  let reply = lastText(agent.state.messages);
  for (let attempt = 0; ; attempt++) {
    try {
      const out = checkModelOutput(parseModelJson(reply));
      onStatus?.('Validating…');
      return buildBatch({ batchId: opts.batchId, createdAt: opts.createdAt, file: opts.file, pages: opts.manifest, renderedPageCount: pages.length, output: out, model: { provider: settings.provider, model: modelFor(settings, settings.provider) } });
    } catch (err) {
      if (attempt >= 1) throw new Error(`Model output was not valid: ${(err as Error).message}`);
      onStatus?.('Repairing output…');
      await agent.prompt(`Your reply was invalid: ${(err as Error).message}. Reply again with ONLY the corrected JSON object.`);
      reply = lastText(agent.state.messages);
    }
  }
}
