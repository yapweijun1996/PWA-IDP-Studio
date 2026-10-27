# Design system

Import components from `src/ds`. Styles are loaded once by `src/main.tsx`: `tokens.css` defines values, `components.css` defines components. The existing `src/ui/Icon.tsx` remains the only SVG implementation. No catalog changes or new icons.

Visit `#/design` for the interactive inventory (also linked from Settings > About). Home, Documents, Review Queue, Workspace and Settings use the DS shell and components. Navigation is configured once in `src/ui/nav.ts`; unavailable features are disabled, with reasons.

Home uses `batchSummary` totals and reports physical-page coverage separately. Documents sorts before pagination using controlled DataTable sorting. Review Queue and its badge share the same exception-first transaction selector. Workspace supports transaction selection, required-reason corrections and explicit human approval. Clean JSON contains business data; Full evidence JSON contains the complete batch. Copy/export require current validation and transaction eligibility; pending pages remain blocking. See [Local data model](DATA-MODEL.md).

Home's Extraction mode Segmented chooses Auto or Targeted; Targeted exposes a profile Select, field summary and Settings link. Settings' Extraction profiles card uses a Dialog with separate header/row lists, labelled inputs, type Selects, required Checkboxes and keyboard-accessible add/remove/reorder buttons. Builtins are locked and duplicable. Workspace renders dynamic row columns and corrections using profile labels with readable-key fallback. Home and processing Workspace announce the last 20 agent steps through polite status lists while retaining the busy line.

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

