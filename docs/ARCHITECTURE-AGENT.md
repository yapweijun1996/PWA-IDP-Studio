# Agent extraction engine

`runExtraction` uses the browser pi-agent-core harness with five tools. It uses `opts.blob` or loads the already-persisted immutable original by `file_id`, so existing upload/retry callers can use tools without UI changes. The initial rendered page images provide context; subsequent turns can read embedded text, re-render pages, zoom unclear regions, decode visible codes, and submit a result. A rejected `submit_result` returns compact validation feedback; a successful submission terminates the tool loop. The model never approves data. Auto providers without tool support may still return plain JSON, with one compatibility correction request within the same overall turn budget.

## Tools and limits

- `get_page_image(page, max_side?)`: original-page JPEG.
- `crop_zoom(page, ymin, xmin, ymax, xmax, scale?)`: true original PDF/image re-render, not thumbnail enlargement. Coordinates are full-page, unrotated top-left, 0–1000. Submitted evidence always remains in full-page coordinates.
- `read_text_layer(page, region?)`: embedded PDF text and full-page boxes; empty for image documents. Text output is capped at 12,000 characters with a truncation notice.
- `scan_codes(page, region?)`: lazy-loaded ZXing decoding of QR and 1D/2D barcodes, using the region/full page followed by four zoomed tiles. Results have format, text, and normalized full-page boxes. An injectable decoder supports deterministic tests. No code found is a normal result.
- `submit_result(json)`: validates both model output and the complete batch before acceptance. Missing required values become blocking review issues, not invented values.

Defaults: eight model turns and 120 seconds for the agent loop. Additional tool-image budgets come from `imageLimits(provider)` below, shared across rendering and code scanning. Initial context images are separate but count toward the gateway request cap. Output images never exceed 2000 pixels on either side. Page access is restricted to the trusted rendered prefix; unprocessed pages retain coverage blockers. Cancellation and timeout abort the harness and reject the caller even if an asynchronous tool stalls. Original-page resources are disposed when extraction ends. `pageSource`, `decoder`, and `streamFn` are injection seams, not production substitutes for original-file rendering.

PDF loading/worker configuration and rendering are shared by `pdf.ts` and `agent/pageSource.ts`. Cropping changes the render transform and render scale before rasterization. Image crops read directly from the original decoded bitmap.

## Modes and canonical output

Auto uses the existing document classification, header field array, and standard line-item shape. Targeted mode lists exact profile keys, labels, types, and required flags in the prompt. Headers use the same evidence-bearing array. Each generic row is keyed by the selected row columns; each input cell is `{value,page,bbox,confidence}`. Unknown header/row/top-level keys and duplicate headers are rejected. Missing selected fields become null. Header-only profiles do not emit `data.line_items`.

Amount/quantity values normalize to decimal strings; integers become safe integers; dates accept ISO YYYY-MM-DD or unambiguous YYYY/MM/DD and normalize to ISO. Invalid dates and malformed numbers require model correction. Bboxes remain unreviewed, read-only AI evidence.

The v2 transaction optionally stores `required_fields` (JSON pointers) and `field_types` (pointer-to-profile-type map), separate from business `data`. These preserve selected requirements/types across issue recomputation and human corrections without leaking profile metadata into exported business values. Auto transactions omit both properties and retain their existing business rules. Row evidence points into `/line_items/<index>/<key>`; generic row values remain schema-valid JSON records. Only the human review path can approve a transaction.

## Provider image forwarding and payloads

The installed pi-ai provider converters already forward tool-result images for every supported API:

- `openai-responses` (demo/OpenAI): `function_call_output.output` contains `input_text` and `input_image` parts.
- `openai-completions` (OpenRouter): the tool response carries text; pi-ai attaches images in a following user message with `image_url` parts.
- `google-generative-ai`: Gemini 3+ uses multimodal `functionResponse.parts`; older Gemini models receive a text function response followed by a separate user image message.

All configured models advertise image input. No additional engine-level image fallback is necessary: the completions and older-Gemini fallback is already implemented by pi-ai. This is based on the installed converters, not a claim of live provider verification.

Demo payloads allow only `model`, `input`, `stream`, `instructions`, `tools`, `tool_choice`, and `parallel_tool_calls`, with `store:false` forced. Token-limit controls, especially `max_output_tokens`, are dropped. BYOK payloads remain unchanged.

## Windowed library API

`App` routes every upload and retry through `runWindowedExtraction`, without eagerly rendering the whole file. `imageLimits(provider)` in `lib/providers.ts` is the single source of image budgets:

| Provider | Request images | Segmentation window | Extraction chunk | Additional tool images | Single-pass pages |
| --- | --- | --- | --- | --- | --- |
| Demo | 4 | 4 | 2 | 2 | 2 |
| OpenAI / OpenRouter / Gemini BYOK | No app-level cap | 10 | 10 | 12 | 10 |

Segmentation overlaps one page, adding three new pages per demo call. The demo gateway counts initial and replayed tool-result images in the entire request input and rejects more than four with `DEMO_IMAGE_COUNT_EXCEEDED`. BYOK request limits remain provider/model-specific; Infinity is not a provider guarantee. `BOUNDARY_MIN_CONFIDENCE` remains 0.7. Demo processing of 100 pages costs approximately 34 segmentation calls plus per-document extraction calls (one per two-page chunk), before repairs and tool turns.

Segmentation renders low-resolution images (640 pixels maximum side), supplies absolute page labels and up to 300 characters of native text per page, and allows one repair. Stitching uses the non-first-window decision for overlap pages. Missing decisions remain unassigned, and failed windows do not stop later windows. Each extracted document uses absolute evidence and a restricted PageSource. Every window/chunk releases images in a finally block, including partial renders and the single-pass branch: optional `PageSource.release(pages)` releases injected rendering resources, then base64 data and array references are cleared. The original source is disposed at completion only when owned by the orchestrator; injected sources remain caller-owned.

`SegmentPlan` contains `pageCount`, `windows`, `segments`, `unassigned` and `failed`. `SegmentResult` contains `pages`, `output` or null, and optional `error`. App atomically commits each progress batch and `{plan, results}` in IndexedDB version 3 (`batches` and `windowed`, keyed by batch id); large outputs never enter localStorage. Retry uses both sidecars and the stored mode/profile. Successful windows and exact-page-list results are reused; failed windows and failed or changed segments rerun. Raising the page limit retains complete windows and re-segments the former short final window. The complete manifest is retained, but only the first `maxPages` pages are rendered/segmented (default 100, clamp 1–500; stored limits respected). Progress reports phase-specific window/document counts and live agent steps. Cancel aborts the active call and returns a valid `review_required` partial batch with unfinished pages pending. Retry resumes it. Batch deletion and storage clearing remove sidecars.

`SegmentPlan.window` persists the segmentation size. A missing or changed size invalidates cached windows and results and forces re-segmentation, including plans stored before this property existed.

Long documents are extracted sequentially using the provider's extraction chunk size: headers come only from the first chunk, rows concatenate in page order with absolute evidence and adjusted row pointers. Later chunks are explicitly prompted not to repeat earlier data. Targeted validation already accepts absent required values as null, not submission errors; required-pointer metadata survives merging and `MISSING_REQUIRED` is judged on the final merged batch. Known limitation: each segment produces one transaction, including statements with several entries; intra-document transaction splitting is not implemented.

