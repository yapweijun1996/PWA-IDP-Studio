import { expect, it } from 'vitest';
import { exportProfiles, parseProfileImport } from './profiles';
import { BUILTIN_PROFILES } from './agent/contract';

const file = (profiles: unknown[]) => JSON.stringify({ idp_studio_profiles: 1, profiles });
const custom = { id: 'shipping', name: 'Shipping', fields: [{ key: 'document_no', label: 'Document number', type: 'code', required: true }], rowFields: [{ key: 'stock_code', label: 'Stock code', type: 'text', required: false }] };

it('exports only portable fields without mutating the source', () => {
  const source = structuredClone(BUILTIN_PROFILES[1]);
  const before = structuredClone(source);
  const output = JSON.parse(exportProfiles([source]));
  expect(output).toEqual({ idp_studio_profiles: 1, profiles: [{ id: source.id, name: source.name, fields: source.fields, rowFields: source.rowFields }] });
  expect(source).toEqual(before);
});
it('round trips header and row requirements as editable profiles', () => {
  expect(parseProfileImport(file([custom]))).toEqual({ errors: [], profiles: [{ ...custom, builtin: false }] });
  expect(parseProfileImport(exportProfiles([BUILTIN_PROFILES[1]]))).toEqual({ errors: [], profiles: [{ ...BUILTIN_PROFILES[1], builtin: false }] });
  expect(parseProfileImport(exportProfiles([]))).toEqual({ errors: [], profiles: [] });
});
it('reports invalid JSON separately from unsupported file envelopes', () => {
  expect(parseProfileImport('{')).toEqual({ profiles: [], errors: ['Invalid JSON file.'] });
  for (const value of [null, [], {}, { idp_studio_profiles: 2, profiles: [] }, { idp_studio_profiles: '1', profiles: [] }, { idp_studio_profiles: 1, profiles: null }, { idp_studio_profiles: 1, profiles: [], extra: true }]) {
    expect(parseProfileImport(JSON.stringify(value))).toEqual({ profiles: [], errors: ['Expected { "idp_studio_profiles": 1, "profiles": [...] }.'] });
  }
});
it('refuses malformed profile containers atomically with indexed errors', () => {
  for (const profile of [null, [], { ...custom, id: '' }, { ...custom, id: 1 }, { ...custom, name: null }, { ...custom, fields: null }, { ...custom, rowFields: {} }, { ...custom, builtin: 'yes' }, { ...custom, extra: true }]) {
    expect(parseProfileImport(file([custom, profile]))).toEqual({ profiles: [], errors: ['Profile 2: Expected id, name, header fields and row columns.'] });
  }
});
it('refuses unknown field shapes and nonboolean required marks', () => {
  for (const field of [null, [], 'field', { ...custom.fields[0], extra: true }, { ...custom.fields[0], required: 'yes' }]) {
    for (const section of ['fields', 'rowFields']) {
      expect(parseProfileImport(file([{ ...custom, [section]: [field] }]))).toEqual({ profiles: [], errors: ['Profile 1: Unknown field shape or invalid required mark.'] });
    }
  }
});
it('returns every validation problem without importing the valid prefix', () => {
  const result = parseProfileImport(file([custom, { ...custom, name: ' ', fields: [{ key: 'Bad key', label: '', type: 'other' }], rowFields: [] }, { ...custom, fields: [], rowFields: [] }]));
  expect(result).toEqual({ profiles: [], errors: [
    'Profile 2: Enter a profile name.',
    'Profile 2: Invalid snake_case key: Bad key',
    'Profile 2: Enter a label for Bad key.',
    'Profile 2: Unknown type for Bad key.',
    'Profile 3: Use 1–30 fields in total.',
  ] });
});
it('validates missing keys, labels, duplicate keys and the field-count boundary', () => {
  for (const [field, message] of [
    [{ label: 'No key', type: 'text' }, 'Each field needs a snake_case key.'],
    [{ key: 1, label: 'Number key', type: 'text' }, 'Each field needs a snake_case key.'],
    [{ key: 'valid', type: 'text' }, 'Enter a label for valid.'],
    [{ key: 'valid', label: 'Valid' }, 'Unknown type for valid.'],
  ] as const) {
    const result = parseProfileImport(file([{ ...custom, fields: [field], rowFields: [] }]));
    expect(result).toEqual({ profiles: [], errors: [`Profile 1: ${message}`] });
  }
  expect(parseProfileImport(file([{ ...custom, rowFields: custom.fields }])).errors).toEqual(['Profile 1: Duplicate key: document_no']);
  const fields = Array.from({ length: 30 }, (_, i) => ({ key: `field_${i}`, label: `Field ${i}`, type: 'text' }));
  expect(parseProfileImport(file([{ ...custom, fields, rowFields: [] }])).errors).toEqual([]);
  expect(parseProfileImport(file([{ ...custom, fields, rowFields: custom.rowFields }])).errors).toEqual(['Profile 1: Use 1–30 fields in total.']);
});
