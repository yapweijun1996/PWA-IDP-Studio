# PWA-IDP-Studio — Multi-Document / Multi-Transaction Contract 2.0.0

**Status:** Proposed implementation contract, 26 October 2026. **Language:** English. **Scope:** Intelligent Document Processing (IDP) extraction, evidence, document grouping and human review; **not** an instruction to post transactions to ERP.

## 1. Executive decision

Adopt **Batch → Source Files → Pages → Regions → Logical Documents → Business Transactions**, with normalized **Evidence**, **Issues**, **Reviews**, and **Validation** collections. A single 100-page PDF may contain 1 document, 20 documents, 21 documents, or any other count. One document may yield more than one business transaction. A page may contain multiple document regions. A logical document may refer to discontinuous pages in any order. Every reference is tied to the immutable original file and its 1-based page index.

Use **JSON Schema Draft 2020-12** for structural contracts and separate deterministic validators for referential integrity, page coverage, grouping, financial rules and export safety. The standard is JSON Schema, not a universal industry IDP schema. Align business semantics with UBL or Peppol through separate mappings where applicable; do not claim this native JSON is UBL compliant.

## 2. Included deliverables

- `batch-v2.0.0.schema.json`: Draft 2020-12 batch envelope and all core entities.
- `sample-100-pages-20-transactions.json`: 100 PDF pages, 20 logical documents, exactly 20 transactions, including *non-contiguous* document groupings and a boundary-review blocker.
- `sample-100-pages-22-transactions-edge-cases.json`: 100 pages, 21 logical documents, 22 transactions; includes two logical documents on page 2 and a statement with two transaction records.
- `sample-two-documents-one-page.json`: small example of shared page regions across two documents (plus a second page).
- `validate.py`: JSON Schema + practical cross-object consistency checks.
- `build.py`: reproducible sample/schema generator. No production data included.

**Important fixture detail:** The 100-page examples are *synthetic*, not extracted from a PDF. Their `sha256` is a placeholder based on deterministic example bytes; a real deployment MUST hash actual uploaded file bytes. The supplied `structural_valid` and other stored validation flags are reported results, never an input authority: recompute on every acceptance/export.

## 3. Logical model and cardinality

| Resource | ID | Relationship | Notes |
|---|---|---|---|
| Batch | `batch_id` | one batch → many source files | Upload session and workflow status |
| Source file | `file_id` | file → 1..N pages | Original immutable bytes; content hash |
| Page | `(file_id,page_number)` | page → 0..N regions | Page numbers start at 1; zero regions require an unassigned reason |
| Region | `(file_id,page_number,region_id)` | region → one document | Full page or sub-page geometry; page may have multiple regions |
| Logical document | `document_id` | document → 1..N page regions | Each document maintains `page_refs[]`, even non-contiguous |
| Transaction | `transaction_id` | document → 0..N transactions | Classification/extraction can precede transaction creation |
| Evidence | `evidence_id` | transaction field → 0..N evidence records | Per-field provenance and position |
| Issue | `issue_id` | links to scoped target | Warn, error or block export; open/resolved/waived |
| Review | `review_id` | append-only decision | Human correction, merge/split, approval, waiver |

A source PDF may hold multiple *logical documents*. A source page can hold a receipt and invoice in separate regions. Document pages need not be consecutive. A payment statement could be **one logical document with many transactions**; `transaction_type=statement_entry` is supported. A purchase invoice may have invoice body, continuation tables and supporting attachments on far-apart pages.

## 4. Entity invariants

**Batch:** `schema_version` exactly `2.0.0`; batch revision strictly positive; timestamps RFC 3339; status does not override child statuses.

**Source files:** immutable file ID and actual SHA-256 of bytes; MIME type and physical page count; optional `storage_ref` resolves through the authorized local document store, never an arbitrary untrusted remote URL. For a browser-only/PWA deployment, use IndexedDB for blobs; only small preferences in localStorage.

**Pages:** exactly one Page Manifest row for each `(file_id,page_number)` from `1..page_count`, including blank, failed and unassigned pages. The page must never silently disappear because OCR found no fields. The `regions[]` list supports multiple documents; intentional overlap must raise a warning unless explicitly recorded as shared source. The example validator checks page presence but does not attempt geometric overlap detection.

**Coordinates:** normalized `x,y,width,height` in [0,1] for original unrotated media-box view, origin upper-left. Enforce `x + width ≤ 1` and `y + height ≤ 1` in semantic validation. Record rotation separately. If PDF crops/rotations are used, the renderer must preserve mapping to original coordinates; image pixels and PDF points must not be silently mixed. All evidence must refer to a page assigned to the same document. Complex polygons can be a backwards-compatible extension in a later minor contract.

**Document:** `page_refs[]` explicitly contains its `(file_id,page_number,region_id)` references. `boundary_status=needs_review` means **do not export** transactions attached to it. `schema_id` and `schema_version` identify a registry-managed type-specific business data schema. Grouping is independent of transaction type or transaction number; identical printed headers do not automatically mean the same document.

**Transaction:** `data` holds custom business fields; a production extraction must validate it against the exact immutable version of `schema_id`. `field_evidence` maps JSON Pointers relative to `data` (for example `/invoice_no`, `/line_items/0/amount`) to evidence IDs. For currency-critical data, use decimal strings and fixed-precision arithmetic; never rely on JavaScript binary floating-point for reconciliations. ISO 8601 dates and ISO 4217 currency codes are recommended within type-specific schemas. The sample includes string amounts intentionally.

**Evidence:** `field_pointer` is an RFC 6901 JSON Pointer relative to transaction `data`; a single field can have multiple evidence regions. Values may be machine-extracted or human-corrected. The evidence `confidence` is a model signal only, **not proof of correctness**. A reviewer can confirm or correct provenance independently of field value. Source `text_span` is nullable for image-only extraction.

**Issues and reviews:** an open blocking issue prevents export of the affected scope, including the whole batch for batch-scoped blockers. A waiver must be explicit, authorized and auditable, and must not permit bypass of mandatory integrity rules. Keep append-only history of boundary changes, corrected values and changed evidence, including old/new revisions. Current `review` structure records actor/action/time/reason/revisions; a production implementation should additionally keep immutable revision snapshots or signed patch records for value-level audit reconstruction.

**Validation:** stored flags are advisory; authoritative validators recompute them. Determine export eligibility per transaction from schema, references, page coverage, grouping confirmation, document/transaction status, tenant policies, mandatory fields, reconciliation and unresolved blockers. A valid JSON document does **not** imply its accounting values are correct.

## 5. Processing algorithm (100 pages / 20 transactions)

1. Accept file; stream or persist immutable bytes; compute real SHA-256; create Source File record and the 100 Page Manifest entries before any AI call.
2. Render/OCR all pages in bounded batches with checkpoints. Failures remain visible (`status=error`, `unassigned_reason=ocr_failed`). Preserve all original page indices.
3. Extract per-page fingerprints: transaction numbers, party identifiers, header/footer patterns, totals, tables, page `x of y`, QR/barcode and first/last text blocks. No irreversible grouping yet.
4. Identify candidate **document starts, continuations, attachments, and multi-document page regions**. Use cross-page reasoning with overlap windows at chunk boundaries. Record candidate confidence and alternatives. Do not assume every five pages is one transaction.
5. Build `documents[]` from region references. Group non-contiguous attachments when supported by matching identifiers. In ambiguous situations, keep `boundary_status=needs_review` and create a blocking `BOUNDARY_UNCERTAIN` issue.
6. Resolve type-specific schema by `(tenant, company, document_type, template_version)`; do not trust tenant selectors as authentication. Keep tenant isolation in any learned rules.
7. Extract per-document fields and line items, tracking source pages and BBoxes. Merge continuation tables by column identity, line sequence and arithmetic checks. Do not collapse repeated labels from different invoices.
8. Create zero or more `transactions[]` for each document, each with independent validation and state. Run business schema validation, calculated total/tax rules, duplicate **candidate** detection, and provenance checks.
9. Show exception-first review UI. Provide split, merge, page/region reassignment and field correction; recalculate only affected documents and invalidate stale evidence/validation. Never silently overwrite human-reviewed fields.
10. Export whole batch or only eligible per-transaction JSON, with stable idempotency identifiers. The IDP does not itself create ERP postings. The ERP owns master-data matching, period rules, approval, duplicate posting controls and commit transactionality.

### Recommended orchestration rules

- Upload size, page count and provider request sizes are explicit configurable limits, not hardcoded to a 30-page browser render ceiling.
- For 100-page documents avoid sending the full PDF to a model in one enormous prompt; use windowed page classification, grouped document extraction, bounded concurrency and recomposable checkpoints.
- The page registry stays complete even when a provider fails. A model's response must never be trusted to declare that it processed all 100 pages.
- Rescans must use idempotent job/revision identifiers and leave approved records unchanged until explicit invalidation/reapproval.
- Every merge/split must be versioned; downstream entity references require migration or invalidation.

## 6. Validation layers

**Layer 1 — Draft 2020-12 structural validation:** types, enums, required fields, field patterns, lower bounds, individual object shape.

**Layer 2 — referential integrity:** unique IDs, known file/document/transaction/region/evidence IDs, exact reverse links, evidence page/document membership.

**Layer 3 — coverage and geometry:** every page present, unassigned reason required, coordinates within bounds, overlapping region review; optionally all meaningful visible content allocated to some region.

**Layer 4 — business schema:** resolve each document schema version; validate amount precision, ISO dates and currency, mandatory business fields, line-item structure, cross-line totals, taxes and document-specific rules. `data` intentionally remains extensible at the universal envelope layer; release type-specific schemas separately.

**Layer 5 — workflow/export:** no open blocking issue on source path, confirmed boundaries, required approvals, immutable revisions, and no unresolved duplicate posting risk.

**Layer 6 — security and privacy:** authorized access to original files, no raw secrets embedded in exported JSON, redaction and retention controls, tenant/company isolation; BYOK must disclose which external provider receives a document. GitHub Pages static hosting is not a safe secret vault.

`validate.py` implements Layers 1 and much of Layers 2/3/5 as a **reference checker**, not a full financial/compliance validator. Its current scope does *not* include shape-overlap geometry, complete pointer resolution, duplicate-business-key detection, semantic line-item arithmetic, authorized reviewer permissions, or tenant-specific policies. Implement those before production ERP acceptance.

## 7. Business type schemas (recommended additional files)

Do not use a single global `data` whitelist for all transactions. Resolve type-specific schema IDs such as `erp.purchase_invoice@1.0.0`, `erp.sales_invoice@1.0.0`, `erp.purchase_order@1.0.0`, `erp.bank_receipt@1.0.0`.

Recommended common business field patterns:

- `document_no`: text identifier, not numeric to preserve leading zeros.
- `document_date`: `YYYY-MM-DD`, with explicit locale conversion where ambiguous.
- `currency`: ISO 4217 uppercase code.
- `total_amount`: decimal string, preserving numeric precision and negatives when supported.
- `line_items[]`: line ID/number, description, quantity decimal, unit price decimal, line amount decimal, tax and source references.
- Party identifiers: names plus separate optional registration/tax IDs; do not use a name alone as globally unique party key.
- `references[]`: related PO, invoice, receipt or shipment identifiers, preserving business relationships without conflating document identity.

If an ERP accepts numeric JSON amounts, generate a **separate ERP adapter payload** with a documented precision policy. Do not compromise the canonical IDP extraction contract to match one ERP's quirks.

## 8. Critical edge cases and expected tests

| Test | Setup | Expected result |
|---|---|---|
| E01 | Single PDF of 100 pages, 20 independent invoices | 20 `documents`, 20 `transactions`, no missing pages |
| E02 | One 100-page invoice | One document, one transaction, 100 page refs |
| E03 | Invoice A pages 1–3 and 50 | One document with non-contiguous refs |
| E04 | Invoice and receipt sharing page 2 | Two document regions referencing page 2; two transactions |
| E05 | One statement, 30 payment entries | One document, 30 transactions |
| E06 | Page 42 fails OCR | Page 42 retained; issue and export block where appropriate |
| E07 | Same invoice number on two different vendors | Two separate docs; duplicates evaluated with scoped business key |
| E08 | Same supplier/invoice/date uploaded twice | Duplicate candidate flagged; no automatic destructive deduplication |
| E09 | Ambiguous page boundary | `needs_review` plus blocker, no blind export |
| E10 | 3-page line-item table continues across pages | Merge rows with source evidence retained |
| E11 | Reassign page 50 from A to B | Recompute grouping, invalidate affected extraction, audit old/new revisions |
| E12 | Blank terms page | Page remains present and assigned/unassigned explicitly |
| E13 | Two docs share a full-page bounding box | Detect overlapping geometry and request review |
| E14 | Tenant A source to tenant B template | Must be denied by authorization boundary |
| E15 | Corrected field is re-extracted | Preserve human approved value until authorized reapproval |
| E16 | Batch has 3 pending reviews | Only eligible transactions may export; no claim of full-batch approval |
| E17 | Invalid field evidence page pointer | Reject referential validation |
| E18 | JSON-valid but totals inconsistent | Fail business validation; do not export |
| E19 | Network failure mid-run | Durable checkpoint and retry without duplicating transactions |
| E20 | Same PDF contains invoice + credit note + PO | Separate type-specific schemas and validation for each |

## 9. API/export contract

- Batch endpoint / exported file: the complete envelope in `batch-v2.0.0.schema.json`.
- Transaction-level export: derive a separate explicit `erp_export_v1` envelope including `transaction_id`, `document_id`, `source_file_id`, `source_hash`, `approved_revision`, `type_schema_id/version`, `data` and idempotency key.
- Do not assume a file is an ERP transaction. The original source is immutable and referentially linked.
- Retain schema version in all stored snapshots. A major version upgrade requires an explicit migration and tests; never rewrite old snapshots without an audit trail.
- Avoid leaking raw PDF page content into audit logs or error telemetry.

## 10. User-interface requirements

- Home: single giant drag/drop target, recent uploads and upload errors only.
- Processing screen: page coverage indicator, transaction count, classification progress and failed page list.
- Workspace: left document/transaction tree, center original page viewer with region boxes, right normalized field editor and JSON/evidence tab.
- Boundary Review: drag pages between document groups, draw/resize sub-page regions, merge/split groups, see proposed versus confirmed assignments; non-contiguous assignments supported.
- Exception queue: prioritize blocker and low-confidence high-impact fields. Confidence is advisory; validation failures override it.
- Export screen: filter only eligible transactions, show exact count, schema version and approval provenance. Never imply export posted to ERP.

## 11. Execution

```bash
python -m pip install 'jsonschema>=4.18,<5'
python validate.py sample-100-pages-20-transactions.json
python validate.py sample-100-pages-22-transactions-edge-cases.json
python validate.py sample-two-documents-one-page.json
```

All examples were validated by Draft 2020-12 and the included reference checker. Runtime generated sample files do not represent a tested complete IDP web application, OCR engine, ERP connector or production authorization system.

## 12. Adoption and migration plan

1. Freeze existing v1 stored extraction snapshots and collect actual type keys / legacy IndexedDB state; keep read-only migration compatibility.
2. Add envelope entities and two-phase extraction: page manifest → grouped document extraction.
3. Add explicit type-schema registry with tests for current ERP six document types.
4. Add boundary review + BBox multi-region support, including evidence lineage and revision invalidation.
5. Add business validators and complete export gating; regression test examples and adversarial PDFs.
6. Roll out feature-flagged v2 storage; ensure v1 read/export adapter does not conflate an entire PDF with one transaction.
7. Only after approval, implement optional ERP adapters and server-side ingestion in a separate authorized system.

## 13. Standards and sources

- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- OASIS UBL 2.1 concepts: https://docs.oasis-open.org/ubl/UBL-2.1.html
- ISO 8601 (date/time representation), ISO 4217 (currency codes), RFC 3339 timestamps, RFC 6901 JSON Pointer.

**Design note:** this specification uses an example placeholder schema `$id` under `schemas.example.invalid`; change to the stable canonical published URI in the actual repository before production release. No live GitHub repository files were changed by this deliverable.
