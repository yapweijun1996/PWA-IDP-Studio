# IDP Studio product design

Status: product direction plus a gap analysis against the code on `main`. First reviewed 2026-11-03 at build `a72256d`; roadmap phases P1, P2, P2b, P3 and P4 (without the document-number alias) were
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
| Document Info | `fields` not marked as footer (`section` omitted or `info`) | header keys on the transaction `data` that are not footer lines |
| Row Data | `rowFields` | `data.line_items` |
| Footer | `fields` with `section: 'footer'`, or by default any field whose key says it is a total or a charge (`defaultSection` in `src/lib/sections.ts`: `total_amount`, `subtotal_amount`, `tax_amount`, `shipping_fee`, `discount_amount`, `rounding` …; not `tax_id`, `shipping_address`, `due_date`) | header keys on `data`; the stored batch does not change, the grouping is applied when showing and exporting |

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

Decision (section 9): the flat shape above stays the stable machine contract for an ERP or API. The sections are applied in the review screen, and an optional **Grouped JSON** export (`document` / `rows` / `footer`, `groupedJSONValue`) is offered next to it; the grouped export holds exactly the values of the flat one.
The grouped export is a view of the same data, never a second source of truth.

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
- Every manually added row is marked **Entered by hand** in the table and recorded in the review trail (who, when, why). It has no source-page evidence: the contract requires evidence to point at a page region, and a typed row has none, so nothing is faked.

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
| 4 | Add Row (manual detail record) | Done (P2b) | An **Add row** button under the Line items table opens a dialog (`AddRow.tsx`) with one box per column and a reason. `addRow` in `src/contract/review.ts` appends the row at the end (so no evidence pointer moves), gives it the declared type and required mark of its column (so a template result validates it like the others), withdraws an earlier approval, writes a `correct` review "Row added by hand: row N. <reason>", and re-runs every rule, so a row that breaks the total blocks approval. The row is shown with an **Entered by hand** badge (`handEnteredRows` reads the review trail; the badge survives a reload and an export). Text in a number column is refused at entry. Verified in Chrome with mocked replies (`add-row`) and on a real template result (6th row on a real purchase order: types inherited, total mismatch raised, approval blocked) | A hand-entered row cannot be removed again, only corrected; rows cannot be inserted in the middle; a result whose rows are separate transactions (statements) has no Add row |
| 5 | Footer as its own section | Done (P3) | The review screen lists **Document info**, **Row data**, **Footer** in that order (`Workspace.tsx`). A header field belongs to the footer when its template says so (`ProfileField.section`, chosen in the field form as *Section*) or, with no choice, when its key says it is a total or a charge (`defaultSection`). The footer shows a **totals check** (`reconcileTotals`, the same function the TOTALS_MISMATCH rule uses): rows add up to X, tax Y, grand total Z, *Matches* or *Does not match*. Footer lines are edited like any field. Verified on real purchase orders in Chrome: 673.50 + 53.88 = 727.38 (TP-Link), 5605.90 (SYN), a 128-row order 7178.43 (Popular), and non-standard fields (`payment_terms`, `supplier_code`, `delivery_location`) stay in the document info | Footer lines other than subtotal, tax and total are shown and editable but do not enter the reconciliation (gap 11) |
| 6 | Stock Code (item code) extracted automatically | Done (P1) | Auto row keys are `stock_code`, `description`, `quantity`, `uom`, `unit_price`, `amount` (`src/lib/standards.ts`) and the prompt says to copy the code as printed, never to build it from other columns. Verified on 6 real purchase orders: filled on every row (for example 8100234, 2154815, 1913177), none synthesized | – |
| 7 | Templates per supplier / document type, suggested automatically | Done (P4) | A template can say who it is for (`ExtractionProfile.match`: a supplier or customer name and/or a document type), set in the template editor or remembered automatically. **Save as template** in the review screen keeps what a document contains (as in Customize fields) with the supplier and document type it came from. When a document read without a template (Auto) matches a saved template, the review screen suggests it (`suggestTemplates`: supplier names are compared ignoring case, punctuation and company words such as Pte Ltd or Sdn Bhd, never fuzzily; party and type outrank party only outrank type only; at most two are shown, best first, with *Not now*). **Read again with** opens the usual *Extract this document again?* question, so nothing is read or replaced without a yes. Built-in templates and templates with no condition are never suggested. Verified in Chrome with a real purchase order and the real AI: Save as template on one reading, a second upload of the same supplier showed the suggestion, and reading again with it filled `supplier_address`, `deliver_to` and `delivery_address`, 5 rows, total 5605.90, validated | Templates live in this browser only (open decision 3); a template is never applied before a document has been read once, because the supplier is unknown until then (so the first read of a new supplier costs two reads if the template is wanted) |
| 8 | Template screen a non-technical user can use | Partial (P1) | `Templates.tsx` explains templates in plain words and lists the Auto-mode fields as readable names; the raw keys are behind *Show technical keys* | The UI still says "profile" in places (Create profile, Use … for next upload) on a page called Templates. Labels now keep acronyms in capitals (`labelFromKey`: "UOM", "PO no", "DO no", "Document ID") |
| 9 | One name for "document number" across types | Partial | Auto uses `invoice_no`, `po_no`, `do_no` … per type; a Targeted profile uses `document_no` | Decide a single ERP-facing name or an alias map |
| 10 | A customized result keeps every check Auto applied | Done | Types derived from the key names (or declared by the template) keep the date, decimal and required-field checks, `total_amount` typed as an amount keeps the totals reconciliation, and a field keyed `currency` is checked against ISO 4217 in a Targeted result too (only when it has a value, so an optional currency the document does not print is not an error). Checked against 7 real batches (29 transactions, currencies SGD and USD): no new issue | – |
| 11 | Footer lines beyond subtotal, tax and total reconcile | Missing | The totals rule knows only *rows = total* or *rows + tax = total*. A shipping fee, discount or rounding line is shown in the Footer and can be edited, but a total that includes it raises TOTALS_MISMATCH, which a person can waive with a reason | Let footer charge and adjustment lines take part in the check (sign of a discount, rounding); the template marker alone is not enough because the stored batch does not carry sections, so this needs its own design and real-data check |

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
| P2 Customize in review (**done**) | Customize Fields panel in the review screen (2); Add Field / Add Column from it; "Extract again with updated template" (3) | M | From a reviewed invoice: Add Column → Batch No → Save → Extract again; the new column is filled and validated. **Verified** in Chrome (`customize-fields`) with mocked provider replies: a failed run kept the corrected result and left no extra batch; a complete run replaced it, moved to the new result, filled `batch_no` and kept the template on the Templates page. Not yet tried on a real file with a real provider |
| P2b Add Row (**done**) | Add Row at the bottom of the Row Data table, human-entered marking and an audit entry (4) | S–M | A third stock item can be added to a document, is marked as entered by hand, and appears in the export. **Verified** with unit tests (22, each key behaviour mutation-checked), Chrome E2E `add-row`, and a real purchase order result (not a new AI call: Add Row is local) |
| P3 Sections (**done**) | Section marker on fields; grouped display of Document Info / Row Data / Footer (5); optional grouped JSON export | M | The review screen shows the three sections; footer lines are editable and the footer checks the row sum. **Verified**: unit tests (each key behaviour mutation-checked), Chrome E2E `sections`, and real purchase orders (no new AI call: P3 changes display, template marker and export only) |
| P4 Template intelligence (**done**, except the alias) | Template library; suggestion by supplier or document type; "save as template" from a reviewed document (7); alias for document number (9, not done) | M–L | A second invoice from a known supplier opens with that supplier's template suggested. **Verified**: unit tests (each key behaviour mutation-checked), Chrome E2E `template-library`, and a real purchase order read by the real AI |

### Open decisions

1. **JSON shape** – decided as a default: flat stays the contract; grouped is an optional export (done in P3). Open only if ERP integrations later need grouped as the primary shape.
2. **Cost of "Extract again"** – it repeats the AI calls for the whole file (including page segmentation for a bundle of more than 10 pages). The confirmation now says so; still open is whether to reuse the pages already read and whether to carry the user's earlier corrections over to the new result.
3. **Where templates live** – in this browser only today. Sharing templates between users needs a backend.
4. **Manual rows and approval** – decided as a default, open to change: a hand-added row does not block approval by itself (the approval, if any, is withdrawn when the row is added, and the row is badged and audited). The stricter alternative is to make approval ask for an explicit acknowledgement of each hand-entered row; it would fit `approveTransaction` and the Approve button without a contract change.
