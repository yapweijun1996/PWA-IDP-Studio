# Local data model

The application stores the **2.0.0 Batch contract**. One upload currently produces one logical document and one transaction; the envelope supports multiple documents and transactions. The original file is immutable, SHA-256 hashed, and stored under `file_id` in IndexedDB.

## Coverage and extraction

The renderer reads the complete physical page manifest before calling the provider. `maxPages` defaults to 20 and is clamped to 1–500. Only that prefix is sent. Remaining pages retain `pending` status and `review_pending` attribution, with one batch-level blocking `PAGE_LIMIT_EXCEEDED` issue. Model claims of complete processing or approval are ignored. PDF views and evidence use unrotated top-left coordinates.

Demo requests allow only `model`, `input`, `stream`, `store`, and `instructions`, forcing `store:false` on initial and repair turns because the shared gateway rejects token limits and other unlisted controls; BYOK payloads are unchanged.

Amounts, prices, totals and quantities are decimal strings (up to six fractional digits). Reconciliation uses the shared fixed-precision decimal helpers, with their default 0.01 tolerance. Invalid decimal text is preserved for correction and reported as `INVALID_DECIMAL` (error). Required values, real ISO dates, ISO currencies and totals mismatches produce blocking issues. Confidence below 0.85 produces an evidence warning; no bounding box produces an informational issue, not fabricated evidence.

## Review and export

`correctField` returns a new batch, increments revisions, records a local-user review and marks existing evidence as human-corrected without changing its geometry. Corrections invalidate prior approval. `recomputeIssues` resolves obsolete issues and retains resolved/waived history; recurring conditions append new issues. `approveTransaction` refuses open blockers and records explicit human approval. Batch/document statuses and advisory validation are recomputed. Workspace JSON provides clean business data or the complete batch; export and copy are disabled for ineligible transactions. Evidence boxes remain read-only.

## Storage and legacy data

IndexedDB version 2 adds `batches`, keyed by the nested `batch_id`, with values `{ batch, createdAt }`. Existing `documents` and `files` stores are retained. Legacy document rows are read-only; deleting a batch does not delete original files or legacy rows.

Startup migration is idempotent by `legacy_<id>`. It hashes original bytes, reads PDF/image dimensions and writes a new batch and file-id-keyed blob. Missing originals are skipped. If dimensions cannot be read, 595×842 fallback dimensions are disclosed in an info issue; page count uses PDF metadata when available, otherwise the saved count. Pages beyond the saved rendered-page count remain pending. Legacy `receipt`/`other` become `unknown` with `LEGACY_TYPE_UNMAPPED` warnings. Field-edit audit entries become reviews. Explicit legacy human approval is retained with a `legacy_user` approval review, but current blockers still prevent export.

The v2 media enum does not include WebP: new uploads accept PDF/PNG/JPEG only. Unsupported legacy media are preserved and counted as skipped, never relabeled as another format. TIFF upload remains out of scope. Settings > Data displays migration counts for the current startup.
