import { beforeEach, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILES } from './agent/contract';
import { clearProfiles, loadBatchMode, loadMode, loadProfiles, saveBatchMode, saveMode, saveProfiles, validateProfile } from './profiles';
beforeEach(() => { clearProfiles(); localStorage.clear(); });
it('validates keys across headers and rows and rejects empty or oversized profiles', () => {
  const profile = structuredClone(BUILTIN_PROFILES[1]);
  expect(validateProfile(profile)).toEqual([]);
  profile.rowFields[0].key = profile.fields[0].key;
  expect(validateProfile(profile)).toContain('Duplicate key: document_no');
  profile.fields[0] = { key: 'Bad Key', label: '', type: 'text' };
  expect(validateProfile(profile).join(' ')).toContain('Invalid snake_case key');
  expect(validateProfile({ ...profile, fields: [], rowFields: [] })).toContain('Use 1–30 fields in total.');
  expect(validateProfile({ ...profile, fields: Array(31).fill(profile.fields[0]), rowFields: [] })).toContain('Use 1–30 fields in total.');
});
it('protects builtin identities and persists user profiles and mode', () => {
  const custom = { ...structuredClone(BUILTIN_PROFILES[0]), id: 'custom', builtin: false, name: 'Custom' };
  saveProfiles([{ ...BUILTIN_PROFILES[0], name: 'Overwritten', builtin: false }, custom]);
  expect(loadProfiles().map(p => p.name)).toEqual(['Document info', 'Document info + rows', 'Custom']);
  saveMode({ kind: 'targeted', profileId: 'custom' }); expect(loadMode()).toEqual({ kind: 'targeted', profileId: 'custom' });
  saveProfiles([]); expect(loadMode()).toEqual({ kind: 'auto' });
});
it('keeps immutable retry snapshots after profile edits and deletion', () => {
  const profile = structuredClone(BUILTIN_PROFILES[1]);
  saveBatchMode('batch', { kind: 'targeted', profileId: profile.id }, profile);
  profile.fields[0].label = 'Changed';
  expect(loadBatchMode('batch')?.profile?.fields[0].label).toBe('Document number');
  clearProfiles(); expect(loadBatchMode('batch')).toBeUndefined(); expect(loadMode()).toEqual({ kind: 'auto' });
});
it('handles malformed and blocked browser storage', () => {
  localStorage.setItem('idp-studio.profiles.v1', '{'); expect(loadProfiles()).toEqual(BUILTIN_PROFILES);
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  saveMode({ kind: 'targeted', profileId: 'doc-info' }); expect(loadMode()).toEqual({ kind: 'targeted', profileId: 'doc-info' });
  spy.mockRestore();
});
