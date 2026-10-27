import { afterEach, expect, it } from 'vitest';
import { AGENT_CONFIG_KEY, clampAgentConfig, isValidAgentConfig, loadAgentConfig, saveAgentConfig } from './agentConfig';
import { imageLimits } from './providers';
import { createExtractionTools } from './agent/tools';
import { stitchSegments } from './agent/segment';
afterEach(() => localStorage.removeItem(AGENT_CONFIG_KEY));
it('clamps budgets and rejects non-finite or malformed values', () => {
  const value = clampAgentConfig({ maxTurns: 99, timeoutSeconds: -1, toolImages: 99, boundaryConfidence: 1, tools: { crop_zoom: false } }, 'demo');
  expect(value).toEqual({ maxTurns: 16, timeoutSeconds: 30, toolImages: 2, boundaryConfidence: 0.95, tools: { crop_zoom: false, read_text_layer: true, scan_codes: true } });
  expect(isValidAgentConfig(value, 'demo')).toBe(true);
  expect(isValidAgentConfig({ ...value, maxTurns: 2.5 }, 'demo')).toBe(false);
  expect(isValidAgentConfig({ ...value, tools: {} }, 'demo')).toBe(false);
  expect(clampAgentConfig({ maxTurns: NaN, timeoutSeconds: Infinity, boundaryConfidence: 'bad' }, 'openai').maxTurns).toBe(8);
  expect(clampAgentConfig(null, 'demo').toolImages).toBe(imageLimits('demo').toolImages);
});
it('persists toggles, recovers malformed storage and clamps when switching providers', () => {
  saveAgentConfig({ ...clampAgentConfig(null, 'openai'), toolImages: 12, maxTurns: 3, tools: { crop_zoom: false, scan_codes: true, read_text_layer: true } }, 'openai');
  expect(loadAgentConfig('demo')).toMatchObject({ toolImages: 2, maxTurns: 3, tools: { crop_zoom: false } });
  localStorage.setItem(AGENT_CONFIG_KEY, '{');
  expect(loadAgentConfig('demo').maxTurns).toBe(8);
});
it('omits disabled tools while retaining mandatory tools', () => {
  const tools = createExtractionTools({ source: { pageCount: 1, async render() { throw new Error('unused'); }, async textItems() { return []; }, async dispose() {} }, submit() {}, enabled: { crop_zoom: false, scan_codes: false, read_text_layer: false } });
  expect(tools.map(t => t.name)).toEqual(['get_page_image', 'submit_result']);
});
it('uses the configured confidence threshold at document boundaries', () => {
  const windows = [{ pages: [1], decisions: [{ page: 1, document_type: 'purchase_invoice' as const, starts_new_document: true, confidence: 0.8 }] }];
  expect(stitchSegments(windows, 1, 0.9)[0].boundary_status).toBe('needs_review');
  expect(stitchSegments(windows, 1, 0.8)[0].boundary_status).toBe('confirmed');
});
