# Design system

Import components from `src/ds`. Styles are loaded once by `src/main.tsx`: `tokens.css` defines values, `components.css` defines components. The existing `src/ui/Icon.tsx` remains the only SVG implementation. No catalog changes or new icons.

Visit `#/design` for the interactive inventory (also linked from Settings > About). Home, Documents, Review Queue, Workspace and Settings use the DS shell and components. Navigation is configured once in `src/ui/nav.ts`; unavailable features are disabled, with reasons.

Home uses `batchSummary` totals and reports physical-page coverage separately. Documents sorts before pagination using controlled DataTable sorting. Review Queue and its badge share the same exception-first transaction selector. Workspace supports transaction selection, required-reason corrections and explicit human approval. Clean JSON contains business data; Full evidence JSON contains the complete batch. Copy/export require current validation and transaction eligibility; pending pages remain blocking. See [Local data model](DATA-MODEL.md).

Home's Extraction mode Segmented chooses Auto or Targeted. Templates owns the extraction profile library: locked built-ins, custom editing, duplication, confirmed deletion, type badges and required marks, next-upload selection, and versioned JSON import/export with explicit rename-as-copy conflicts. The reused ProfileEditor Dialog separates header and row fields. Settings links to Templates. The reference table uses REQUIRED_FIELDS and the shared Auto key lists. Workspace labels and retries use immutable batch profile snapshots.

Templates has a `Templates` page h1 and an `Extraction profiles` library h2. Profiles load synchronously from browser/session storage, independently of document loading. The library explains the no-custom-profiles state and reports malformed/unreadable files and successful or empty imports with Notices. Each profile lists header fields and row columns separately, with type badges and required marks. Export downloads one profile (including a built-in) or all custom profiles as JSON; all-custom export is disabled until a custom profile exists. Cancel or Escape dismisses editing, pending imports and deletion without changing persisted profiles. Use for next upload saves Targeted mode and navigates Home. The read-only standards reference does not alter a profile or extraction mode.

Label Studio (`#/label-studio`) uses the existing Card, Checkbox, Badge, Select, Button, Dialog and Notice components. It defaults to the newest batch with open boundary/page issues, otherwise the newest batch. Documents show file-qualified page ranges, boundary status, transaction and blocking-issue counts, matching owner colours/labels and Workspace links. Native checkboxes support independent document/page multi-selection; select one document and the first later page for Split here. Every action requires an audit reason in a focus-trapped Dialog and reports persisted document/page/review counts after refreshing.

Approved-transaction documents are read-only, including when their pages are selected or they would be an assignment destination. Errors remain in the Dialog with the reason intact. The wrapping document rail/page grid uses DS tokens in both themes. Page thumbnails use IntersectionObserver, load the stored original only when visible, render at a 240-pixel maximum side, release rendered buffers and dispose the source, and drop the image on exit. Missing originals or unavailable rendering use numbered placeholders. No bounding-box editing controls are provided.

Label Studio uses a zero-minimum sheet track and document-rail track so intrinsic content cannot widen the viewport. Owner and issue badges wrap within their cards, including long generated document IDs; the action bar wraps independently. The label E2E checks both 1440px desktop and 390px phone widths before and after edits and with review dialogs open. Successful reviews keep the current batch selected even when resolving its final layout issue changes the default-batch ranking.

`src/ui/labelStudio.test.tsx`, imported by the existing behavior test entrypoint, covers reason gating, confirmation persistence/refresh, batch defaulting and post-review selection stability, approved locks, storage errors, split/merge/assignment and visible/off-screen thumbnail lifecycle. Layout contract tests cover the small fixture and the 100-page edge-case fixture, including unknown-document refusals and unchanged input on approved-document refusals.

Validation (`#/validation`) aggregates all stored batches: open severity counters, waived/resolved counts, per-rule affected batches, Workspace issue links and severity/rule/batch/status filters. Export readiness uses authoritative validation and transaction eligibility. The searchable rule catalog shares labels and waiver policy with contract rules. Waive/Reopen uses a reason Dialog (minimum ten trimmed characters); mandatory integrity and extraction issues show an explanation instead. Per-batch and all-batch revalidation persist refreshed issues and report before/after open counts plus integrity errors. Existing DS components provide all controls; no new reusable component.

Validation distinguishes loading from an empty local store and leaves storage failures visible without closing the review Dialog. Its scoped `ds-validation` grid uses a zero-minimum track so wide tables scroll inside their DS containers instead of widening the viewport; filter fields use the responsive DS grid. `src/ui/validation.test.tsx` covers cross-batch counters, filters, transaction links, catalog details, waiver persistence/reopening, per-batch versus all-batch revalidation, storage failures and empty/loading states.

## Theme and tokens

`ThemeProvider` / `useTheme()` expose `theme` and `setTheme('light' | 'dark' | 'system')`. Default is light. Choice is stored as `idp-studio.theme`; blocked storage is tolerated. System mode listens for OS changes. The resolved theme is applied to the document element. The topbar's opaque safe-area background uses `--topbar`.

Semantic tokens: `--background`, `--surface`, `--surface-alt`, `--text`, `--muted`, `--border`, `--focus`, `--primary`, `--primary-text`, `--info`, `--success`, `--warning`, `--danger`, `--selected`, `--hover`, `--disabled`, `--sidebar`, `--topbar`. Status colors are foregrounds on neutral surfaces, not backgrounds. Accent text uses primary on background/surface; primary buttons use primary-text on primary. Do not use arbitrary foreground/background combinations.

Layout: `--sidebar-expanded` 248px, `--sidebar-collapsed` 64px, `--topbar-height` 60px, `--workspace-padding` 24px/16px mobile, `--font-body` 14px, `--row-normal` 40px, `--row-compact` 32px, `--control-height` 40px/44px mobile. Scales: `--space-1` through `--space-8`, `--font-sm/body/lg/title`, `--radius-sm/md/lg/pill`, `--shadow-sm/lg`, `--z-sticky/popover/modal/toast`, `--icon-sm/md/lg`, `--motion-fast/spin`. Reduced motion makes motion durations zero.

The legacy UI stylesheet and its entrypoint import have been removed. Icon sizing, global box sizing, responsive search wrapping, page evidence and JSON overflow live in the DS stylesheet. Legacy token aliases remain unused for compatibility with the existing token contract.

## Components

| Component | Props and accessibility contract |
| --- | --- |
| Button | Native button props; `variant` primary/secondary/ghost/danger; `size` sm/md/lg; `loading` disables activation and sets aria-busy; `disabled`. Default type is button. |
| IconButton | Button props plus required `label`, `icon`; label supplies accessible name. |
| Badge / StatusPill | `tone` neutral/info/success/warning/danger, optional `icon`, required text children. Never convey status by color alone. |
| Card | HTMLElement attributes and children; section semantics. Supply heading or accessible label where appropriate. |
| StatCard | `icon`, `label`, `value`, optional `caption`; definition list associates label/value. |
| PageHeader | `title` h1, optional `breadcrumb`, `description`, `actions`; named breadcrumb navigation. |
| Field | `label`, optional `hint`/`error`, one input child; generates id, label association, describedby, invalid state. |
| Input | Native input props and forwarded ref; use Field or aria-label. |
| SearchInput | Controlled `value`, `onChange(string)`, optional `label`/`placeholder`; keyboard-accessible clear button. |
| Select | Native select props/children; caller must provide label or aria-label. |
| Checkbox | Native input props plus visible `label`; native checkbox keyboard behavior. |
| Segmented | `label`, `value`, `onChange(string)`, `options[{value,label,disabled?}]`; native radio inputs inside named radiogroup. |
| Tabs | `label`, `value`, `onChange(id)`, `items[{id,label,content,disabled?}]`; roving tabindex, arrows/Home/End, linked tab panels. |
| DataTable | `caption`, `columns[{key,label,render,sortValue?}]`, `rows`, `rowKey`; optional `onRowClick`, `selectedKey`, `density`, `loading`, `error`, `emptyMessage`. Optional controlled `sort` and `onSortChange` let consumers sort their entire result before pagination; uncontrolled sorting remains supported. Sticky header, aria-sort, stable client sorting, keyboard Enter/Space row activation; nested controls are not intercepted. Named scroll container; loading spinner plus decorative skeleton rows. |
| Pagination | One-based `page`, `pageCount`, `onChange(page)`; named nav, disabled bounds and announced page status. |
| Dialog | `open`, `onClose`, `title`, children; modal role, focus trap, Escape, outside backdrop, focus return, scroll lock; phone bottom sheet. |
| Menu / Popover | `label`, `items[{label,onSelect,disabled?}]`; action-menu role, arrow/Home/End navigation, Escape/Tab and outside-pointer dismissal. Popover shares Menu implementation. |
| Tooltip | `text`, focusable children; instant hover/focus display, Escape dismissal, anchored positioning. |
| Notice | `tone` info/warning/error, children; icon plus text, status or error alert. |
| Toast | children, optional region `label`; polite atomic live status region. Caller owns dismissal/lifetime. |
| Spinner | Optional `label`; visible loading text remains with reduced motion. |
| Progress | `label`, optional `value`, `max`; native progress; omitted value is indeterminate. |
| EmptyState | `title`, optional `description`, `icon`, `action`; visible explanation/action. |
| Dropzone | `onFiles(File[])`, `accept`, `multiple`, `hint`, `label`; chooser button and drag/drop use identical extension/MIME filtering. Rejections announced. Reports files only; never uploads. |
| OnlineStatus | Browser online/offline events and navigator.onLine; not a remote service health probe. |
| AppShell | `items`, children, optional `brand`, `search`, `right`, `footer`; owns drawer and document-scroll chrome. Hides Topbar after 8px downward movement, reveals upward, always visible within 48px and while topbar focus/drawer/dialog/menu/popover is active. |
| Topbar | `onMenuToggle`, optional `menuExpanded`, `brand`, `search`, `right`; sticky transform-based visibility controlled by AppShell, without layout jumps. An independent opaque `--topbar` safe-area surface remains visible in both themes; reduced motion removes the transition. |
| ScrollTopButton | `visible`; AppShell supplies visibility after one viewport of document scroll. Accessible “Scroll to top” IconButton with a 44px target, lower-right safe-area placement, measured toast clearance, smooth scrolling unless reduced motion. Absent from the DOM when hidden. |
| Sidebar | `items[{href,label,icon,active?,disabled?,reason?,count?}]`, optional `footer`, `mobileOpen`, `onMobileClose`, `onCollapsedChange`; optional `collapsed`/`onToggle` control the desktop rail. Desktop state stored at idp-studio.sidebar. Both rail widths expose toggle and aria-expanded. Named links/current page, disabled reasons, anchored rail tooltips. Phone drawer traps focus, locks scroll, closes on Escape and restores focus. |
| EvidenceViewer | `pages[{number,src?,pending?}]`, current `page`, `onPageChange`, optional normalized `boxes[{id,label,x,y,width,height}]`, `selected`, `error`. Previous/next, page thumbnails, bounded zoom and fit-width. Pending pages are explicit placeholders. Boxes are named read-only images, never editable; selected evidence is emphasized. Selecting a field/page reopens a collapsed viewer. Scroll stays inside the viewer. |

## Ratchet

`npm run check:ssot` scans production source files, excluding tests and generated icon paint. It compares each file/rule independently with `scripts/ssot-baseline.json`; new files have zero allowance. Do not increase allowances. When removing old violations, lower the committed baseline. CSS duplicate checking targets top-level single-class base definitions, including comma-separated groups and definitions across files; media/state/descendant overrides are intentionally allowed. `npm run check` runs typecheck, icon freshness, SSOT and tests. No dependencies are added.

Contrast tests read `tokens.css` directly through `node:fs`, bypassing Vitest's CSS stubs. Dialog and drawer focus candidates are normalized to DOM order so selector-engine grouping cannot change Tab wrap targets.

## Admin panel behavior

- Settings General clamps extraction limits to 1–500; page sizes 10/25/50 and Comfortable/Compact density persist under `idp-studio.tables`. Comfortable maps to `--row-normal`, Compact to `--row-compact`. Sidebar default affects the next shell mount; the shell toggle changes the current state.
- Storage adapters keep contract/library APIs unchanged. Upload deletion removes the batch and unshared originals. For migrated uploads it also deletes the matching legacy record and unshared legacy original, preventing startup migration from restoring the deleted upload; the dialog discloses this. Unrelated legacy rows and shared originals are retained. Clear-all removes all three IndexedDB stores and app-owned settings keys; confirmation describes reviews, credentials, originals and legacy data explicitly. Unrelated localStorage is untouched.
- `src/ui/admin.test.tsx` exercises real fixture totals, type/name search and clear, sorting across page boundaries, filters, exception ordering, disabled navigation, evidence/page selection, correction reasons and audit history, approval gating, humanized issues, JSON variants, page-limit clamping, density persistence, confirmed clear, shared-original deletion safety and viewer navigation/zoom. Imported through `src/ui/behavior.test.ts` for the existing test discovery pattern.
- Generic DS additions/bug fixes are covered by those behavioral cases: controlled sorting prevents page-local order errors; EvidenceViewer preserves normalized evidence while navigating physical pages; rejection notices use the shared Notice status semantics. Mobile search wraps instead of competing with the brand/status for a single narrow row. Table empty-state content sits outside the wide table so its explanation remains visible on phones; search tests cover empty-to-populated recovery.
- Home stats use the DS `--stat-card-min` grid token: all three cards fit in one row at container widths of 720px and above. Disabled navigation uses a single-row muted Coming soon badge and persistent accessible reason; rail focus/hover shows the anchored reason tooltip.
- Upload tables retain all seven columns. At desktop widths (1024px and above), fixed table layout wraps long filenames, dates, headings and status text without clipping pills; narrower screens retain the local scroller. Recent uploads exposes named Open icon buttons; Documents retains its Open/Delete menu.
- Workspace combines approval/export blockers into one counted notice linking to Issues. Viewer controls are one compact icon-button row; initial zoom and Fit width both size evidence to its pane. The component-sheet header relies on the shell's OnlineStatus rather than repeating it.

## JSON inspection

`JsonTree` accepts a JSON value, optional `onFocus(pointer, value)` and `expandTopLevel` (default false). The root starts open; `expandTopLevel` also opens its first 100 child containers once on mount, without expanding deeper containers. Pointers use RFC 6901 escaping; the root pointer is the empty string. Collapsed descendants are not mounted. Expanded collections reveal 100 children at a time; search navigation windows the matching collection rather than mounting every preceding element.

Tree rows use roving focus, `tree`/`treeitem`, levels and expansion state. Arrow keys navigate, Right/Left expand/collapse or move to children/parents, Enter toggles, Home/End select visible endpoints. Search is debounced 200 ms and walks in 500-node scheduled chunks, cancelling stale queries. Next/Previous expands ancestors and focuses the match, including keys containing quotes or control characters. Array windows do not allocate keys for the entire array. String/number/boolean/null tokens reuse success/info/warning/muted colours in both themes.

Copy pointer/value first attempts synchronous copying from a temporary selected textarea while user activation is available, then tries the Clipboard API with a one-second permission deadline. Success reports “Pointer copied.” or “Value copied.”; denial or an unanswered permission prompt reports failure and retains the exact requested text in a keyboard-focusable, wrapping manual-copy block. Full-envelope copying uses the same helper and manual fallback. Failed copies never claim success.

The ComponentSheet includes an interactive tree. JSON Explorer uses the same component for full envelopes, shared Workspace transaction exports, evidence, issues, reviews and advisory validation. Only the selected scope mounts a tree, with top-level containers initially expanded; selecting another batch, scope or transaction resets the tree. An empty Transaction scope has no tree, search or transaction selector and disables Download full JSON; the Full batch scope still permits inspection and download of the envelope. Full JSON copy remains available in every scope. Its validation card recomputes `validateBatch` independently of stored flags. The page never changes evidence, review state or IndexedDB.


## AI Agents

`AiAgents` uses existing DS Card, Field, Input, Checkbox, Select, Button, Notice, EmptyState and Toast components. Configuration saves explicitly; Reset to defaults persists defaults and announces through Toast. Tool sections show executable descriptions and TypeBox parameters without a second prose catalog. Provider limits are read-only. Run history has loading/error/empty states, an outcome filter, and inline details with timestamps, phase counts, a step timeline and document link. No editable evidence geometry or extracted payload is displayed in traces.
