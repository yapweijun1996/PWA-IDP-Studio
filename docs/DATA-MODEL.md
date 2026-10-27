# Local data model

The application stores the **2.0.0 Batch contract**. Uploads use windowed extraction: small files retain one logical document/transaction; larger files produce one document and transaction per extracted segment. The original file is immutable, SHA-256 hashed, and stored under `file_id` in IndexedDB.

## Coverage and extraction

The complete physical page manifest is read before extraction. `maxPages` defaults to 100, clamps to 1–500 and respects stored values. Only that prefix is rendered/segmented. Remaining pages retain `pending` status and `review_pending` attribution, with a batch-level blocking `PAGE_LIMIT_EXCEEDED` issue. Raising the limit and retrying expands the stored plan. Model claims of complete processing or approval are ignored. Evidence uses unrotated top-left coordinates.

Demo requests allow only `model`, `input`, `stream`, `store`, `instructions`, `tools`, `tool_choice`, and `parallel_tool_calls`, forcing `store:false` on every agent turn. Token limits and other unlisted controls are dropped; BYOK payloads are unchanged. See [agent architecture](ARCHITECTURE-AGENT.md) for tool budgets and image forwarding.

Amounts, prices, totals and quantities are decimal strings (up to six fractional digits). Reconciliation uses the shared fixed-precision decimal helpers, with their default 0.01 tolerance. Invalid decimal text is preserved for correction and reported as `INVALID_DECIMAL` (error). Required values, real ISO dates, ISO currencies and totals mismatches produce blocking issues. Confidence below 0.85 produces an evidence warning; no bounding box produces an informational issue, not fabricated evidence.

Targeted extraction retains only selected profile keys. Generic row cells are stored as ordinary values in `data.line_items`, with separate pointer-addressed evidence. Header-only profiles omit rows. Optional transaction `required_fields` (JSON pointers) and `field_types` (pointer-to-type map) preserve profile requirements and types across issue recomputation and correction; they are not business data. Amount/quantity fields normalize to decimal strings, integer fields to safe integers, and dates to ISO dates. Missing required values remain null and create blocking `MISSING_REQUIRED` issues. Auto transactions omit this metadata and retain standard document rules.

The windowed library takes image budgets from `imageLimits(provider)` in `lib/providers.ts`, with one-page segmentation overlap:

| Provider | Request cap | Window | Extraction chunk | Tool images | Single pass |
| --- | --- | --- | --- | --- | --- |
| Demo | 4 | 4 | 2 | 2 | 2 |
| OpenAI / OpenRouter / Gemini | No app-level cap | 10 | 10 | 12 | 10 |

Demo's request cap includes replayed tool-result images; actual BYOK provider/model limits still apply. Demo 100-page processing requires approximately 34 segmentation calls plus per-document extraction calls, with extra calls for repairs/tools.

`SegmentPlan.window` stores the segmentation size; missing or different sizes invalidate cached windows and results. `SegmentPlan` and `SegmentResult[]` remain JSON-serialisable persistence sidecars. Segment page numbers and evidence remain absolute. Each extracted segment gets `d_n`, `t_n` and `r_d_n_<page>` identifiers. Unprocessed pages remain pending; failures create blocking `PAGES_FAILED`, missing decisions retain unknown attribution, and boundary confidence below 0.7 creates blocking `BOUNDARY_UNCERTAIN`. Headers come only from the first chunk; rows concatenate with adjusted evidence/required pointers. Later chunks may omit required headers; required values are checked on the merged output, not rejected per chunk. Each segment yields exactly one transaction; intra-document splitting is unsupported.

Retry re-segments failed windows and retries failed extraction segments. Successful outputs survive only when their complete ordered page list still matches a stitched segment; changed boundaries invalidate stale results. Partial progress batches are structurally and referentially valid even before any document is extracted. `buildBatch` delegates to `buildBatchFromSegments` with the existing rendered prefix as one segment, preserving the single-document contract.


### Extraction modes and profile snapshots

Home defaults to Auto (AI decides). Targeted sends a selected profile's header fields and repeating row columns. User profiles and the selected mode are stored in `idp-studio.profiles.v1` and `idp-studio.mode.v1` in localStorage. Builtins are read-only; duplication creates an independent user profile.

Before extraction, `idp-studio.batch-modes.v1` records the used mode and a deep-copied profile keyed by batch id. Retry reads this snapshot, not the current Home selection or edited/deleted profile. This sidecar leaves the strict v2 envelope and IndexedDB schema unchanged. Workspace labels use the same snapshot; full evidence JSON remains the unmodified envelope. Targeted clean JSON exports transaction data without Auto's extra `document_type` wrapper. Clear all local data removes profiles, mode and snapshots. Blocked storage retains settings and snapshots for this session only.

## Review and export

`correctField` returns a new batch, increments revisions, records a local-user review and marks existing evidence as human-corrected without changing its geometry. Corrections invalidate prior approval. `recomputeIssues` resolves obsolete issues and retains resolved/waived history; recurring conditions append new issues. `approveTransaction` refuses open blockers and records explicit human approval. Batch/document statuses and advisory validation are recomputed. Workspace JSON provides clean business data or the complete batch; export and copy are disabled for ineligible transactions. Evidence boxes remain read-only.

## Storage and legacy data

IndexedDB version 4 retains `documents`, `files` and `batches` (`{ batch, createdAt }`, keyed by nested batch id), plus the v3 `windowed` store, keyed by batch id with `{ plan: SegmentPlan, results: SegmentResult[] }`, and adds `runs` (below). Progress atomically commits both batch and sidecar for crash/refresh recovery. Outputs never enter localStorage. Cancel stores a `review_required` partial batch; Retry reuses successful segments. Both batch deletion paths and storage clearing remove sidecars. UI deletion also removes unshared originals and matching legacy migration sources; low-level `deleteBatch` retains originals.

Startup migration is idempotent by `legacy_<id>`. It hashes original bytes, reads PDF/image dimensions and writes a new batch and file-id-keyed blob. Missing originals are skipped. If dimensions cannot be read, 595×842 fallback dimensions are disclosed in an info issue; page count uses PDF metadata when available, otherwise the saved count. Pages beyond the saved rendered-page count remain pending. Legacy `receipt`/`other` become `unknown` with `LEGACY_TYPE_UNMAPPED` warnings. Field-edit audit entries become reviews. Explicit legacy human approval is retained with a `legacy_user` approval review, but current blockers still prevent export.

The v2 media enum does not include WebP: new uploads accept PDF/PNG/JPEG only. Unsupported legacy media are preserved and counted as skipped, never relabeled as another format. TIFF upload remains out of scope. Settings > Data displays migration counts for the current startup.

### Run traces (IndexedDB v4)

The additive `runs` store is keyed by run `id`. Each row stores batch id, filename, provider/model, mode/profile name, started/ended epoch timestamps, segmentation-window and extracted/failed-document counts, outcome (`validated`, `review_required`, `failed`, `cancelled`), bounded steps `{at, tool, summary, ok}` and safe error text. Writes project allowed fields, replace tool summaries with payload-free status text, cap steps at 200, and atomically prune to the newest 50 runs. Both batch deletion paths remove matching runs; clear-all clears the store and `idp-studio.agent-config.v1`. The v3-to-v4 migration retains originals, batches and recovery sidecars.
