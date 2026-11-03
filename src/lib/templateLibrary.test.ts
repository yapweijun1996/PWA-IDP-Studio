import { beforeEach, describe, expect, it } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { BUILTIN_PROFILES, type ExtractionProfile } from './agent/contract';
import { clearProfiles, exportProfiles, loadProfiles, parseProfileImport, saveProfiles, validateProfile } from './profiles';
import { templateFromTransaction } from './template';
import { matchFor, normalizeParty, partyKey, partyOf, suggestTemplates } from './templateMatch';

beforeEach(() => { clearProfiles(); localStorage.clear(); });
const profile = (name: string, match?: ExtractionProfile['match'], extra: Partial<ExtractionProfile> = {}): ExtractionProfile => ({ id: name, name, fields: [{ key: 'supplier_name', label: 'Supplier', type: 'text' }], rowFields: [], ...(match ? { match } : {}), ...extra });

describe('normalizeParty', () => {
  it.each([
    ['ABC Trading Pte Ltd', 'abc trading'], ['ABC TRADING PTE. LTD.', 'abc trading'], ['abc trading', 'abc trading'],
    ['Ban Leong Technologies Ltd', 'ban leong technologies'], ['Acme Sdn. Bhd.', 'acme'], ['The Acme Company', 'acme'],
    ['Smith & Sons Inc', 'smith and sons'], ['Café Müller GmbH', 'cafe muller'], ['  A   B  ', 'a b'], ['S & P Corp', 's and p'],
  ])('%j -> %j', (name, expected) => expect(normalizeParty(name)).toBe(expected));
  it('is empty when only company words are left', () => { expect(normalizeParty('Pte Ltd')).toBe(''); expect(normalizeParty('')).toBe(''); });
  it('keeps different companies apart', () => { expect(normalizeParty('ABC Trading Pte Ltd')).not.toBe(normalizeParty('ABD Trading Pte Ltd')); });
});

describe('partyOf', () => {
  it('takes the supplier on a purchase and the customer on a sale', () => {
    expect(partyKey('purchase_order')).toBe('supplier_name'); expect(partyKey('sales_invoice')).toBe('customer_name');
    expect(partyKey('bank_receipt')).toBe('payer_name'); expect(partyKey('statement')).toBeUndefined();
    const data = { supplier_name: ' Vendor Pte Ltd ', customer_name: 'Buyer Ltd' };
    expect(partyOf(data, 'purchase_order')).toBe('Vendor Pte Ltd');
    expect(partyOf(data, 'sales_invoice')).toBe('Buyer Ltd');
  });
  it('falls back to any party name, and to nothing when there is none or it is not text', () => {
    expect(partyOf({ customer_name: 'Buyer Ltd' }, 'purchase_order')).toBe('Buyer Ltd');
    expect(partyOf({ supplier_name: 'X' }, 'unknown')).toBe('X');
    expect(partyOf({ supplier_name: null, customer_name: '  ' }, 'purchase_order')).toBeUndefined();
    expect(partyOf({ supplier_name: 12 }, 'purchase_order')).toBeUndefined();
  });
});

describe('matchFor', () => {
  it('remembers the party and the document type', () => {
    expect(matchFor({ supplier_name: 'ABC Trading Pte Ltd' }, 'purchase_invoice')).toEqual({ party: 'ABC Trading Pte Ltd', documentType: 'purchase_invoice' });
  });
  it('leaves the type out when it is unknown, and remembers nothing without a usable party', () => {
    expect(matchFor({ supplier_name: 'ABC' }, 'unknown')).toEqual({ party: 'ABC' });
    expect(matchFor({}, 'purchase_invoice')).toBeUndefined();
    expect(matchFor({ supplier_name: 'Pte Ltd' }, 'purchase_invoice')).toBeUndefined(); // nothing left to tell it apart
  });
});

describe('suggestTemplates', () => {
  const doc = { documentType: 'purchase_order' as const, party: 'Ban Leong Technologies Pte. Ltd.' };
  it('suggests a template whose party matches, ignoring case, punctuation and company words', () => {
    const list = suggestTemplates([profile('Ban Leong', { party: 'BAN LEONG TECHNOLOGIES LTD' })], doc);
    expect(list.map(s => s.profile.name)).toEqual(['Ban Leong']);
  });
  it('ranks party and type above party only above type only', () => {
    const list = suggestTemplates([profile('Any PO', { documentType: 'purchase_order' }), profile('Supplier only', { party: 'Ban Leong Technologies' }), profile('Supplier PO', { party: 'Ban Leong Technologies', documentType: 'purchase_order' })], doc);
    expect(list.map(s => [s.profile.name, s.score])).toEqual([['Supplier PO', 3], ['Supplier only', 2], ['Any PO', 1]]);
  });
  it('leaves out a template for another supplier, for another document type, or with nothing to match on', () => {
    const list = suggestTemplates([
      profile('Other supplier', { party: 'ABC Trading' }), profile('Other type', { party: 'Ban Leong Technologies', documentType: 'purchase_invoice' }),
      profile('No condition'), profile('Empty party', { party: 'Pte Ltd' }), profile('Matches', { party: 'Ban Leong Technologies' }),
    ], doc);
    expect(list.map(s => s.profile.name)).toEqual(['Matches']);
  });
  it('never suggests a built-in template, and a template with a party needs the document to have one', () => {
    expect(suggestTemplates([{ ...profile('Built-in', { documentType: 'purchase_order' }), builtin: true }], doc)).toEqual([]);
    expect(suggestTemplates([profile('Supplier', { party: 'Ban Leong Technologies' })], { documentType: 'purchase_order' })).toEqual([]);
    expect(suggestTemplates([profile('Shorter name', { party: 'Ban Leong' })], doc)).toEqual([]); // a different name is a different party: no guessing
    expect(suggestTemplates([profile('Type only', { documentType: 'purchase_order' })], { documentType: 'purchase_order' }).length).toBe(1);
  });
  it('orders equal scores by name, so the list does not jump around', () => {
    const list = suggestTemplates([profile('B', { party: 'Ban Leong Technologies' }), profile('A', { party: 'Ban Leong Technologies' })], doc);
    expect(list.map(s => s.profile.name)).toEqual(['A', 'B']);
  });
});

describe('templates carry a match', () => {
  it('validates it, and rejects what is not a supplier name or a known document type', () => {
    expect(validateProfile(profile('P', { party: 'ABC', documentType: 'purchase_order' }))).toEqual([]);
    expect(validateProfile(profile('P', {}))).toEqual([]);
    expect(validateProfile(profile('P', { party: '  ' }))).toEqual(['Enter a supplier or customer name for the suggestion, or leave it empty.']);
    expect(validateProfile(profile('P', { party: 'x'.repeat(121) }))).toEqual(['Enter a supplier or customer name for the suggestion, or leave it empty.']);
    expect(validateProfile(profile('P', { documentType: 'invoice' as never }))).toEqual(['Unknown document type for the suggestion.']);
    expect(validateProfile(profile('P', { party: 'A', extra: 1 } as never))).toEqual(['Suggestion settings are invalid.']);
    expect(validateProfile(profile('P', 'ABC' as never))).toEqual(['Suggestion settings are invalid.']);
  });
  it('survives save and load, export and import', () => {
    const mine = profile('Mine', { party: 'ABC Trading Pte Ltd', documentType: 'purchase_invoice' });
    saveProfiles([{ ...mine, builtin: false }]);
    expect(loadProfiles().find(p => p.id === 'Mine')?.match).toEqual(mine.match);
    const imported = parseProfileImport(exportProfiles([mine]));
    expect(imported.errors).toEqual([]); expect(imported.profiles[0].match).toEqual(mine.match);
    expect(parseProfileImport(JSON.stringify({ idp_studio_profiles: 1, profiles: [{ ...mine, match: { party: 5 } }] })).errors).toEqual(['Template 1: Enter a supplier or customer name for the suggestion, or leave it empty.']);
  });
  it('is left out of the export when the template has none, and the built-ins have none', () => {
    expect(Object.keys(JSON.parse(exportProfiles([profile('Plain')])).profiles[0])).toEqual(['id', 'name', 'fields', 'rowFields']);
    expect(BUILTIN_PROFILES.every(p => p.match === undefined)).toBe(true);
  });
  it('is remembered when a template is made from a document, and kept when it is made from a template', () => {
    const batch = buildBatch(invoiceInput()); const tx = batch.transactions[0];
    expect(templateFromTransaction(tx, 'purchase_invoice', 'T').match).toEqual({ party: 'ABC Trading Pte Ltd', documentType: 'purchase_invoice' });
    tx.data.supplier_name = null;
    expect(templateFromTransaction(tx, 'purchase_invoice', 'T').match).toBeUndefined();
    expect(templateFromTransaction(tx, 'purchase_invoice', 'T', profile('Base', { party: 'Kept' })).match).toEqual({ party: 'Kept' });
  });
});
