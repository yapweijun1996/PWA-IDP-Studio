import type { BuildInput } from './build';
import { checkModelOutput } from '../lib/validate';

export function invoiceInput(): BuildInput {
  return {
    batchId: 'batch_test', createdAt: '2026-10-26T00:00:00.000Z',
    file: { file_id: 'file_test', filename: 'invoice.pdf', media_type: 'application/pdf', sha256: 'a'.repeat(64), size: 100 },
    pages: [{ page_number: 1, width: 595, height: 842 }], renderedPageCount: 1, model: { provider: 'demo', model: 'demo-auto' },
    output: checkModelOutput({ document_type: 'purchase_invoice', status: 'approved', fields: [
      { key: 'supplier_name', value: 'ABC Trading Pte Ltd', page: 1, bbox: [80, 120, 110, 260], confidence: 0.98 },
      { key: 'invoice_no', value: 'INV-2026-1042', page: 1, bbox: [80, 300, 110, 420], confidence: 0.99 },
      { key: 'invoice_date', value: '2026-10-26', page: 1, bbox: null, confidence: 0.96 },
      { key: 'currency', value: 'SGD', page: 1, bbox: null, confidence: 0.99 },
      { key: 'total_amount', value: '1,280.00', page: 1, bbox: [900, 700, 930, 800], confidence: 0.72 },
    ], line_items: [{ description: 'Office Supplies', quantity: 10, unit_price: 128, amount: 1280 }] }),
  };
}
