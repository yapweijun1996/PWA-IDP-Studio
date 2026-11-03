import type { Value } from '../contract/types';
import type { ExtractionProfile, TemplateMatch } from './agent/contract';
import { REQUIRED_FIELDS } from './standards';
import type { DocumentType } from './types';

/** Words that say what kind of company a name is, not which one, so "ABC Trading Pte Ltd" and "ABC Trading Pte. Ltd." are the same party. */
const COMPANY_WORDS = new Set(['pte', 'ltd', 'limited', 'sdn', 'bhd', 'berhad', 'inc', 'incorporated', 'llc', 'llp', 'co', 'corp', 'corporation', 'company', 'plc', 'gmbh', 'pty', 'the']);

/** A name reduced to what identifies the company: lower case, no accents or punctuation, no company words. Empty when nothing is left. */
export function normalizeParty(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(word => word && !COMPANY_WORDS.has(word)).join(' ');
}

/** The header key that names the other party of a document type: supplier on a purchase, customer on a sale, payer on a receipt. */
export function partyKey(type: DocumentType): string | undefined {
  const first = REQUIRED_FIELDS[type]?.[0];
  return first?.endsWith('_name') ? first : undefined;
}

/** The name of the other party printed on a document, or undefined when it has none (or the value is not text). */
export function partyOf(data: Record<string, Value>, type: DocumentType): string | undefined {
  for (const key of [partyKey(type), 'supplier_name', 'customer_name', 'payer_name', 'payee_name']) {
    const value = key ? data[key] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** What to remember about a document so a template made from it can be suggested for the next one like it. */
export function matchFor(data: Record<string, Value>, type: DocumentType): TemplateMatch | undefined {
  const party = partyOf(data, type);
  if (!party || !normalizeParty(party)) return undefined;
  return { party, ...(type !== 'unknown' ? { documentType: type } : {}) };
}

export interface TemplateSuggestion { profile: ExtractionProfile; score: number }

/**
 * The saved templates that fit a document, best first. A template fits when every condition it sets holds: its party equals the
 * document's party (compared with normalizeParty) and its document type equals the document's. Built-in templates and templates
 * with no condition are never suggested. A party match outranks a type-only match, and both together rank highest.
 */
export function suggestTemplates(profiles: readonly ExtractionProfile[], doc: { documentType: DocumentType; party?: string }): TemplateSuggestion[] {
  const docParty = doc.party ? normalizeParty(doc.party) : '';
  const out: TemplateSuggestion[] = [];
  for (const profile of profiles) {
    const match = profile.match;
    if (profile.builtin || !match) continue;
    const wantsParty = match.party !== undefined && normalizeParty(match.party) !== '';
    if (!wantsParty && match.documentType === undefined) continue;
    if (wantsParty && normalizeParty(match.party!) !== docParty) continue;
    if (match.documentType !== undefined && match.documentType !== doc.documentType) continue;
    out.push({ profile, score: (wantsParty ? 2 : 0) + (match.documentType !== undefined ? 1 : 0) });
  }
  return out.sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name));
}
