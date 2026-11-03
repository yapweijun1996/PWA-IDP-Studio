import { BUILTIN_PROFILES, type ExtractionMode, type ExtractionProfile } from './agent/contract';
export const PROFILE_KEYS = ['idp-studio.profiles.v1', 'idp-studio.mode.v1', 'idp-studio.batch-modes.v1'];
const session = new Map<string, unknown>();
function load<T>(key: string, fallback: T): T {
  if (session.has(key)) return session.get(key) as T;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) ?? fallback : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown): void { session.set(key, value); try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Session only. */ } }
export function validateProfile(profile: ExtractionProfile): string[] {
  const errors: string[] = [];
  if (typeof profile.name !== 'string' || !profile.name.trim()) errors.push('Enter a profile name.');
  if (profile.rowsAsTransactions !== undefined && typeof profile.rowsAsTransactions !== 'boolean') errors.push('rowsAsTransactions must be a boolean.');
  const fields = [...(profile.fields ?? []), ...(profile.rowFields ?? [])];
  if (fields.length < 1 || fields.length > 30) errors.push('Use 1–30 fields in total.');
  const seen = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field.key !== 'string') { errors.push('Each field needs a snake_case key.'); continue; }
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(field.key)) errors.push(`Invalid snake_case key: ${field.key}`);
    if (seen.has(field.key)) errors.push(`Duplicate key: ${field.key}`);
    seen.add(field.key);
    if (typeof field.label !== 'string' || !field.label.trim()) errors.push(`Enter a label for ${field.key || 'each field'}.`);
    if (!['text', 'date', 'amount', 'quantity', 'integer', 'code'].includes(field.type)) errors.push(`Unknown type for ${field.key}.`);
  }
  for (const field of profile.fields ?? []) if (field && field.section !== undefined && field.section !== 'info' && field.section !== 'footer') errors.push(`Unknown section for ${field.key}.`);
  for (const field of profile.rowFields ?? []) if (field && field.section !== undefined) errors.push(`Row column ${field.key} cannot have a section; rows are always Row Data.`);
  return errors;
}
/**
 * The technical snake_case key for a label a user typed ("Batch No" -> batch_no), unique among `taken`, so nobody has to
 * type a key. A label with no Latin letters or digits falls back to `field`; a leading digit gets a `field_` prefix.
 */
export function keyFromLabel(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'field';
  else if (/^[0-9]/.test(base)) base = `field_${base}`;
  let key = base; let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  return key;
}
const ACRONYMS = new Set(['po', 'do', 'uom', 'id', 'gst', 'sku']);
/** A plain-words label for a technical key: supplier_name -> "Supplier name", po_no -> "PO no", uom -> "UOM". */
export function labelFromKey(key: string): string {
  return key.toLowerCase().split('_').map(word => ACRONYMS.has(word) ? word.toUpperCase() : word).join(' ').replace(/^./, c => c.toUpperCase());
}
/** `base`, or `base 2`, `base 3`... when a template with that name already exists (case-insensitive). */
export function uniqueProfileName(base: string, profiles: readonly ExtractionProfile[]): string {
  const taken = new Set(profiles.map(p => p.name.trim().toLowerCase()));
  let name = base.trim() || 'My template'; let n = 2;
  const root = name;
  while (taken.has(name.toLowerCase())) name = `${root} ${n++}`;
  return name;
}
export function loadProfiles(): ExtractionProfile[] {
  const stored = load<unknown>(PROFILE_KEYS[0], []);
  const users = Array.isArray(stored) ? stored.filter((p): p is ExtractionProfile => !!p && typeof p.id === 'string' && Array.isArray(p.fields) && Array.isArray(p.rowFields) && !BUILTIN_PROFILES.some(b => b.id === p.id) && validateProfile(p).length === 0) : [];
  return [...structuredClone(BUILTIN_PROFILES), ...users.map(p => ({ ...p, builtin: false }))];
}
export function saveProfiles(profiles: ExtractionProfile[]): void { save(PROFILE_KEYS[0], profiles.filter(p => !p.builtin && !BUILTIN_PROFILES.some(b => b.id === p.id) && !validateProfile(p).length)); }
export function loadMode(): ExtractionMode {
  const mode = load<ExtractionMode>(PROFILE_KEYS[1], { kind: 'auto' });
  return mode?.kind === 'targeted' && loadProfiles().some(p => p.id === mode.profileId) ? mode : { kind: 'auto' };
}
export function saveMode(mode: ExtractionMode): void { save(PROFILE_KEYS[1], mode); }
export interface BatchMode { mode: ExtractionMode; profile?: ExtractionProfile }
export function saveBatchMode(id: string, mode: ExtractionMode, profile?: ExtractionProfile): void { save(PROFILE_KEYS[2], { ...load<Record<string, BatchMode>>(PROFILE_KEYS[2], {}), [id]: structuredClone({ mode, profile }) }); }
export function loadBatchMode(id: string): BatchMode | undefined { return load<Record<string, BatchMode>>(PROFILE_KEYS[2], {})[id]; }
export function clearProfiles(): void { for (const key of PROFILE_KEYS) { session.delete(key); try { localStorage.removeItem(key); } catch { /* Storage blocked. */ } } }

/** Portable profile file; built-in exports become editable on import. */
export function exportProfiles(profiles: ExtractionProfile[]): string {
  return JSON.stringify({ idp_studio_profiles: 1, profiles: profiles.map(({ id, name, fields, rowFields, rowsAsTransactions }) => ({ id, name, fields, rowFields, ...(rowsAsTransactions !== undefined ? { rowsAsTransactions } : {}) })) }, null, 2);
}
export function parseProfileImport(text: string): { profiles: ExtractionProfile[]; errors: string[] } {
  const errors: string[] = [];
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { profiles: [], errors: ['Invalid JSON file.'] }; }
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value) || value.idp_studio_profiles !== 1 || !Array.isArray(value.profiles) || Object.keys(value).some(k => !['idp_studio_profiles', 'profiles'].includes(k))) {
    return { profiles: [], errors: ['Expected { "idp_studio_profiles": 1, "profiles": [...] }.'] };
  }
  const profiles: ExtractionProfile[] = [];
  value.profiles.forEach((p: unknown, index: number) => {
    const prefix = `Profile ${index + 1}: `;
    if (!object(p) || Object.keys(p).some(k => !['id', 'name', 'fields', 'rowFields', 'rowsAsTransactions', 'builtin'].includes(k)) || typeof p.id !== 'string' || !p.id.trim() || typeof p.name !== 'string' || !Array.isArray(p.fields) || !Array.isArray(p.rowFields) || (p.builtin !== undefined && typeof p.builtin !== 'boolean')) {
      errors.push(`${prefix}Expected id, name, header fields and row columns.`); return;
    }
    if ([...p.fields, ...p.rowFields].some(f => !object(f) || Object.keys(f).some(k => !['key', 'label', 'type', 'required', 'section'].includes(k)) || (f.required !== undefined && typeof f.required !== 'boolean'))) {
      errors.push(`${prefix}Unknown field shape or invalid required mark.`); return;
    }
    const profile = p as unknown as ExtractionProfile;
    errors.push(...validateProfile(profile).map(error => prefix + error));
    profiles.push({ ...profile, builtin: false });
  });
  return { profiles: errors.length ? [] : profiles, errors };
}
