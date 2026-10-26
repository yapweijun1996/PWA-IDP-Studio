import { Agent, type AgentEvent, type StreamFn } from '@mariozechner/pi-agent-core';
import { streamSimple, type AssistantMessage } from '@mariozechner/pi-ai';
import { apiKeyFor, buildModel } from './providers';
import type { RenderedPage } from './pdf';
import type { Settings } from './settings';
import { modelFor } from './settings';
import { buildEnvelope, checkModelOutput, parseModelJson } from './validate';
import { DOCUMENT_TYPES, type Envelope } from './types';

export const SYSTEM_PROMPT = `You are a document-processing agent for ERP data entry.
Read the attached page images. Detect the document type, extract header fields and line items.
Reply with ONE JSON object and nothing else:
{
  "document_type": one of ${DOCUMENT_TYPES.join(' | ')},
  "fields": [{"key": snake_case_name, "value": string|number|null, "page": 1-based page number,
              "bbox": [ymin, xmin, ymax, xmax] integers 0..1000 of the page (top-left origin) around where the value is printed, or null,
              "confidence": 0..1}],
  "line_items": [{"description": string, "quantity": number, "unit_price": number, "amount": number}]
}
Use these keys when present: supplier_name, customer_name, invoice_no, order_no, po_no, receipt_no, credit_note_no, payment_no,
invoice_date/order_date/po_date/receipt_date/credit_note_date/payment_date (YYYY-MM-DD), currency (ISO code), total_amount, amount.
Never guess: use null with low confidence when a value is not readable. Numbers have no thousands separators.`;

export interface ExtractOptions {
  documentId: string;
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
export async function runExtraction(opts: ExtractOptions): Promise<Envelope> {
  const { settings, pages, onStatus } = opts;
  const model = buildModel(settings);
  const agent = new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [] },
    streamFn: opts.streamFn ?? streamSimple,
    getApiKey: () => apiKeyFor(settings),
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
      return buildEnvelope(opts.documentId, out, { provider: settings.provider, model: modelFor(settings, settings.provider) });
    } catch (err) {
      if (attempt >= 1) throw new Error(`Model output was not valid: ${(err as Error).message}`);
      onStatus?.('Repairing output…');
      await agent.prompt(`Your reply was invalid: ${(err as Error).message}. Reply again with ONLY the corrected JSON object.`);
      reply = lastText(agent.state.messages);
    }
  }
}
