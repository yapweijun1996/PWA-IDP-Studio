import { beforeEach, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILES, type ProfileField } from './agent/contract';
import { clearProfiles, exportProfiles, keyFromLabel, loadBatchMode, loadMode, loadProfiles, parseProfileImport, saveBatchMode, saveMode, saveProfiles, validateProfile } from './profiles';
beforeEach(() => { clearProfiles(); localStorage.clear(); });
it.each([['Batch No', 'batch_no'], ['  Unit   Price (SGD) ', 'unit_price_sgd'], ['Qty/UOM', 'qty_uom'], ['Café Ünit', 'cafe_unit'], ['2nd Qty', 'field_2nd_qty'], ['批号', 'field'], ['', 'field'], ['---', 'field']])('derives the key for the label %j as %s', (label, key) => {
  expect(keyFromLabel(label)).toBe(key);
});
it('keeps derived keys unique and always valid snake_case', () => {
  expect(keyFromLabel('Batch No', ['batch_no'])).toBe('batch_no_2');
  expect(keyFromLabel('Batch No', ['batch_no', 'batch_no_2'])).toBe('batch_no_3');
  for (const label of ['Batch No', '批号', '2nd', 'A', ' x y ', 'ÄÖÜ ß', 'Remark (see note)']) {
    expect(validateProfile({ id: 'x', name: 'x', fields: [{ key: keyFromLabel(label), label: 'L', type: 'text' }], rowFields: [] })).toEqual([]);
  }
});
it('ships valid built-in templates, including the footer totals in the invoice template', () => {
  for (const profile of BUILTIN_PROFILES) expect(validateProfile(profile)).toEqual([]);
  expect(new Set(BUILTIN_PROFILES.map(p => p.id)).size).toBe(BUILTIN_PROFILES.length);
  const invoice = BUILTIN_PROFILES.find(p => p.id === 'invoice')!;
  expect(invoice.fields.map(f => f.key)).toEqual(expect.arrayContaining(['subtotal_amount', 'tax_amount', 'total_amount']));
  expect(invoice.fields.find(f => f.key === 'total_amount')).toMatchObject({ type: 'amount', required: true });
  expect(invoice.rowFields.map(f => f.key)).toEqual(expect.arrayContaining(['stock_code', 'uom', 'amount']));
  expect(BUILTIN_PROFILES.slice(0, 2).map(p => p.id)).toEqual(['doc-info', 'doc-info-rows']); // other code addresses these by position
});
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
  expect(loadProfiles().map(p => p.name)).toEqual(['Document info', 'Document info + rows', 'Invoice with totals', 'Custom']);
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
it('accepts a header field in the info or footer block, rejects anything else, and keeps row columns out of it', () => {
  const base = { id: 'p', name: 'P', rowFields: [{ key: 'qty', label: 'Qty', type: 'quantity' as const }] };
  const fields = (section?: 'info' | 'footer'): ProfileField[] => [{ key: 'shipping_fee', label: 'Shipping fee', type: 'amount', ...(section === undefined ? {} : { section }) }];
  expect(validateProfile({ ...base, fields: fields() })).toEqual([]);
  expect(validateProfile({ ...base, fields: fields('footer') })).toEqual([]);
  expect(validateProfile({ ...base, fields: fields('info') })).toEqual([]);
  expect(validateProfile({ ...base, fields: fields('rows' as 'footer') })).toEqual(['Unknown section for shipping_fee.']);
  expect(validateProfile({ ...base, fields: fields(), rowFields: [{ key: 'qty', label: 'Qty', type: 'quantity', section: 'footer' }] })).toEqual(['Row column qty cannot have a section; rows are always Row Data.']);
});
it('exports and imports a footer choice, and drops nothing else from the field', () => {
  const profile = { id: 'p', name: 'With footer', rowFields: [], fields: [{ key: 'handling', label: 'Handling', type: 'amount' as const, required: true, section: 'footer' as const }, { key: 'po_no', label: 'PO no', type: 'code' as const }] };
  const imported = parseProfileImport(exportProfiles([profile]));
  expect(imported.errors).toEqual([]);
  expect(imported.profiles[0].fields).toEqual(profile.fields);
  expect(parseProfileImport(JSON.stringify({ idp_studio_profiles: 1, profiles: [{ ...profile, fields: [{ ...profile.fields[0], section: 'middle' }] }] })).errors).toEqual(['Profile 1: Unknown section for handling.']);
  saveProfiles([{ ...profile, builtin: false }]);
  expect(loadProfiles().find(p => p.id === 'p')?.fields[0].section).toBe('footer'); // survives a save and load
});
