# Local data model

The application stores the **2.0.0 Batch contract**. Existing upload callers produce one logical document and transaction; the windowed library API produces one document and transaction per extracted segment. The original file is immutable, SHA-256 hashed, and stored under `file_id` in IndexedDB.

## Coverage and extraction

The renderer reads the complete physical page manifest before calling the provider. `maxPages` defaults to 20 and is clamped to 1–500. Only that prefix is sent. Remaining pages retain `pending` status and `review_pending` attribution, with one batch-level blocking `PAGE_LIMIT_EXCEEDED` issue. Model claims of complete processing or approval are ignored. PDF views and evidence use unrotated top-left coordinates.

Demo requests allow only `model`, `input`, `stream`, `store`, `instructions`, `tools`, `tool_choice`, and `parallel_tool_calls`, forcing `store:false` on every agent turn. Token limits and other unlisted controls are dropped; BYOK payloads are unchanged. See [agent architecture](ARCHITECTURE-AGENT.md) for tool budgets and image forwarding.

Amounts, prices, totals and quantities are decimal strings (up to six fractional digits). Reconciliation uses the shared fixed-precision decimal helpers, with their default 0.01 tolerance. Invalid decimal text is preserved for correction and reported as `INVALID_DECIMAL` (error). Required values, real ISO dates, ISO currencies and totals mismatches produce blocking issues. Confidence below 0.85 produces an evidence warning; no bounding box produces an informational issue, not fabricated evidence.

Targeted extraction retains only selected profile keys. Generic row cells are stored as ordinary values in `data.line_items`, with separate pointer-addressed evidence. Header-only profiles omit rows. Optional transaction `required_fields` (JSON pointers) and `field_types` (pointer-to-type map) preserve profile requirements and types across issue recomputation and correction; they are not business data. Amount/quantity fields normalize to decimal strings, integer fields to safe integers, and dates to ISO dates. Missing required values remain null and create blocking `MISSING_REQUIRED` issues. Auto transactions omit this metadata and retain standard document rules.

The windowed library uses sequential ten-page segmentation windows with one-page overlap, then sequential extraction of each document (chunks of at most twelve pages). Files of ten pages or fewer skip segmentation. `SegmentPlan` and `SegmentResult[]` are JSON-serialisable persistence sidecars; completed windows and results are reused on retry. Segment page numbers and evidence remain absolute. Each extracted segment gets `d_n`, `t_n` and `r_d_n_<page>` identifiers. Unprocessed pages remain pending with an explanation; failed pages are error/review_pending and create blocking `PAGES_FAILED`. Missing segmentation decisions retain unknown attribution. Boundary confidence below 0.7 creates a needs_review document and blocking `BOUNDARY_UNCERTAIN`. Header values come from the first extraction chunk, rows concatenate in page order. One document containing multiple transactions remains a known unsupported split: each segment yields exactly one transaction.

Retry re-segments failed windows and retries failed extraction segments. Successful outputs survive only when their complete ordered page list still matches a stitched segment; changed boundaries invalidate stale results. Partial progress batches are structurally and referentially valid even before any document is extracted. `buildBatch` delegates to `buildBatchFromSegments` with the existing rendered prefix as one segment, preserving the single-document contract.


### Extraction modes and profile snapshots

Home defaults to Auto (AI decides). Targeted sends a selected profile's header fields and repeating row columns. User profiles and the selected mode are stored in `idp-studio.profiles.v1` and `idp-studio.mode.v1` in localStorage. Builtins are read-only; duplication creates an independent user profile.

Before extraction, `idp-studio.batch-modes.v1` records the used mode and a deep-copied profile keyed by batch id. Retry reads this snapshot, not the current Home selection or edited/deleted profile. This sidecar leaves the strict v2 envelope and IndexedDB schema unchanged. Workspace labels use the same snapshot; full evidence JSON remains the unmodified envelope. Targeted clean JSON exports transaction data without Auto's extra `document_type` wrapper. Clear all local data removes profiles, mode and snapshots. Blocked storage retains settings and snapshots for this session only.

## Review and export

`correctField` returns a new batch, increments revisions, records a local-user review and marks existing evidence as human-corrected without changing its geometry. Corrections invalidate prior approval. `recomputeIssues` resolves obsolete issues and retains resolved/waived history; recurring conditions append new issues. `approveTransaction` refuses open blockers and records explicit human approval. Batch/document statuses and advisory validation are recomputed. Workspace JSON provides clean business data or the complete batch; export and copy are disabled for ineligible transactions. Evidence boxes remain read-only.

## Storage and legacy data

IndexedDB version 2 adds `batches`, keyed by the nested `batch_id`, with values `{ batch, createdAt }`. Existing `documents` and `files` stores are retained. Legacy document rows are read-only; deleting a batch does not delete original files or legacy rows.

Startup migration is idempotent by `legacy_<id>`. It hashes original bytes, reads PDF/image dimensions and writes a new batch and file-id-keyed blob. Missing originals are skipped. If dimensions cannot be read, 595×842 fallback dimensions are disclosed in an info issue; page count uses PDF metadata when available, otherwise the saved count. Pages beyond the saved rendered-page count remain pending. Legacy `receipt`/`other` become `unknown` with `LEGACY_TYPE_UNMAPPED` warnings. Field-edit audit entries become reviews. Explicit legacy human approval is retained with a `legacy_user` approval review, but current blockers still prevent export.

The v2 media enum does not include WebP: new uploads accept PDF/PNG/JPEG only. Unsupported legacy media are preserved and counted as skipped, never relabeled as another format. TIFF upload remains out of scope. Settings > Data displays migration counts for the current startup.
