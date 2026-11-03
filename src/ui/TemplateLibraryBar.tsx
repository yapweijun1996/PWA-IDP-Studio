import { useState } from 'react';
import { Button, Notice } from '../ds';
import type { ExtractionProfile } from '../lib/agent/contract';
import { loadProfiles, saveProfiles, uniqueProfileName } from '../lib/profiles';
import { templateFromTransaction } from '../lib/template';
import { suggestTemplates, partyOf } from '../lib/templateMatch';
import type { DocumentType } from '../lib/types';
import type { Transaction } from '../contract/types';
import { CustomizeFields } from './CustomizeFields';
import { readable } from './nav';

/**
 * Template library in review, for a document that was read without a template (Auto):
 *  - **Save as template** keeps what this document contains as a template, remembering who it is from, so the next document from
 *    the same supplier gets it suggested;
 *  - a **suggestion** appears when a saved template fits this document (same supplier and/or document type): one click opens the
 *    usual "extract again" question with that template, so nothing is replaced without the confirmation.
 * Nothing here reads a document or changes a result by itself.
 */
export function TemplateLibraryBar({ tx, documentType, reviewCount, documentCount, disabled, onExtract }: { tx: Transaction; documentType: DocumentType; reviewCount: number; documentCount: number; disabled: boolean; onExtract: (profile: ExtractionProfile) => void }) {
  const [saved, setSaved] = useState<ExtractionProfile>();
  const [using, setUsing] = useState<ExtractionProfile>();
  const [dismissed, setDismissed] = useState(false);
  const party = partyOf(tx.data, documentType);
  const suggestions = dismissed ? [] : suggestTemplates(loadProfiles(), { documentType, party }).filter(s => s.profile.id !== saved?.id).slice(0, 2);
  const save = () => {
    const profiles = loadProfiles();
    const template = templateFromTransaction(tx, documentType, uniqueProfileName(party ? `${party} ${readable(documentType).toLowerCase()}` : `${readable(documentType)} template`, profiles));
    saveProfiles([...profiles, template]);
    setSaved(template);
  };
  return <>
    <div className="ds-row" role="group" aria-label="Template library">
      <Button disabled={disabled || !!saved} onClick={save}>Save as template</Button>
      <span className="ds-muted">Keeps these fields and columns as a template{party ? ` for ${party}` : ''}.</span>
    </div>
    {saved && <Notice>{saved.match
      ? <>Saved “{saved.name}”. It will be suggested for the next {readable(documentType).toLowerCase()} from {saved.match.party}.</>
      : <>Saved “{saved.name}”. This document has no supplier or customer name to match it by, so it is not suggested automatically; pick it by hand on Home, or set who it is for on the Templates page.</>}</Notice>}
    {suggestions.map(({ profile }) => <Notice key={profile.id} tone="info">
      <div className="ds-row"><span>You have a template for {party ? <>documents from {party}</> : <>this kind of document</>}: “{profile.name}”.</span>
        <Button disabled={disabled} onClick={() => setUsing(profile)}>Read again with “{profile.name}”</Button>
        <Button variant="ghost" onClick={() => setDismissed(true)}>Not now</Button></div>
    </Notice>)}
    {using && <CustomizeFields start={using} initialStep="confirm" reviewCount={reviewCount} documentCount={documentCount} onClose={() => setUsing(undefined)} onExtract={onExtract} />}
  </>;
}
