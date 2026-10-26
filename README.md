# IDP Studio

Drop → Detect → Extract → Label → Review → Export JSON. Browser-first PWA (React + Vite + TypeScript), deployed to GitHub Pages.

- AI harness: `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` (browser). Providers: demo endpoint, OpenAI / OpenRouter / Gemini (BYOK).
- Files, results and keys stay in this browser (IndexedDB / localStorage). Pages are sent only to the provider chosen in Settings.
- BBoxes are drawn by the AI as read-only evidence; the canonical batch uses normalized `{x,y,width,height}` coordinates, origin top-left. Users correct values, never boxes.
- The demo endpoint only serves the published origin (`https://yapweijun1996.github.io`), so test it on the deployed site; local tests use `src/lib/fakeStream.ts`.
- Data uses the v2.0.0 Batch contract with decimal-string amounts, explicit issues and human reviews. All physical pages remain in the manifest; the configurable extraction limit defaults to 20 pages, and unprocessed pages block export.
- IndexedDB upgrades preserve legacy rows and migrate available originals once. See [Local data model](docs/DATA-MODEL.md) for migration, validation and export behavior.

```bash
npm ci && npm run dev      # local
npm run typecheck && npm test && npm run build
```

UI icons use the unchanged SVG sources in `icons/catalog/`. Run `npm run icons` to
validate the catalog and regenerate `src/ui/icons.generated.ts`; `npm run check:icons`
checks freshness without writing files and also runs automatically before builds.
Use the typed `Icon` component with `sm`, `md`, or `lg` CSS-token sizes. Icons are
decorative by default; pass `label` when an icon needs its own accessible name.

Supported uploads: PDF, PNG and JPG. TIFF and WebP are not supported. Label Studio, Templates, JSON Explorer, AI Agents and Validation are disabled navigation items with “Coming soon” explanations.

Offline contract: the cached app shell and stored documents remain available, including review, editing, approval and export of stored batches (subject to validation gates). Uploads and AI extraction require a connection. Offline uploads are refused before anything is stored or sent, are never queued, and show a persistent warning until reconnection or a successful upload.

## Design system

Visit `#/design` for the component inventory. Public APIs live in `src/ds/index.ts`;
theme/layout values in `src/ds/tokens.css`, component styles in
`src/ds/components.css`. See [UI component contracts](docs/UI-COMPONENTS.md).
`npm run check` runs types, icons, the per-file SSOT ratchet, and tests.
The task-first admin panel uses the design system throughout. Routes: `#/` (upload and recent batches), `#/documents` (search, sort, filter, paginate and delete), `#/review` (exception-first transaction queue), `#/doc/:batchId/:transactionId?` (read-only page evidence, field corrections, human approval and gated JSON exports), and `#/settings`. Settings > About links to `#/design`.

Search matches file names and document types on Home/Documents. Review counts come from live transactions, not sample data. Settings stores page size and Comfortable/Compact table density locally, alongside provider, page-limit and theme preferences. The shell persists its 248px/64px desktop sidebar and uses an accessible mobile drawer. Version comes from package.json; build ID is the short git SHA, or `dev` when git metadata is unavailable.

UI storage adapters live in `src/ui/storage.ts` because the library exposes neither clear-all nor file-aware deletion. Deleting an upload removes its batch and unshared originals; a migrated upload's matching legacy source is also removed so startup migration cannot recreate it. Originals referenced by other batches or unrelated legacy records remain. Clear all local data explicitly deletes batches, originals, legacy documents, reviews, credentials and app preferences, not provider-side or unrelated browser data.

`src/ui/behavior.test.ts` imports the JSX page scenarios because the existing Vitest include pattern discovers `.test.ts` files. The empty `src/ui/styles.css` is retained only because `src/main.tsx` imports it and is outside this change's permitted edit scope; all production UI rules are in the DS.

## Browser E2E

`npm run e2e` builds and tests the actual PWA in headless Chrome over CDP, without
additional npm dependencies (Node 23+ and installed Chrome required).
Use `npm run e2e -- --only=shell` for one scenario; `npm run e2e:live` runs only
read-only deployed-site checks, with all provider calls blocked.
Set `CHROME_PATH` for a non-default Chrome installation. Failures save screenshots,
DOM text and redacted logs under `artifacts/e2e/`. See [E2E guide](docs/E2E.md)
for scenario assertions, network safety, retry policy and limitations.
