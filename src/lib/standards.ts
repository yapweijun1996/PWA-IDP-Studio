import type { DocumentType } from '../contract/types';

export const REQUIRED_FIELDS: Record<DocumentType, string[]> = {
  purchase_invoice: ['supplier_name', 'invoice_no', 'invoice_date', 'currency', 'total_amount'],
  sales_invoice: ['customer_name', 'invoice_no', 'invoice_date', 'currency', 'total_amount'],
  sales_order: ['customer_name', 'order_no', 'order_date', 'currency', 'total_amount'],
  purchase_order: ['supplier_name', 'po_no', 'po_date', 'currency', 'total_amount'],
  bank_receipt: ['payer_name', 'receipt_no', 'receipt_date', 'currency', 'amount'],
  credit_note: ['supplier_name', 'credit_note_no', 'credit_note_date', 'currency', 'total_amount'],
  payment_document: ['payee_name', 'payment_no', 'payment_date', 'currency', 'amount'],
  delivery_order: ['customer_name', 'do_no', 'delivery_date'],
  statement: [], unknown: [],
};

// ISO 4217 alphabetic codes, including funds and precious-metal codes.
const CURRENCIES: Record<string, true> = {
  AED: true, AFN: true, ALL: true, AMD: true, ANG: true, AOA: true, ARS: true, AUD: true, AWG: true, AZN: true,
  BAM: true, BBD: true, BDT: true, BGN: true, BHD: true, BIF: true, BMD: true, BND: true, BOB: true, BOV: true, BRL: true, BSD: true, BTN: true, BWP: true, BYN: true, BZD: true,
  CAD: true, CDF: true, CHE: true, CHF: true, CHW: true, CLF: true, CLP: true, CNY: true, COP: true, COU: true, CRC: true, CUP: true, CVE: true, CZK: true,
  DJF: true, DKK: true, DOP: true, DZD: true, EGP: true, ERN: true, ETB: true, EUR: true, FJD: true, FKP: true,
  GBP: true, GEL: true, GHS: true, GIP: true, GMD: true, GNF: true, GTQ: true, GYD: true, HKD: true, HNL: true, HTG: true, HUF: true,
  IDR: true, ILS: true, INR: true, IQD: true, IRR: true, ISK: true, JMD: true, JOD: true, JPY: true, KES: true, KGS: true, KHR: true, KMF: true, KPW: true, KRW: true, KWD: true, KYD: true, KZT: true,
  LAK: true, LBP: true, LKR: true, LRD: true, LSL: true, LYD: true, MAD: true, MDL: true, MGA: true, MKD: true, MMK: true, MNT: true, MOP: true, MRU: true, MUR: true, MVR: true, MWK: true, MXN: true, MXV: true, MYR: true, MZN: true,
  NAD: true, NGN: true, NIO: true, NOK: true, NPR: true, NZD: true, OMR: true, PAB: true, PEN: true, PGK: true, PHP: true, PKR: true, PLN: true, PYG: true, QAR: true,
  RON: true, RSD: true, RUB: true, RWF: true, SAR: true, SBD: true, SCR: true, SDG: true, SEK: true, SGD: true, SHP: true, SLE: true, SOS: true, SRD: true, SSP: true, STN: true, SVC: true, SYP: true, SZL: true,
  THB: true, TJS: true, TMT: true, TND: true, TOP: true, TRY: true, TTD: true, TWD: true, TZS: true, UAH: true, UGX: true, USD: true, USN: true, UYI: true, UYU: true, UYW: true, UZS: true, VED: true, VES: true, VND: true, VUV: true, WST: true,
  XAF: true, XAG: true, XAU: true, XBA: true, XBB: true, XBC: true, XBD: true, XCD: true, XCG: true, XDR: true, XOF: true, XPD: true, XPF: true, XPT: true, XSU: true, XTS: true, XUA: true, XXX: true, YER: true, ZAR: true, ZMW: true, ZWG: true,
};
export const isIsoCurrency = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(CURRENCIES, value);

export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
