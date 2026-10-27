import { beforeEach, expect, it } from 'vitest';
import { clampMaxPages, loadSettings, saveSettings } from './settings';

beforeEach(() => localStorage.clear());
it('migrates old settings without losing credentials or model choices', () => {
  localStorage.setItem('idp-studio.settings.v1', JSON.stringify({ provider: 'openai', keys: { openai: 'test' }, models: { openai: 'custom' } }));
  expect(loadSettings()).toEqual({ provider: 'openai', keys: { openai: 'test' }, models: { openai: 'custom' }, maxPages: 100 });
});
it('clamps stored and newly saved page limits to 1 through 500', () => {
  expect(clampMaxPages(-5)).toBe(1);
  expect(clampMaxPages(501)).toBe(500);
  expect(clampMaxPages('bad')).toBe(100);
  expect(clampMaxPages(20.9)).toBe(20);
  saveSettings({ ...loadSettings(), maxPages: 1000 });
  expect(loadSettings().maxPages).toBe(500);
});
it('respects an explicitly stored page limit', () => {
  localStorage.setItem('idp-studio.settings.v1', JSON.stringify({ maxPages: 20 }));
  expect(loadSettings().maxPages).toBe(20);
});
