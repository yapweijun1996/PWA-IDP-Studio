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

Out of scope for this slice: TIFF input, Review Queue, Label Studio, Templates, Audit Logs pages.
