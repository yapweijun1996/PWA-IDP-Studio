# Real-browser E2E

## Running

Requires Node 23+ (global `WebSocket` and `fetch`), installed project dependencies,
and Google Chrome. No additional npm dependencies are installed or imported by
the harness. Default executable:
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
Override with `CHROME_PATH` (an executable path, not a command string).

```sh
npm run e2e
npm run e2e -- --only=review-flow
npm run e2e -- --base-url=https://yapweijun1996.github.io/PWA-IDP-Studio/
npm run e2e:live
```

The local runner invokes the existing Vite binary directly with
`IDP_BUILD_ID=e2e-1`, builds `dist/`, and serves that directory under
`/PWA-IDP-Studio/` on an ephemeral IPv4 loopback port. It does not invoke the
package build/prebuild scripts or type checking. The update scenario builds
`e2e-2` into a separate temporary directory and switches the server root without
changing the origin. Normal builds still use the git SHA unless `IDP_BUILD_ID`
is provided.

Scenarios run sequentially in separate Chrome processes with fresh temporary
profiles. The runner closes Chrome and removes profiles and the temporary build
on normal completion and handled interruption. It leaves the normal `dist/`
build and diagnostic artifacts. A failed assertion never causes a scenario retry.
Only a typed CDP transport disconnect/command timeout gets one retry, using a
fresh profile. A retried success is PASS annotated FLAKY. More than one flaky
scenario fails the entire run. A CDP command is retried once only when its error
contains `Execution context was destroyed`. Rendering, uploads and SW activation
use bounded condition polling, not unconditional sleeps.

Every page attachment enables CDP focus emulation so programmatic `.focus()`
dispatches real focus events even when headless Chrome lacks OS window focus.
The rail tooltip is checked independently on focus and mouse hover.

The service worker uses prompt mode without `clientsClaim`: first visit installs,
the next load is controlled. Offline and update scenarios wait for
`navigator.serviceWorker.ready`, reload once, then require a non-null controller.
The update scenario keeps build A open for a three-second navigation-stability
window after the prompt appears before accepting the update.

Offline contract: once cached, the app shell and stored documents remain available offline, including review, editing, approval and export of stored batches (subject to existing validation gates). Uploads and AI extraction require a connection: each offline drop is refused before storage or processing, with no batch creation, provider request or queue. Home shows a persistent warning that clears when the connection returns or a subsequent upload succeeds.

## Scenario assertions

| Scenario | Assertions |
| --- | --- |
| `shell` | Upload Documents and gateway disclosure; exact nine-item navigation order; four actual routes; nine enabled links with the nine hrefs and no disabled items; expanded sidebar; footer version/build `e2e-1`; no console errors or uncaught page errors. |
| `templates` | Exact Templates h1 route readiness; locked built-ins and standards reference; phone/desktop overflow, including the editor; header/row profile creation and editing; built-in duplication; single-profile and all-custom versioned Blob JSON export (capture restored afterward); conflict cancellation and import as copy; next-upload Targeted selection and actual header/row extraction matching the existing targeted mock's keys; cancelled and confirmed deletion; Settings link card without the inline editor. |
| `upload-demo` | In-page canvas PNG dropped through DataTransfer; real extraction and workspace; input_image and demo Bearer token; no BYOK fixture key; Home lists batch and all three stat cards show 1; table opens workspace. |
| `review-flow` | Invalid date and mismatched totals block approval with visible reason; readable Issues title; date correction resolves its issue but leaves totals blocking; total correction enables approval; Approved status; Clean/Full JSON differ; v2 envelope keys and references, correction/approval reviews and revision increments; selecting date highlights read-only evidence on page 1; no draw/move/resize control. |
| `validation` | Default and targeted missing-required uploads; Workspace Full JSON issues match stored issues; exact `Validation` h1 route target; cross-batch severity counts and export eligibility; batch/rule filters and transaction links; short-reason refusal; low-confidence reason waiver and persisted review link; waiver survives revalidate-all; audited reopen; missing-required waiver prohibition; revalidate all and retained issue status; catalog search/details; desktop and phone overflow in light/dark. |
| `repair-turn` | First invalid response is repaired by a second request; two invalid responses give a visible error Notice and failed batch with no fabricated transactions. |
| `byok` | OpenAI settings use a synthetic key only in api.openai.com Authorization, never URL/body; key absent from all IndexedDB stores after reload (localStorage persistence is intentionally allowed); missing key gives actionable message and no request; second provider OpenRouter receives mocked 429 and fails without fabricated data. |
| `page-limit` | Generated 25-page PDF with limit 12; first 12 classified, last 13 pending, blocking PAGE_LIMIT_EXCEEDED, approval/download disabled. Raise limit to 25 and retry the same batch without re-upload. |
| `windowed-multi-doc` | Generated 30-page PDF, six five-page documents, uncertain boundary at page 11, extraction failure for pages 16–20. Reload and Retry make exactly three two-page-or-smaller extraction calls for the failed document. Full page coverage, absolute evidence and document-scoped approval/export blockers. |
| `label-studio` | Windowed 30-page upload; confirm uncertain boundary, split later pages into a document with empty blocked data, merge two documents without losing transactions, assign failed pages, confirm revised boundaries; persisted reviews and valid coverage after edits; split export stays blocked until required data is filled in Workspace. Desktop (1440px) and phone (390px) viewport overflow checks before/after edits and with review dialogs open. |
| `demo-six-page-document` | Six-page demo document: two segmentation windows, three two-page extraction chunks, one document with first-chunk headers and three merged rows. |
| `migration` | Before first app load, seed actual v1 documents/files database with legacy envelope and PNG blob on an empty same-origin resource; app upgrades and lists legacy batch; second startup does not duplicate it; original document/blob rows remain. |
| `theme-sidebar` | Light default; Dark survives reload; System follows live light/dark emulation changes; collapsed sidebar survives reload; rail tooltip opens independently on focus and hover. |
| `mobile` | Phone touch/UA, 390×844; Home, Documents, Review Queue, real workspace, Settings and Design system have no horizontal overflow; drawer opens; Tab/Shift-Tab wrap; Escape closes and restores trigger focus. |
| `offline` | Active/controlling SW; stored upload; CDP offline reload renders shell and Offline pill; stored transaction opens; dispatch-only offline drop shows an explanation, sends no provider request and leaves IndexedDB batch count unchanged; CDP online recovery shows Online pill, processes a new upload and clears the offline Notice on Home. |
| `sw-update` | Active build A; switch server to build B; update prompt without automatic navigation; Update now produces updating-loader text before unload; exactly one navigation and build B footer; worker settles without another pending update. |
| `settings-updates` | Current version check, waiting update discovered from Settings, no automatic activation, explicit update produces exactly one navigation. |
| `top-bar-scroll` / `top-bar-scroll-mobile` | Desktop and phone Design system scrolling hides/reveals the sticky top bar by transform; near-top visibility; scroll-to-top appears after one viewport, clears the toast, is absent at the top, and returns to the top when clicked. Reduced motion removes the header transition and makes scroll-to-top immediate. |
| `unknown-route-update` | Unknown route without an update renders Page not found; route-owned update check discovers build B without a test-side update call; shared explicit prompt activates only on Update now and navigates exactly once; Home/Documents recovery. |
| `install-integrity` | Mixed worker/build-info deployment rejects the candidate, preserves active build A and its caches, and shows no prompt; consistent build B is discovered on retry; precache keys are query-free. |
| `search-docs` | Two real uploaded batches; filename search and clear on Home/Documents; ascending/descending Documents sort with aria-sort and actual row order; delete dialog preserves data before confirmation and after Cancel; confirm deletes only chosen upload. |

All local scenarios also reject uncaught page exceptions and `console.error`.
CDP Log entries, including intentional HTTP 429 resource errors, are retained in
artifacts but are not treated as JavaScript console calls. The suite asserts
observable behavior; it does not import app code, expose new production hooks,
or patch the extraction/storage implementation.

The `route` helper matches an exact `h1`, not arbitrary body text. Validation's
route heading is `Validation`; `Export eligibility` is a subsection (`h2`) and
must be checked separately with `text`. Waiting for that subsection as an `h1`
never succeeds, even when the page mounts correctly. Revalidation checks also
wait for the action to be enabled again before inspecting persisted batches.

The Full JSON checks are deliberately a bounded contract smoke, not a second
implementation of the entire AJV/reference validator. They check required
keys, schema version, page count, document/evidence references and review history.

## Network isolation and mocks

CDP Fetch interception is enabled before application navigation, matching every
page request rather than just provider endpoints. Local runs continue only
requests to the server's loopback origin. These four provider hosts are
intercepted and fulfilled, never continued onto the network:

- `gpt.yapweijun1996.com`
- `api.openai.com`
- `openrouter.ai`
- `generativelanguage.googleapis.com`

Other HTTP(S) destinations are blocked and recorded as run-failing violations.
Unknown provider endpoints are also failures, not synthetic success. Chrome's
background networking, extensions, sync and component updating are disabled.
The app's worker precache is same-origin; provider calls originate in the page.
This is application-request isolation, not an operating-system network sandbox.

Mocks support CORS OPTIONS, demo session 201 with short-lived synthetic token,
and Responses SSE events: response.created, output_item.added,
content_part.added, output_text.delta/done, content_part.done,
output_item.done and response.completed with usage. Fixtures cover valid
purchase invoice, non-ISO date with totals mismatch, invalid-then-valid repair,
two invalid replies, and HTTP 429. Every intercepted provider request records
URL, method, headers and body in memory for assertions. Only the fake token/key
are used; no environment credentials are loaded. Raw request bodies/headers
are not printed or saved. Artifact text redacts Bearer tokens and key patterns;
password controls are hidden before screenshots.

## Read-only deployed subset

`--base-url` normalizes the trailing slash, skips building/serving locally and
runs `live-read-only`. It never uploads, seeds IndexedDB, changes settings or
types credentials. It checks Home, disclosure/navigation/footer, a fetched
manifest, active SW registration, Design system, no console/page errors, and
horizontal overflow on phone/tablet/desktop Home and phone/desktop Design.
The deployed build ID need not equal the local deterministic fixture ID.

Only GET/HEAD requests to the supplied origin are allowed through. Provider
calls, cross-origin destinations and same-origin mutations are blocked and fail
the run. No live gateway draft is sent. All local scenarios are reported
SKIP with an explicit live-mode reason. `--only=live-read-only` is supported
with `--base-url`; local mode accepts any registered local scenario name.
Unknown names/options fail instead of silently running no tests.

## Diagnostics and verification status

Summary output contains PASS/FAIL/SKIP, reasons, flaky annotation and artifact
path. Exit status is 1 for any failure or more than one flaky scenario.
`artifacts/e2e/<timestamp>/report.json` is always written when reporting succeeds.
Each failed attempt saves `screenshot.png`, `dom.txt` (HTML and visible text),
`console.json`, and `failure.txt` with a stack. Artifact capture errors are
recorded without replacing the original scenario error. Capture can be partial
when the CDP socket or Chrome process has already died.

No local scenario is pre-skipped for an application bug. A missing required
behavior is an assertion failure; production sources are outside this task's
edit scope. The suite observes the visible updating loader before reload,
without inventing an overlay hook. The no-loop check covers worker settlement
and a two-second condition-polled navigation stability window, not an unbounded
observation of future scheduled navigations.

Post-B3 selector audit: checked scenario/helper selectors against `src/ui/**`
and `src/ds/**`. The sidebar reason now resolves `aria-describedby` with
`getElementById` (IDs include route punctuation), independently of badge text
and visibility. The single-row stats layout retains the `dl`/`dt`/`dd` contract;
the remaining route, field, table, tab, evidence, menu, drawer and tooltip
selectors still match their components.

Shell-repair verification: `scripts/e2e/scenarios/index.mjs` passes
`node --check`. The full runner was launched directly through Node without a
shell, but this tool runtime denied writes to `node_modules/.vite-temp` and
`artifacts/e2e` with `EPERM` before browser scenarios ran. A separate shell
scenario smoke against the existing `dist/` was also attempted without a build;
the runtime denied the loopback server's `listen` with `EPERM`. No new browser
passes are claimed.

The demo gateway mock counts every `input_image` in the complete request input, including `function_call_output` parts, rejects more than four with HTTP 400 `DEMO_IMAGE_COUNT_EXCEEDED`, and asserts that no app request exceeded four images. Demo uses four-page segmentation windows with one-page overlap and two-page extraction chunks.

## Install integrity and CDN propagation

The worker is built with `injectManifest`. `build-info.json` contains the same
build ID as the footer and is excluded from the precache. Install first fetches
this identity with `?v=<BUILD>` and `cache: 'reload'`. Network/HTTP failures,
invalid JSON, missing identity and mismatched build IDs reject installation.
Only the candidate cache is deleted; the active worker and its cache keep
serving. A later update check retries the rejected worker.

Workbox's normal revision URLs are not the deployment identity check. This
worker uses null revisions for canonical query-free cache keys, a build-scoped
cache with a per-build-invocation suffix, and a fetch plugin that adds
`?v=<BUILD>` and forces reload for every precache request. Cache lookups ignore
query parameters. The identity request always uses the network, never the
worker's precache. Candidate caches are isolated even when rebuilding the same
git SHA. Obsolete shell caches are removed only after successful activation.

GitHub Pages can expose mixed deployment files during its approximately
10-minute CDN propagation window. A rejected update is intentional: keep using
the active version and check again after propagation. Startup and visible-tab
checks use the existing approximately 10-minute throttle; Settings and unknown
routes request a check without that automatic-check throttle. No check activates
a waiting worker. Update now retains the loader and single-reload lifecycle.

AppShell scrolls with the document, not an overflow workspace. Its top bar
uses cumulative 8px direction changes, remains visible within 48px of the top,
and stays visible for focused top-bar controls, the mobile drawer and DS
dialogs/menus/popovers. Reduced motion disables the transform transition and
smooth scroll-to-top. The top safe-area surface uses the theme's opaque
`--topbar` color. Scroll-to-top clears the measured toast/update prompt bounds.

These additions require the wrapper's typecheck, unit, SSOT, icon, build and
real-Chrome runs. No passing verification result is recorded here.
