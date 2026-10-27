import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Notice, Select } from '../ds';
import { exportProfiles, loadMode, loadProfiles, parseProfileImport, saveMode, saveProfiles, validateProfile } from '../lib/profiles';
import type { ExtractionProfile, FieldType, ProfileField } from '../lib/agent/contract';
export function ProfileEditor() {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [draft, setDraft] = useState<ExtractionProfile>();
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
  const fields = (profile: ExtractionProfile, section: 'fields' | 'rowFields', title: string) => <section aria-label={`${profile.name} ${title}`}><h4>{title}</h4>{profile[section].length ? <ul>{profile[section].map(f => <li key={f.key}>{f.label} (<code>{f.key}</code>) <Badge>{f.type}</Badge> {f.required && <strong>Required *</strong>}</li>)}</ul> : <p className="ds-muted">None</p>}</section>;
  const begin = (profile?: ExtractionProfile) => { setErrors([]); setDraft(profile ? structuredClone(profile) : { id: crypto.randomUUID(), name: '', fields: [], rowFields: [] }); };
  const persist = (next: ExtractionProfile[]) => { saveProfiles(next); setProfiles(loadProfiles()); };
  const rows = (section: 'fields' | 'rowFields', title: string) => {
    if (!draft) return null;
    const update = (index: number, patch: Partial<ProfileField>) => setDraft({ ...draft, [section]: draft[section].map((f, i) => i === index ? { ...f, ...patch } : f) });
    const move = (index: number, offset: number) => { const next = [...draft[section]]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setDraft({ ...draft, [section]: next }); };
    return <section aria-label={title}><h3>{title}</h3>{draft[section].map((field, i) => <Card key={i}><Field label={`${title} ${i + 1} key`}><Input value={field.key} onChange={e => update(i, { key: e.target.value })} /></Field><Field label={`${title} ${i + 1} label`}><Input value={field.label} onChange={e => update(i, { label: e.target.value })} /></Field><Field label={`${title} ${i + 1} type`}><Select value={field.type} onChange={e => update(i, { type: e.target.value as FieldType })}>{['text', 'date', 'amount', 'quantity', 'integer', 'code'].map(type => <option key={type}>{type}</option>)}</Select></Field><Checkbox label="Required" checked={!!field.required} onChange={e => update(i, { required: e.target.checked })} /><div className="ds-row"><Button disabled={i === 0} onClick={() => move(i, -1)}>Move up</Button><Button disabled={i === draft[section].length - 1} onClick={() => move(i, 1)}>Move down</Button><Button onClick={() => setDraft({ ...draft, [section]: draft[section].filter((_, index) => index !== i) })}>Remove field</Button></div></Card>)}<Button onClick={() => setDraft({ ...draft, [section]: [...draft[section], { key: '', label: '', type: 'text' }] })}>Add {section === 'fields' ? 'header field' : 'row column'}</Button></section>;
  };
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
    {profiles.map(profile => <Card key={profile.id}><h3>{profile.name}</h3><Badge>{profile.builtin ? 'Built-in · locked' : 'Custom profile'}</Badge><p>{mode.kind === 'targeted' && mode.profileId === profile.id ? 'Used by Targeted mode for the next upload' : 'Not selected for the next upload'}</p>{fields(profile, 'fields', 'Header fields')}{fields(profile, 'rowFields', 'Row columns')}<div className="ds-row"><Button onClick={() => { saveMode({ kind: 'targeted', profileId: profile.id }); setMode({ kind: 'targeted', profileId: profile.id }); window.location.hash = '#/'; }}>Use {profile.name} for next upload</Button><Button onClick={() => download([profile])}>Export {profile.name}</Button><Button onClick={() => begin({ ...profile, id: crypto.randomUUID(), name: `${profile.name} copy`, builtin: false })}>Duplicate {profile.name}</Button>{!profile.builtin && <><Button onClick={() => begin(profile)}>Edit {profile.name}</Button><Button variant="danger" onClick={() => setDeleting(profile)}>Delete {profile.name}</Button></>}</div></Card>)}
    <Dialog open={!!deleting} onClose={() => setDeleting(undefined)} title="Delete extraction profile?"><p>Delete {deleting?.name}? Existing batch snapshots are retained.</p><Button onClick={() => setDeleting(undefined)}>Cancel</Button><Button variant="danger" onClick={() => { if (!deleting) return; persist(profiles.filter(p => p.id !== deleting.id)); if (mode.kind === 'targeted' && mode.profileId === deleting.id) { saveMode({ kind: 'auto' }); setMode({ kind: 'auto' }); } setDeleting(undefined); }}>Delete profile</Button></Dialog>
    <Dialog open={pending.length > 0} onClose={() => setPending([])} title="Import profile conflicts"><p>Matching IDs or names will be renamed as copies. Existing profiles will not be overwritten.</p><ul>{pending.map((p, i) => <li key={i}>{p.name}</li>)}</ul><Button onClick={() => setPending([])}>Cancel</Button><Button onClick={() => importProfiles(pending)}>Import as copies</Button></Dialog>
    <Dialog open={!!draft} onClose={() => setDraft(undefined)} title="Edit extraction profile">{draft && <><Field label="Profile name"><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>{rows('fields', 'Header fields')}{rows('rowFields', 'Row columns')}{errors.length > 0 && <Notice tone="error"><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></Notice>}<Button onClick={() => setDraft(undefined)}>Cancel</Button><Button variant="primary" onClick={() => { const problems = validateProfile(draft); setErrors(problems); if (!problems.length) { persist([...profiles.filter(p => p.id !== draft.id), draft]); setDraft(undefined); } }}>Save profile</Button></>}</Dialog></Card>;
}
