# IDP Studio product design

Status: product direction plus a gap analysis against the code on `main`. First reviewed 2026-11-03 at build `a72256d`; roadmap phase P1 was
implemented and verified the same day (sections 7 and 9 say what changed).
Nothing in sections 1–6 is a promise that it already exists; section 7 says exactly what does and does not.

## 1. Goal

An Intelligent Document Processing (IDP) system that ordinary users can operate **without understanding JSON**.
Users pick the fields they need in the interface, AI reads the file (PDF, invoice, purchase order, delivery order …),
and the system organises the result and generates the JSON for an ERP or an API.

目标：让普通用户不需要懂 JSON，也能用 AI 提取 PDF、Invoice、Purchase Order、Delivery Order 等文件的数据。
用户通过界面选择需要的字段，AI 负责读取文件，系统自动整理数据并生成 JSON。

One sentence: **as easy to edit fields as Excel, as automatic at reading documents as an AI assistant,
as strict at validating data as an ERP.**

## 2. Design principle: keep Template Configuration apart from Document Extraction

| | Document Extraction (the default path) | Template Configuration (only when needed) |
|---|---|---|
| Who | Every user, every time | A user who needs a field the AI did not offer |
| What | Upload a file, AI extracts, review, export | Add or change fields and columns, mark required, save as a template |
| Opens | Immediately | Behind a "Customize Fields" action, never in the way |
| Effect | Produces data for this document | Changes what the AI is asked for on later extractions |

A user must be able to get a first useful result without opening any configuration screen. Configuration exists to add
flexibility, not to be a prerequisite.

## 3. The four-step workflow

1. **Upload PDF** – the user uploads an invoice; no JSON or schema is set up first.
2. **AI Auto Extract** – AI identifies the document number, date, stock, quantity, amount and total.
3. **Review & Customize** – the document is on the left, the extracted data on the right. The user corrects values or adds a field
   with **Add Field**.
4. **Validate & Export** – the system checks amounts, required fields and the evidence in the original document, then generates the JSON for
   the ERP or API once the user confirms.

## 4. The document model: three sections

Every document is shown, edited and exported in three sections. (The example is the reference layout for this design.)

**Document Info（文件基本资料）** – values that appear once per document.

| Field | Example |
|---|---|
| Document Number | INV-001 |
| Date Transaction | 03/11/2026 |
| Customer | ABC Trading |
| Currency | SGD |

The user can add fields such as Customer Code, Reference No or Salesperson.

**Row Data（明细表格）** – any number of rows, every row has the same columns.

| Row | Stock Code | Qty | Unit Price | Amount |
|---|---|---|---|---|
| 1 | A001 | 2 | 100 | 200 |
| 2 | B002 | 3 | 50 | 150 |

The user can add columns such as Remark, Discount, UOM or Batch No.

**Footer（金额汇总）** – the totals printed at the bottom.

| | |
|---|---|
| Sub Total | SGD 350.00 |
| GST (9 % in this example) | SGD 31.50 |
| **Grand Total** | **SGD 381.50** |

The user can add Shipping Fee, Discount, Rounding and similar lines. The example is internally consistent
(2×100 + 3×50 = 350; 350 + 31.50 = 381.50), which is exactly what the amount validation checks.

### How the three sections map to the data today

| Section | Today in the profile (`ExtractionProfile`) | Today in the data |
|---|---|---|
| Document Info | `fields` | header keys on the transaction `data` |
| Row Data | `rowFields` | `data.line_items` |
| Footer | **no separate section**; totals are ordinary header fields | `total_amount`, `subtotal_amount`, `tax_amount` (Auto mode asks for these three; the built-in *Invoice with totals* template includes them) |

Illustrative clean JSON as produced today (flat, one transaction; Auto mode and the built-in invoice template both capture the stock code):

```json
{
  "invoice_no": "INV-001",
  "invoice_date": "2026-11-03",
  "customer_name": "ABC Trading",
  "currency": "SGD",
  "subtotal_amount": "350.00",
  "tax_amount": "31.50",
  "total_amount": "381.50",
  "line_items": [
    { "stock_code": "A001", "quantity": "2", "unit_price": "100.00", "amount": "200.00" },
    { "stock_code": "B002", "quantity": "3", "unit_price": "50.00",  "amount": "150.00" }
  ]
}
```

Open decision (section 9): keep this flat shape as the stable machine contract and use sections only in the UI, or also offer a grouped export
(`document` / `rows` / `footer`). Recommendation: keep it flat for ERP/API stability and add grouping as an optional export.

## 5. Three different "add" actions

These must be separate controls in separate places so users do not confuse them.

| Action | Adds | Changes | Where it lives |
|---|---|---|---|
| **Add Field** | One document-level value (Document Info or Footer), e.g. Customer Code, Shipping Fee | The **template** | Customize Fields |
| **Add Column** | One more column that every row has, e.g. Batch No | The **template** | Customize Fields, Row Data |
| **Add Row** | One more detail record, e.g. a third stock item | **This document's data** only | Bottom of the Row Data table in the review screen |

Example: a customer's invoice has a Batch No that the default row data does not. A traditional system needs a developer to change a JSON schema or the
program. Here the user clicks **Add Column → Batch No → Save**, and the next extraction with the updated template tries to read Batch No.

Rules for these controls:

- The user types a **label** ("Batch No"). The system derives the technical key (`batch_no`) itself. A key is only shown under an "advanced" disclosure. Implemented in the template editor: `keyFromLabel()` derives a unique snake_case key, *Show technical keys* reveals it, it follows the label while the field is new, and it never changes for a field that was already saved.
- A new Field or Column is saved into the template, so it applies to later documents; Add Row never touches the template.
- Every manually added value is marked as human-entered and has no source-page evidence, so validation reports it as such instead of faking evidence.

## 6. Templates

Users keep several templates, for example *Supplier A Invoice*, *Supplier B Invoice*, *Purchase Order*, *Delivery Order*. The default is no template: the AI
chooses fields (Auto). A template is chosen, or suggested, only when the user wants a fixed set of fields.

## 7. Where the product stands today (gap analysis)

Status: **Done** = works as described, **Partial** = a version exists but not the described experience, **Missing** = not in the code.
File references are for the reviewer; they describe `main` at build `a72256d`.

| # | Capability | Status | What the code does today | Gap |
|---|---|---|---|---|
| 0 | Upload and AI auto extract with no setup | Done | Home dropzone, Auto mode by default (`src/ui/pages/Home.tsx`) | – |
| 0 | Side-by-side review: document left, data right, evidence boxes | Done | `Workspace.tsx`: viewer plus Fields / Issues / JSON tabs; every correction needs a reason | – |
| 0 | Validate and export | Done | Required fields, decimals, ISO dates and currencies, line sum plus optional tax equals total, per-transaction export gating, waivers with a reason (`src/contract/rules.ts`) | – |
| 1 | Edit fields without knowing JSON | Done (P1) | `ProfileEditor.tsx`: the user names a field or column ("Add field", "Add column"); `keyFromLabel()` derives a unique, valid snake_case key; keys are hidden unless *Show technical keys* is on; a saved field's key never changes. Verified in Chrome: "Customer Code" and "Batch No" were saved as `customer_code` and `batch_no` with no key shown | The editor is still only on the Templates page (gap 2) |
| 2 | Customize Fields reachable from the review screen | Done (P2) | A **Customize fields** button in the review header opens a dialog (`CustomizeFields.tsx`) with the same field/column form as the Templates page (`ProfileFieldsForm.tsx`). It starts from the template the document was read with (as a copy), or, for an Auto result, from what the document contains (`templateFromTransaction`: the fields and columns that have a value, plus the required ones, typed by key name). Add field / Add column; the template is kept on the Templates page | – |
| 3 | Extract again with the updated template | Done (P2) | **Save and extract again** asks first (it says how many corrections, approvals or waivers are replaced, and that it uses the AI provider again), then reads the stored original with the new template into a **separate batch**. The earlier result is replaced only when the new one is complete (not failed, at least one transaction, every page classified); a failure or a cancel deletes the new batch and leaves the earlier result untouched. While it runs the earlier result is locked (no edits, no approval) because those edits would be discarded. Verified in Chrome (`customize-fields`): failed run keeps the corrected result, complete run replaces it with `batch_no` filled | Corrections and approvals are not carried over to the new result; pages already read are not reused (see open decision 2) |
| 4 | Add Row (manual detail record) | Missing | Cells of existing rows can be corrected; rows cannot be added | Add Row with human-entered marking and audit entry |
| 5 | Footer as its own section | Partial | Totals are header fields; there is still no section marker in the profile or UI. The built-in **Invoice with totals** template (P1) now has Sub total, Tax (GST) and Grand total, and a Targeted template that declares `total_amount` as an amount is reconciled (rows + tax = total). Verified on 12 real purchase orders: 673.50 + 53.88 = 727.38 and the like, no mismatch | A section marker on each field and grouped display (P3) |
| 6 | Stock Code (item code) extracted automatically | Done (P1) | Auto row keys are `stock_code`, `description`, `quantity`, `uom`, `unit_price`, `amount` (`src/lib/standards.ts`) and the prompt says to copy the code as printed, never to build it from other columns. Verified on 6 real purchase orders: filled on every row (for example 8100234, 2154815, 1913177), none synthesized | – |
| 7 | Templates per supplier / document type, suggested automatically | Missing | Custom profiles can be created, duplicated, imported and exported, and are picked by hand on Home (Targeted mode) | Template library with suggestion by supplier or document type; "save as template" from a reviewed document |
| 8 | Template screen a non-technical user can use | Partial (P1) | `Templates.tsx` explains templates in plain words and lists the Auto-mode fields as readable names; the raw keys are behind *Show technical keys* | The UI still says "profile" in places (Create profile, Use … for next upload) on a page called Templates. Labels now keep acronyms in capitals (`labelFromKey`: "UOM", "PO no", "DO no", "Document ID") |
| 9 | One name for "document number" across types | Partial | Auto uses `invoice_no`, `po_no`, `do_no` … per type; a Targeted profile uses `document_no` | Decide a single ERP-facing name or an alias map |
| 10 | A customized result keeps every check Auto applied | Partial (P2) | Types derived from the key names keep the date, decimal and required-field checks, and `total_amount` typed as an amount keeps the totals reconciliation. A Targeted result does **not** check `currency` against ISO 4217, because that rule runs only when the transaction has no declared field types | Run the ISO 4217 rule for a field named `currency` in Targeted results too (a validation change, so it needs its own tests) |

## 8. Research notes

Short, checked against the pages named. Brief reads, not a product comparison.

- **Rossum** documents an extraction schema editor in which *sections* group fields (for example "Basic Information" or "Amounts"), the field types
  are *simple value*, *multivalue* and *line items (table)*, and adding a field takes a **Label**, an **ID**, a data type (text, number, date, enum) and a field type.
  Business users can do this through forms and the JSON editor is optional, but the guidance warns against changing IDs on documents that were already
  annotated. Lesson for us: group fields into sections, and generate IDs from labels so users never type them.
  [Extraction Schema Editor in Rossum](https://knowledge-base.rossum.ai/docs/extraction-schema-editor-in-rossum)
- **Dual-pane review** (original document on one side, extracted data on the other, source highlighting, low-confidence flags) is described by
  Docupath and in an AWS Builder Center write-up on human-in-the-loop extraction review. This matches the existing review screen. These two were taken from
  search summaries and were not opened in full.
  [Docupath dual-pane review](https://intercom.help/docupath/en/articles/15810167-using-the-dual-pane-review-screen),
  [AWS: human-in-the-loop review for AI document extraction](https://builder.aws.com/content/3HR4WZAl4gsTJ02TR1ACFzwJ2Gb/building-a-human-in-the-loop-review-system-for-ai-document-extraction)
- **Azure AI Document Intelligence** has a prebuilt invoice model that extracts key fields and line items from invoices, utility bills, sales orders and purchase
  orders and returns structured JSON. Its field schema is published on a separate page; **field names were not verified here**, so none are copied into this
  document. [Invoice model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept-invoice)
- **Our own tests** with seven real purchase orders (digital and scanned) found concrete product gaps that feed this list: item codes dropped by Auto mode
  (gap 6, fixed in P1), totals that include GST (now reconciled through `tax_amount`), and text in non-embedded PDF fonts that used to be invisible to the model (fixed).

## 9. Roadmap proposal

Ordered by value for a non-technical user against effort. Sizes: S = days, M = 1–2 weeks, L = more.

| Phase | Work | Size | Done when |
|---|---|---|---|
| P1 Quick wins (**done**) | Derive keys from labels (gap 1); `stock_code` and `uom` in Auto rows (6); plain-language Templates copy (8); a built-in invoice template with footer fields (5, first part) | S | A user adds "Batch No" without seeing a key; Auto extracts the stock code on a real purchase order. **Verified** in Chrome on build `df81f2b`: Batch No saved as `batch_no`; stock code and UOM filled on every row of 6 real purchase orders; the invoice template reconciled the GST totals of 12 real orders. Left over: unify "profile" and "template" wording (gap 8) |
| P2 Customize in review (**done**, except Add Row) | Customize Fields panel in the review screen (2); Add Field / Add Column from it; "Extract again with updated template" (3) | M | From a reviewed invoice: Add Column → Batch No → Save → Extract again; the new column is filled and validated. **Verified** in Chrome (`customize-fields`) with mocked provider replies: a failed run kept the corrected result and left no extra batch; a complete run replaced it, moved to the new result, filled `batch_no` and kept the template on the Templates page. Not yet tried on a real file with a real provider |
| P2b Add Row | Add Row at the bottom of the Row Data table, human-entered marking and an audit entry (4) | S–M | A third stock item can be added to a document, is marked as entered by hand, and appears in the export; needs open decision 4 first |
| P3 Sections | Section marker on fields; grouped display of Document Info / Row Data / Footer (5); optional grouped JSON export | M | The review screen shows the three sections; footer lines are editable and reconcile with the row sum |
| P4 Template intelligence | Template library; suggestion by supplier or document type; "save as template" from a reviewed document (7); alias for document number (9) | M–L | A second invoice from a known supplier opens with that supplier's template suggested |

### Open decisions

1. **JSON shape** – flat (today) or grouped by section; recommendation in section 4.
2. **Cost of "Extract again"** – it repeats the AI calls for the whole file (including page segmentation for a bundle of more than 10 pages). The confirmation now says so; still open is whether to reuse the pages already read and whether to carry the user's earlier corrections over to the new result.
3. **Where templates live** – in this browser only today. Sharing templates between users needs a backend.
4. **Manual rows and approval** – a hand-added row has no evidence; decide whether approval needs an explicit acknowledgement for such rows.
