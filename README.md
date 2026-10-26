# IDP Studio

Drop → Detect → Extract → Label → Review → Export JSON. Browser-first PWA (React + Vite + TypeScript), deployed to GitHub Pages.

- AI harness: `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` (browser). Providers: demo endpoint, OpenAI / OpenRouter / Gemini (BYOK).
- Files, results and keys stay in this browser (IndexedDB / localStorage). Pages are sent only to the provider chosen in Settings.
- BBoxes are drawn by the AI as read-only evidence: envelope format `[x0,y0,x1,y1]`, normalized 0..1, origin top-left.
- The demo endpoint only serves the published origin (`https://yapweijun1996.github.io`), so test it on the deployed site; local tests use `src/lib/fakeStream.ts`.

```bash
npm ci && npm run dev      # local
npm run typecheck && npm test && npm run build
```

UI icons use the unchanged SVG sources in `icons/catalog/`. Run `npm run icons` to
validate the catalog and regenerate `src/ui/icons.generated.ts`; `npm run check:icons`
checks freshness without writing files and also runs automatically before builds.
Use the typed `Icon` component with `sm`, `md`, or `lg` CSS-token sizes. Icons are
decorative by default; pass `label` when an icon needs its own accessible name.

Out of scope for this slice: TIFF input, Review Queue, Label Studio, Templates, Audit Logs pages.

## Design system

Visit `#/design` for the component inventory. Public APIs live in `src/ds/index.ts`;
theme/layout values in `src/ds/tokens.css`, component styles in
`src/ds/components.css`. See [UI component contracts](docs/UI-COMPONENTS.md).
`npm run check` runs types, icons, the per-file SSOT ratchet, and tests.
Home and Workspace remain unchanged for the subsequent Admin Panel phase.
