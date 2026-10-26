import { describe, expect, it, vi } from 'vitest';
import { createExtractionTools, type CodeDecoder } from './tools';
import type { PageSource } from './pageSource';

const image = { page: 1, width: 100, height: 100, data: 'AAAA', mimeType: 'image/jpeg' as const };
function setup(decoder?: CodeDecoder, maxImages = 12) {
  const source: PageSource = { pageCount: 1, render: vi.fn(async () => image), textItems: vi.fn(async () => []), dispose: vi.fn(async () => {}) };
  const tools = createExtractionTools({ source, submit: () => {}, decoder, maxImages });
  return { source, tool: (name: string) => tools.find(t => t.name === name)! };
}

describe('extraction tools', () => {
  it('returns an image for a normalized crop and refuses inverted regions', async () => {
    const { source, tool } = setup();
    const result = await tool('crop_zoom').execute('1', { page: 1, ymin: 100, xmin: 200, ymax: 500, xmax: 800, scale: 5 });
    expect(result.content).toContainEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    expect(source.render).toHaveBeenCalledWith(1, { crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.4 }, scale: 5, maxSide: undefined });
    await expect(tool('crop_zoom').execute('2', { page: 1, ymin: 500, xmin: 200, ymax: 100, xmax: 800 })).rejects.toThrow(/positive area/);
    await expect(tool('get_page_image').execute('3', { page: 0 })).rejects.toThrow(/Invalid arguments/);
  });
  it('enforces a shared image budget across page, crop and decoding tools', async () => {
    const { source, tool } = setup(async () => [], 2);
    await tool('get_page_image').execute('1', { page: 1 });
    await tool('crop_zoom').execute('2', { page: 1, ymin: 0, xmin: 0, ymax: 500, xmax: 500 });
    await expect(tool('get_page_image').execute('3', { page: 1 })).rejects.toThrow(/budget exhausted/);
    await expect(tool('scan_codes').execute('4', { page: 1 })).rejects.toThrow(/budget exhausted/);
    expect(source.render).toHaveBeenCalledTimes(2);
  });
  it('decodes tiled codes and remaps their boxes to the full page', async () => {
    let calls = 0;
    const { tool } = setup(async () => ++calls === 3 ? [{ format: 'QR_CODE', text: 'encoded-invoice', bbox: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 } }] : []);
    const result = await tool('scan_codes').execute('1', { page: 1 });
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type !== 'text') throw new Error('Expected decoded text');
    expect(JSON.parse(content.text)).toEqual([{ format: 'QR_CODE', text: 'encoded-invoice', bbox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }]);
    expect(calls).toBe(5);
  });
  it('reports scans without codes or embedded text without inventing data', async () => {
    const { tool } = setup(async () => []);
    expect((await tool('scan_codes').execute('1', { page: 1 })).content).toEqual([{ type: 'text', text: 'none found' }]);
    expect((await tool('read_text_layer').execute('2', { page: 1 })).content).toEqual([{ type: 'text', text: 'No embedded text (image or scan).' }]);
  });
});
