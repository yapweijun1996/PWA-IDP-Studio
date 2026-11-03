import { useState } from 'react';
import { Badge, Button, Card, Dialog, Field, Input, Notice, Select } from '../ds';
import { defaultSection } from '../lib/sections';
import { exportProfiles, loadMode, loadProfiles, parseProfileImport, saveMode, saveProfiles, validateProfile } from '../lib/profiles';
import type { ExtractionProfile, TemplateMatch } from '../lib/agent/contract';
import { DOCUMENT_TYPES, type DocumentType } from '../lib/types';
import { readable } from './nav';
import { ProfileFieldsForm } from './ProfileFieldsForm';
/** `advanced` shows the technical keys (hidden by default: users name fields in words and the key is derived). */
/** The suggestion settings with `patch` applied; an empty party and no type mean no settings at all (the key is dropped). */
function withMatch(profile: ExtractionProfile, patch: Partial<TemplateMatch>): ExtractionProfile {
  const next = { ...profile.match, ...patch };
  const match: TemplateMatch = { ...(next.party !== undefined && next.party !== '' ? { party: next.party } : {}), ...(next.documentType ? { documentType: next.documentType } : {}) };
  const { match: _dropped, ...rest } = profile;
  return Object.keys(match).length ? { ...rest, match } : rest;
}
export function ProfileEditor({ advanced = false }: { advanced?: boolean } = {}) {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [draft, setDraft] = useState<ExtractionProfile>();
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ExtractionProfile>();
  const [pending, setPending] = useState<ExtractionProfile[]>([]);
  const [mode, setMode] = useState(loadMode);
  const [imported, setImported] = useState<number>();
  const download = (items: ExtractionProfile[]) => {
    const url = URL.createObjectURL(new Blob([exportProfiles(items)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'idp-studio-profiles.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const importProfiles = (items: ExtractionProfile[]) => {
    const next = [...profiles];
    for (const profile of items) {
      const conflict = next.some(p => p.id === profile.id || p.name === profile.name);
      let name = profile.name;
      if (conflict) {
        name = `${profile.name} copy`;
        let n = 2;
        while (next.some(p => p.name === name)) name = `${profile.name} copy ${n++}`;
      }
      next.push({ ...profile, id: conflict ? crypto.randomUUID() : profile.id, name, builtin: false });
    }
    persist(next); setPending([]); setImported(items.length);
  };
  const fields = (profile: ExtractionProfile, section: 'fields' | 'rowFields', title: string) => <section aria-label={`${profile.name} ${title}`}><h4>{title}</h4>{profile[section].length ? <ul>{profile[section].map(f => <li key={f.key}>{f.label} {advanced && <>(<code>{f.key}</code>) </>}<Badge>{f.type}</Badge> {section === 'fields' && (f.section ?? defaultSection(f.key, f.type)) === 'footer' && <Badge tone="info">Footer</Badge>} {f.required && <strong>Required *</strong>}</li>)}</ul> : <p className="ds-muted">None</p>}</section>;
  const begin = (profile?: ExtractionProfile) => { setErrors([]); setLocked(new Set(profile ? [...profile.fields, ...profile.rowFields].map(f => f.key) : [])); setDraft(profile ? structuredClone(profile) : { id: crypto.randomUUID(), name: '', fields: [], rowFields: [] }); };
  const persist = (next: ExtractionProfile[]) => { saveProfiles(next); setProfiles(loadProfiles()); };
  return <Card><h2>Extraction profiles</h2><div className="ds-row"><Button onClick={() => begin()}>Create profile</Button><Button disabled={!profiles.some(p => !p.builtin)} onClick={() => download(profiles.filter(p => !p.builtin))}>Export all custom profiles</Button></div>
    <Field label="Import profiles"><Input type="file" accept=".json,application/json" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      setImported(undefined); setPending([]);
      try {
        const result = parseProfileImport(await file.text()); setErrors(result.errors);
        if (result.errors.length) return;
        const seen = [...profiles];
        const conflict = result.profiles.some(p => { const found = seen.some(s => s.id === p.id || s.name === p.name); seen.push(p); return found; });
        if (conflict) setPending(result.profiles); else importProfiles(result.profiles);
      } catch { setErrors(['Could not read the profile file.']); }
    }} /></Field>
    {imported !== undefined && <Notice>{imported === 0 ? 'The file contains no profiles.' : `Imported ${imported} profile${imported === 1 ? '' : 's'}.`}</Notice>}
    {!profiles.some(p => !p.builtin) && <p className="ds-muted">No custom profiles yet. Create a profile, duplicate a built-in, or import a profile file.</p>}
    {!draft && errors.length > 0 && <Notice tone="error"><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></Notice>}
    {profiles.map(profile => <Card key={profile.id}><h3>{profile.name}</h3><Badge>{profile.builtin ? 'Built-in · locked' : 'Custom profile'}</Badge><p>{mode.kind === 'targeted' && mode.profileId === profile.id ? 'Used by Targeted mode for the next upload' : 'Not selected for the next upload'}</p>{profile.match && <p>Suggested for {[profile.match.party && `documents from ${profile.match.party}`, profile.match.documentType && readable(profile.match.documentType).toLowerCase()].filter(Boolean).join(', ')}.</p>}{fields(profile, 'fields', 'Header fields')}{fields(profile, 'rowFields', 'Row columns')}<div className="ds-row"><Button onClick={() => { saveMode({ kind: 'targeted', profileId: profile.id }); setMode({ kind: 'targeted', profileId: profile.id }); window.location.hash = '#/'; }}>Use {profile.name} for next upload</Button><Button onClick={() => download([profile])}>Export {profile.name}</Button><Button onClick={() => begin({ ...profile, id: crypto.randomUUID(), name: `${profile.name} copy`, builtin: false })}>Duplicate {profile.name}</Button>{!profile.builtin && <><Button onClick={() => begin(profile)}>Edit {profile.name}</Button><Button variant="danger" onClick={() => setDeleting(profile)}>Delete {profile.name}</Button></>}</div></Card>)}
    <Dialog open={!!deleting} onClose={() => setDeleting(undefined)} title="Delete extraction profile?"><p>Delete {deleting?.name}? Existing batch snapshots are retained.</p><Button onClick={() => setDeleting(undefined)}>Cancel</Button><Button variant="danger" onClick={() => { if (!deleting) return; persist(profiles.filter(p => p.id !== deleting.id)); if (mode.kind === 'targeted' && mode.profileId === deleting.id) { saveMode({ kind: 'auto' }); setMode({ kind: 'auto' }); } setDeleting(undefined); }}>Delete profile</Button></Dialog>
    <Dialog open={pending.length > 0} onClose={() => setPending([])} title="Import profile conflicts"><p>Matching IDs or names will be renamed as copies. Existing profiles will not be overwritten.</p><ul>{pending.map((p, i) => <li key={i}>{p.name}</li>)}</ul><Button onClick={() => setPending([])}>Cancel</Button><Button onClick={() => importProfiles(pending)}>Import as copies</Button></Dialog>
    <Dialog open={!!draft} onClose={() => setDraft(undefined)} title="Edit extraction profile">{draft && <><Field label="Profile name"><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="Suggest for supplier or customer (optional)"><Input value={draft.match?.party ?? ''} placeholder="For example ABC Trading" onChange={e => setDraft(withMatch(draft, { party: e.target.value }))} /></Field><Field label="Suggest for document type (optional)"><Select value={draft.match?.documentType ?? ''} onChange={e => setDraft(withMatch(draft, { documentType: (e.target.value || undefined) as DocumentType | undefined }))}><option value="">Any</option>{DOCUMENT_TYPES.filter(type => type !== 'unknown').map(type => <option key={type} value={type}>{readable(type)}</option>)}</Select></Field><p className="ds-muted">When a new document is from this supplier or customer, or is of this type, this template is suggested after the document is read. It is never used without asking.</p><ProfileFieldsForm draft={draft} onChange={setDraft} locked={locked} advanced={advanced} />{errors.length > 0 && <Notice tone="error"><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></Notice>}<Button onClick={() => setDraft(undefined)}>Cancel</Button><Button variant="primary" onClick={() => { const problems = validateProfile(draft); setErrors(problems); if (!problems.length) { persist([...profiles.filter(p => p.id !== draft.id), draft]); setDraft(undefined); } }}>Save profile</Button></>}</Dialog></Card>;
}
