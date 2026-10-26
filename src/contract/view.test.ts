import { expect, it } from 'vitest';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { transactionView, batchSummary } from './view';

it('sorts exceptions first with explicit missing provenance and approval eligibility', () => {
  const input = invoiceInput();
  input.output.fields = input.output.fields.filter(f => f.key !== 'supplier_name');
  input.output.fields.find(f => f.key === 'invoice_date')!.value = 'bad';
  const batch = buildBatch(input);
  const view = transactionView(batch, 't_1');
  expect(view.documentType).toBe('purchase_invoice');
  expect(view.status).toBe('review_required');
  expect(view.fields.slice(0, 3).map(f => f.exception)).toEqual(['invalid', 'low_confidence', 'missing']);
  expect(view.fields.find(f => f.key === 'supplier_name')).toMatchObject({ pointer: '/supplier_name', value: null, confidence: null, evidence: null });
  expect(view.fields.find(f => f.key === 'total_amount')?.evidence?.page).toBe(1);
  expect(view.canApprove).toBe(false);
  expect(view.blockingCount).toBe(2);
  expect(view.lineItems).toEqual([{ description: 'Office Supplies', quantity: '10', unit_price: '128', amount: '1280' }]);
  expect(view.pages).toEqual([{ page_number: 1, width: 595, height: 842, status: 'classified' }]);
  expect(transactionView(buildBatch(invoiceInput()), 't_1').canApprove).toBe(true);
});
it('sums actual batch entities and review-required transactions', () => {
  const good = buildBatch(invoiceInput());
  const input = invoiceInput(); input.pages.push({ page_number: 2, width: 100, height: 200 });
  const pending = buildBatch(input);
  expect(batchSummary([good, pending])).toEqual({ pages: 3, documents: 2, transactions: 2, reviewQueue: 1 });
  expect(batchSummary([])).toEqual({ pages: 0, documents: 0, transactions: 0, reviewQueue: 0 });
});
