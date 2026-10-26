import { describe, expect, it } from 'vitest';
import { invoiceInput } from './fixtures';
import { buildBatch } from './build';
import { approveTransaction, correctField, recomputeIssues } from './review';
import { validateBatch } from './validate';

describe('immutable batch reviews', () => {
  it('corrects, resolves, approves and invalidates approval on the next edit', () => {
    const input = invoiceInput();
    input.output.fields.find(f => f.key === 'total_amount')!.value = '50';
    const original = buildBatch(input);
    const snapshot = structuredClone(original);
    expect(approveTransaction(original, 't_1', 'Reviewed')).toMatchObject({ ok: false });
    const fixed = correctField(original, 't_1', '/total_amount', '1280.00', 'Checked original');
    expect(original).toEqual(snapshot);
    expect(fixed.transactions[0]).toMatchObject({ revision: 2, status: 'validated', data: { total_amount: '1280.00' } });
    expect(fixed.evidence.find(e => e.field_pointer === '/total_amount')).toMatchObject({ value: '1280.00', method: 'human', review_status: 'corrected' });
    expect(fixed.issues.find(i => i.rule_code === 'TOTALS_MISMATCH')).toMatchObject({ status: 'resolved' });
    expect(fixed.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')).toMatchObject({ status: 'resolved' });
    expect(fixed.reviews[0]).toMatchObject({ action: 'correct', actor_id: 'local_user', prior_revision: 1, new_revision: 2, reason: 'Checked original' });
    const result = approveTransaction(fixed, 't_1', 'Reviewed original');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.batch.transactions[0].status).toBe('approved');
    expect(result.batch.documents[0].status).toBe('approved');
    expect(result.batch.batch.status).toBe('approved');
    expect(result.batch.reviews[1]).toMatchObject({ action: 'approve', prior_revision: 2, new_revision: 3 });
    const edited = correctField(result.batch, 't_1', '/invoice_no', 'NEW-1', 'Corrected number');
    expect(edited.transactions[0].status).toBe('validated');
    for (const b of [original, fixed, result.batch, edited, recomputeIssues(edited)]) expect(validateBatch(b).ok).toBe(true);
  });
  it('creates missing values without fabricating evidence and preserves issue history on recurrence', () => {
    const input = invoiceInput(); input.output.fields = input.output.fields.filter(f => f.key !== 'supplier_name');
    const b = buildBatch(input);
    const fixed = correctField(b, 't_1', '/supplier_name', 'Vendor', 'Read original');
    expect(fixed.transactions[0].field_evidence['/supplier_name']).toBeUndefined();
    expect(fixed.issues.find(i => i.rule_code === 'MISSING_REQUIRED')?.status).toBe('resolved');
    const recurrent = correctField(fixed, 't_1', '/supplier_name', '', 'Clear incorrect value');
    expect(recurrent.issues.filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.status)).toEqual(['resolved', 'open']);
    expect(validateBatch(recurrent).ok).toBe(true);
  });
  it('corrects line-item decimals with pointer traversal and refuses invalid pointers', () => {
    const b = buildBatch(invoiceInput());
    const fixed = correctField(b, 't_1', '/line_items/0/amount', '1,280.00', 'Checked line');
    expect(fixed.transactions[0].data.line_items).toMatchObject([{ amount: '1280.00' }]);
    expect(validateBatch(fixed).ok).toBe(true);
    for (const pointer of ['/__proto__/polluted', '/line_items/9/amount', '/bad~pointer']) expect(() => correctField(b, 't_1', pointer, 'x', 'Invalid')).toThrow();
  });
  it('preserves waived and resolved history without duplicating current issues', () => {
    const b = buildBatch(invoiceInput());
    const low = b.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    low.status = 'waived';
    const next = recomputeIssues(b);
    expect(next.issues).toEqual(b.issues);
    expect(next).not.toBe(b);
    expect(validateBatch(next).ok).toBe(true);
  });
  it('rejects approval for a batch-level page limit or unknown transaction', () => {
    const input = invoiceInput(); input.pages.push({ page_number: 2, width: 595, height: 842 });
    const b = buildBatch(input);
    expect(approveTransaction(b, 't_1', 'Reviewed')).toMatchObject({ ok: false });
    expect(approveTransaction(b, 'missing', 'Reviewed')).toMatchObject({ ok: false });
  });
});
