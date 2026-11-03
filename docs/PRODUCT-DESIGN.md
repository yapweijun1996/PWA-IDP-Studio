# IDP Studio product design

Status: product direction plus a gap analysis against the code on `main` (build `a72256d`, reviewed 2026-11-03).
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
| Footer | **no separate section**; totals are ordinary header fields | `total_amount`, `subtotal_amount`, `tax_amount` (Auto mode asks for these three) |

Illustrative clean JSON as produced today (flat, one transaction; the stock code is shown because a Targeted profile can capture it, Auto mode
does not – see gap 6):

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

- The user types a **label** ("Batch No"). The system derives the technical key (`batch_no`) itself. A key is only shown under an "advanced" disclosure.
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
| 1 | Edit fields without knowing JSON | Partial | `ProfileEditor.tsx` offers "Add header field" and "Add row column", but asks the user to type a **snake_case key** and rejects anything else (`validateProfile`) | Derive the key from the label; hide it |
| 2 | Customize Fields reachable from the review screen | Missing | Templates are edited only at `#/templates`, in a dialog | A "Customize Fields" panel inside the review screen |
| 3 | Extract again with the updated template | Missing | Retry reuses the profile **snapshot** taken at upload time (`idp-studio.batch-modes.v1`) | An explicit "Extract again with updated template" action |
| 4 | Add Row (manual detail record) | Missing | Cells of existing rows can be corrected; rows cannot be added | Add Row with human-entered marking and audit entry |
| 5 | Footer as its own section | Partial | Totals exist as header fields; no section marker in the profile or UI; the built-in profiles (`doc-info`, `doc-info-rows`) have no footer fields | A section marker on each field, grouped display, a built-in invoice template with footer fields |
| 6 | Stock Code (item code) extracted automatically | Missing | Auto row keys are only `description`, `quantity`, `unit_price`, `amount` (`src/lib/standards.ts`). Real purchase-order tests showed item codes being dropped | Add `stock_code` and `uom` to the Auto row keys and prompt |
| 7 | Templates per supplier / document type, suggested automatically | Missing | Custom profiles can be created, duplicated, imported and exported, and are picked by hand on Home (Targeted mode) | Template library with suggestion by supplier or document type; "save as template" from a reviewed document |
| 8 | Template screen a non-technical user can use | Partial | `Templates.tsx` also lists the raw Auto-mode keys and the per-type required keys | Plain-language copy; keep technical keys behind "advanced" |
| 9 | One name for "document number" across types | Partial | Auto uses `invoice_no`, `po_no`, `do_no` … per type; a Targeted profile uses `document_no` | Decide a single ERP-facing name or an alias map |

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
  (gap 6), totals that include GST (now reconciled through `tax_amount`), and text in non-embedded PDF fonts that used to be invisible to the model (fixed).

## 9. Roadmap proposal

Ordered by value for a non-technical user against effort. Sizes: S = days, M = 1–2 weeks, L = more.

| Phase | Work | Size | Done when |
|---|---|---|---|
| P1 Quick wins | Derive keys from labels (gap 1); `stock_code` and `uom` in Auto rows (6); plain-language Templates copy (8); a built-in invoice template with footer fields (5, first part) | S | A user adds "Batch No" without seeing a key; Auto extracts the stock code on a real purchase order |
| P2 Customize in review | Customize Fields panel in the review screen (2); Add Field / Add Column from it; "Extract again with updated template" (3); Add Row (4) | M | From a reviewed invoice: Add Column → Batch No → Save → Extract again; the new column is filled and validated |
| P3 Sections | Section marker on fields; grouped display of Document Info / Row Data / Footer (5); optional grouped JSON export | M | The review screen shows the three sections; footer lines are editable and reconcile with the row sum |
| P4 Template intelligence | Template library; suggestion by supplier or document type; "save as template" from a reviewed document (7); alias for document number (9) | M–L | A second invoice from a known supplier opens with that supplier's template suggested |

### Open decisions

1. **JSON shape** – flat (today) or grouped by section; recommendation in section 4.
2. **Cost of "Extract again"** – it repeats the AI calls for that document. Decide whether to ask for confirmation and whether to reuse the pages already read.
3. **Where templates live** – in this browser only today. Sharing templates between users needs a backend.
4. **Manual rows and approval** – a hand-added row has no evidence; decide whether approval needs an explicit acknowledgement for such rows.
