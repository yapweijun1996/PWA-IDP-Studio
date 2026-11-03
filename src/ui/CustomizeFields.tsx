import { useState } from 'react';
import { Button, Dialog, Field, Input, Notice } from '../ds';
import type { ExtractionProfile } from '../lib/agent/contract';
import { loadProfiles, saveProfiles, validateProfile } from '../lib/profiles';
import { ProfileFieldsForm } from './ProfileFieldsForm';

/**
 * "Customize fields" in review: add a field or a column to the template this document was read with, then read the
 * document again with it. Step 1 edits the template; step 2 says exactly what extracting again replaces. The caller keeps the
 * current result until the new extraction has finished, so nothing here can lose data.
 */
export function CustomizeFields({ start, reviewCount, documentCount, onClose, onExtract }: { start: ExtractionProfile; reviewCount: number; documentCount: number; onClose: () => void; onExtract: (profile: ExtractionProfile) => void }) {
  const [draft, setDraft] = useState<ExtractionProfile>(() => structuredClone(start));
  const [locked] = useState<ReadonlySet<string>>(() => new Set([...start.fields, ...start.rowFields].map(f => f.key)));
  const [errors, setErrors] = useState<string[]>([]);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [saved, setSaved] = useState(false);
  const valid = () => { const problems = validateProfile(draft); setErrors(problems); return problems.length === 0; };
  const persist = () => saveProfiles([...loadProfiles().filter(p => p.id !== draft.id), draft]);
  const change = (next: ExtractionProfile) => { setDraft(next); setSaved(false); };
  return <Dialog open onClose={onClose} title={step === 'edit' ? 'Customize fields' : 'Extract this document again?'}>
    {step === 'edit' ? <>
      <p className="ds-muted">Add what you need, then read the document again so it is filled in. Your current result stays as it is until the new one has finished.</p>
      <Field label="Template name"><Input value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} /></Field>
      <ProfileFieldsForm draft={draft} onChange={change} locked={locked} />
      {errors.length > 0 && <Notice tone="error"><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></Notice>}
      {saved && <Notice>Saved “{draft.name}” on the Templates page.</Notice>}
      <div className="ds-row">
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={() => { if (valid()) { persist(); setSaved(true); } }}>Save template only</Button>
        <Button variant="primary" onClick={() => { if (valid()) { persist(); setStep('confirm'); } }}>Save and extract again</Button>
      </div>
    </> : <>
      <p>This reads {documentCount > 1 ? `all ${documentCount} documents in this file` : 'the document'} again with “{draft.name}”, using your AI provider again (it may cost tokens).</p>
      <p>{reviewCount ? `The current result has ${reviewCount} review ${reviewCount === 1 ? 'action' : 'actions'} (corrections, approvals or waivers). They are replaced by the new result.` : 'The current result has no corrections or approvals, so nothing you reviewed is lost.'}</p>
      <p className="ds-muted">The current result stays exactly as it is until the new one finishes. If extraction fails or you cancel it, nothing changes.</p>
      <div className="ds-row">
        <Button onClick={() => setStep('edit')}>Back</Button>
        <Button variant="primary" onClick={() => { onExtract(draft); onClose(); }}>Extract again</Button>
      </div>
    </>}
  </Dialog>;
}
