# Design system

Import components from `src/ds`. Styles are loaded once by `src/main.tsx`: `tokens.css` defines values, `components.css` defines components. The existing `src/ui/Icon.tsx` remains the only SVG implementation. No catalog changes or new icons.

Visit `#/design` for the interactive inventory. Home and Workspace retain their existing UI pending the Admin Panel phase; the shared shell, Settings and update notification use the DS now.

Home lists canonical batches with physical page/document/transaction counts. Workspace uses the first transaction's exception-first view, immutable field corrections and explicit human approval. JSON switches between Clean JSON and Full JSON (batch); export/copy require transaction eligibility. Evidence overlays are read-only. Settings includes a clamped 1–500 page limit and startup migration counts. See [Local data model](DATA-MODEL.md).

## Theme and tokens

`ThemeProvider` / `useTheme()` expose `theme` and `setTheme('light' | 'dark' | 'system')`. Default is light. Choice is stored as `idp-studio.theme`; blocked storage is tolerated. System mode listens for OS changes. The resolved theme is applied to the document element. The topbar's opaque safe-area background uses `--topbar`.

Semantic tokens: `--background`, `--surface`, `--surface-alt`, `--text`, `--muted`, `--border`, `--focus`, `--primary`, `--primary-text`, `--info`, `--success`, `--warning`, `--danger`, `--selected`, `--hover`, `--disabled`, `--sidebar`, `--topbar`. Status colors are foregrounds on neutral surfaces, not backgrounds. Accent text uses primary on background/surface; primary buttons use primary-text on primary. Do not use arbitrary foreground/background combinations.

Layout: `--sidebar-expanded` 248px, `--sidebar-collapsed` 64px, `--topbar-height` 60px, `--workspace-padding` 24px/16px mobile, `--font-body` 14px, `--row-normal` 40px, `--row-compact` 32px, `--control-height` 40px/44px mobile. Scales: `--space-1` through `--space-8`, `--font-sm/body/lg/title`, `--radius-sm/md/lg/pill`, `--shadow-sm/lg`, `--z-sticky/popover/modal/toast`, `--icon-sm/md/lg`, `--motion-fast/spin`. Reduced motion makes motion durations zero.

Legacy aliases `--bg`, `--warn`, `--ok`, `--bbox` exist only for the unmigrated Home/Workspace stylesheet. Values remain in the token file.

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
| DataTable | `caption`, `columns[{key,label,render,sortValue?}]`, `rows`, `rowKey`; optional `onRowClick`, `selectedKey`, `density`, `loading`, `error`, `emptyMessage`. Sticky header, aria-sort, stable client sorting, keyboard Enter/Space row activation; nested controls are not intercepted. Horizontally scrollable named container. |
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
| AppShell | `items`, children, optional `brand`, `search`, `right`, `footer`; layout only; owns drawer state. |
| Topbar | `onMenuToggle`, optional `menuExpanded`, `brand`, `search`, `right`; sticky opaque safe-area surface. |
| Sidebar | `items[{href,label,icon,active?,disabled?,reason?,count?}]`, optional `footer`, `mobileOpen`, `onMobileClose`, `onCollapsedChange`; optional `collapsed`/`onToggle` control the desktop rail. Desktop state stored at idp-studio.sidebar. Both rail widths expose toggle and aria-expanded. Named links/current page, disabled reasons, anchored rail tooltips. Phone drawer traps focus, locks scroll, closes on Escape and restores focus. |

## Ratchet

`npm run check:ssot` scans production source files, excluding tests and generated icon paint. It compares each file/rule independently with `scripts/ssot-baseline.json`; new files have zero allowance. Do not increase allowances. When removing old violations, lower the committed baseline. CSS duplicate checking targets top-level single-class base definitions, including comma-separated groups and definitions across files; media/state/descendant overrides are intentionally allowed. `npm run check` runs typecheck, icon freshness, SSOT and tests. No dependencies are added.

Contrast tests read `tokens.css` directly through `node:fs`, bypassing Vitest's CSS stubs. Dialog and drawer focus candidates are normalized to DOM order so selector-engine grouping cannot change Tab wrap targets.
