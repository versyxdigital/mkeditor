# React Migration Plan

Phased plan for migrating MKEditor's renderer chrome from direct-DOM/Bootstrap to React 19 + shadcn/ui. This document is the source of truth for the migration; the high-level entry in [ROADMAP.md](ROADMAP.md) links here.

Read first: [../CLAUDE.md](../CLAUDE.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions

| Area                    | Decision                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| UI framework            | React 19, TypeScript, function components only                                                   |
| Component library       | [shadcn/ui](https://ui.shadcn.com) (copy-in pattern, built on Radix primitives + Tailwind CSS)   |
| Styling                 | Tailwind CSS (v4)                                                                                |
| Bundler                 | Stay on Webpack — `monaco-editor-webpack-plugin` is load-bearing for Monaco's bundle size        |
| Pane splits             | `react-resizable-panels` (shadcn-friendly), replacing split.js                                   |
| Toasts                  | `sonner` (shadcn integration), replacing SweetAlert2 toasts                                      |
| Dialogs / prompts       | shadcn `Dialog` / `AlertDialog`, replacing SweetAlert2 modals                                    |
| Drag & drop (tabs/tree) | Native HTML5 DnD for now (already works); revisit `@dnd-kit` after migration                     |
| Icons                   | Keep FontAwesome behind a thin `<Icon>` wrapper for now; evaluate `lucide-react` post-migration  |
| State                   | React `useState`/`useReducer` + context. **No Redux/Zustand.** Managers stay as data/IPC owners. |
| i18n                    | Keep i18next instance; thin `useTranslation` hook subscribes to `languageChanged`                |
| Tests                   | Add `@testing-library/react` + `@testing-library/user-event` alongside existing jest suite       |
| Wiring                  | Constructor injection (no DI container); managers passed via `ManagersContext`                   |

### State ownership rule

> **Managers own data and IPC. React owns UI and presentation.**

Concretely: [EditorManager](../src/browser/core/EditorManager.ts), [FileManager](../src/browser/core/FileManager.ts), [FileTreeManager](../src/browser/core/FileTreeManager.ts), [BridgeManager](../src/browser/core/BridgeManager.ts), [SettingsProvider](../src/browser/core/providers/SettingsProvider.ts), [ExportSettingsProvider](../src/browser/core/providers/ExportSettingsProvider.ts), [CommandProvider](../src/browser/core/providers/CommandProvider.ts), [CompletionProvider](../src/browser/core/providers/CompletionProvider.ts), [MkedLinkProvider](../src/browser/core/providers/MkedLinkProvider.ts), and [Markdown](../src/browser/core/Markdown.ts) keep their behaviour. Their DOM-mutation responsibilities (currently spread via [dom.ts](../src/browser/dom.ts)) move to React components that subscribe via context/hooks.

## Target Architecture

```
src/browser/
├── index.ts                       composition root (constructs managers, mounts <App>)
├── react/
│   ├── App.tsx                    top-level shell
│   ├── lib/
│   │   └── utils.ts               cn() helper (shadcn default)
│   ├── contexts/
│   │   ├── ManagersContext.tsx    provides editor/file/tree/bridge/providers
│   │   ├── SettingsContext.tsx    reactive view of EditorSettings
│   │   ├── ExportSettingsContext.tsx
│   │   ├── FilesContext.tsx       reactive view of FileManager tabs/active
│   │   └── FileTreeContext.tsx    reactive view of FileTreeManager tree
│   ├── hooks/
│   │   ├── useTranslation.ts      thin wrapper over i18next + languageChanged
│   │   ├── useNotify.ts           toast emitter (sonner)
│   │   ├── useConfirm.ts          prompt dialog helper
│   │   ├── useTheme.ts            data-theme + Monaco theme sync
│   │   └── useDispatcher.ts       subscribe to EditorDispatcher events
│   ├── components/
│   │   ├── Splash.tsx
│   │   ├── Navbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── FileTreePanel.tsx
│   │   ├── Workspace.tsx          resizable panels container
│   │   ├── TabBar.tsx
│   │   ├── EditorHost.tsx         Monaco mount point
│   │   ├── EditorToolbar.tsx
│   │   ├── PreviewPane.tsx
│   │   ├── Icon.tsx               FontAwesome wrapper
│   │   ├── modals/
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── ExportSettingsModal.tsx
│   │   │   ├── ShortcutsModal.tsx
│   │   │   ├── AboutModal.tsx
│   │   │   └── PropertiesModal.tsx
│   │   └── ui/                    shadcn primitives (copied in via CLI)
│   └── styles/
│       └── tailwind.css           Tailwind v4 entry
└── (existing core/, events/, extensions/, interfaces/ unchanged)
```

## Cross-cutting Concerns

- **No `?.` provider chains in React.** Components consume non-null managers via context. Composition root guarantees they exist before mount.
- **Single Monaco instance**, mounted once. `EditorHost` uses `useEffect` with empty deps; never remount on parent re-render.
- **i18n bridging**: existing `data-i18n-*` DOM walk in [applyTranslations](../src/browser/i18n.ts) only touches non-React subtrees. As regions become React, their `data-i18n-*` attributes are removed and replaced with `useTranslation`. The walker remains correct because it only finds what's left.
- **Manager → React state**: managers gain a minimal observer surface (a `subscribe(listener)` returning `unsubscribe`) so contexts can re-render on data changes. Managers do not import React.
- **Bundle**: shadcn copy-in keeps node_modules small (Radix primitives are tree-shaken). Tailwind v4 is small in production. Monaco remains the dominant chunk.
- **Mode (web/desktop)** continues to flow as a prop/context value from the composition root; no scattered `window.executionBridge` checks.

## Phase Index

| #   | Phase                                                   | Status        |
| --- | ------------------------------------------------------- | ------------- |
| 1   | Foundation: deps, build, shadcn init                    | 🟢 2026-05-16 |
| 2   | Composition root + Monaco host                          | 🟢 2026-05-16 |
| 3   | Preview pane + resizable workspace                      | 🟢 2026-05-16 |
| 4   | Top chrome: navbar + tabs                               | 🟢 2026-05-16 |
| 5   | Sidebar + file tree                                     | 🟢 2026-05-16 |
| 6   | Editor toolbar + dropdowns                              | 🟢 2026-05-16 |
| 7   | Modals + Settings/Export refactor                       | 🟢 2026-05-16 |
| 8   | Toasts + prompts (drop SweetAlert2)                     | 🟢 2026-05-16 |
| 9   | Cleanup (drop Bootstrap, dispatcher fold, dom.ts prune) | 🟢 2026-05-16 |
| 10  | Test pass + docs update                                 | 🟢 2026-05-16 |

A phase is **complete** only when its exit criteria are met _and_ `npm test`, `npm run lint`, and a manual smoke (desktop + web) pass. **Each phase ends with a focused commit (or small commit series) on a `feature/react-phase-N-<slug>` branch.**

---

## Phase 1 — Foundation

**Goal**: React 19, Tailwind, and shadcn can render into the existing HTML shell without changing app behaviour. Nothing in the prod render path uses them yet.

**Tasks**:

1. Add runtime deps: `react`, `react-dom`, `class-variance-authority`, `clsx`, `tailwind-merge`, `react-resizable-panels`, `sonner`.
2. Add dev deps: `@types/react`, `@types/react-dom`, `tailwindcss@4`, `@tailwindcss/postcss`, `postcss`, `postcss-loader`, `autoprefixer`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
3. Update [tsconfig.json](../tsconfig.json): `"jsx": "react-jsx"`; verify `"moduleResolution"` works with React 19 types.
4. Update [webpack.config.js](../webpack.config.js):
   - Add `.tsx` to `resolve.extensions`.
   - Add a PostCSS pipeline for `*.css` containing Tailwind directives (keep existing SCSS path for Bootstrap until Phase 9).
   - Confirm the Monaco plugin still tree-shakes correctly.
5. Initialise shadcn:
   - Create [components.json](../components.json) pointing at `src/browser/react/components/ui/`, `src/browser/react/lib/utils.ts`, Tailwind v4 mode.
   - Create [src/browser/react/lib/utils.ts](../src/browser/react/lib/utils.ts) with `cn()`.
   - Create [src/browser/react/styles/tailwind.css](../src/browser/react/styles/tailwind.css) with `@import "tailwindcss";` and any shadcn base layers.
6. Add a no-op `src/browser/react/__sanity__.tsx` that imports React + a single shadcn `Button` and exports nothing the bundle uses. Confirms the build path. Remove at end of Phase 2.
7. Update [jest.config.js](../jest.config.js): jsdom transform for `.tsx`, jest-dom matchers, `transform` for tailwind imports as stubs.

**Exit criteria**:

- `npm run build-editor` produces a bundle that still boots both modes with no visible change.
- `npm test` passes (no React tests yet, but config doesn't break existing tests).
- Tailwind classes resolve in a throwaway component (verified manually by importing it temporarily into `index.ts`).

**Out of scope**: any user-facing change; touching any existing manager/provider.

---

## Phase 2 — Composition Root + Monaco Host

**Goal**: React owns the page mount. Monaco is created by `EditorManager` and mounted into a React-rendered `<div>`. Everything else is still legacy DOM, untouched.

**Tasks**:

1. Refactor [EditorManager.create()](../src/browser/core/EditorManager.ts:80) to accept a `HTMLElement` mount target rather than reading [dom.editor.dom](../src/browser/dom.ts:101). Keep the dom.ts fallback for the brief window where legacy code still constructs it.
2. Refactor [index.ts](../src/browser/index.ts):
   - Construct managers/providers as before, but **do not** call `EditorManager.create()` directly.
   - Instead, mount `<App managers={...} mode={mode} />` into a new `#react-root` div added to [views/index.html](../src/browser/views/index.html).
   - `<App>` provides `ManagersContext` and renders the legacy DOM via a small placeholder component (`<LegacyShell />`) that renders nothing structural yet, _and_ a `<EditorHost />` that swaps with the current `#editor` div.
3. Create [src/browser/react/contexts/ManagersContext.tsx](../src/browser/react/contexts/ManagersContext.tsx) exposing `{ mode, editorManager, fileManager, fileTreeManager, bridgeManager?, providers }` (with non-null assertions guarded by the composition root).
4. Create [src/browser/react/components/EditorHost.tsx](../src/browser/react/components/EditorHost.tsx):
   - `useEffect(() => { editorManager.create({ mount: ref.current, watch: true }); return () => editorManager.dispose(); }, [])`.
   - Add a `ResizeObserver` calling `editorManager.layout()`.
   - Add a `dispose()` method to EditorManager (currently absent) that calls `editor.dispose()` and tears down listeners.
5. Keep `#editor` as a legacy ID temporarily; remove it once `EditorHost` is mounted. The rest of the page still uses the existing HTML.

**Exit criteria**:

- App boots; user can type and see preview; tabs/toolbar/etc work via legacy DOM.
- Monaco is created exactly once even on React re-renders (verified by logging in `create()`).
- Window resize and split drag both trigger `editor.layout()`.

**Out of scope**: replacing any chrome; touching SettingsProvider; touching Bootstrap modals.

---

## Phase 3 — Preview Pane + Resizable Workspace

**Goal**: Preview and the editor/preview split become React-rendered. Sidebar/wrapper split also goes React-managed.

**Tasks**:

1. Create [src/browser/react/components/PreviewPane.tsx](../src/browser/react/components/PreviewPane.tsx):
   - Renders `<div ref={previewRef} />` with classes equivalent to today's `#preview-content`.
   - Subscribes to `editor:render` from `EditorDispatcher`; on event, runs `Markdown.render(editorManager.getValue())` and assigns to `previewRef.current.innerHTML`. (Preview content is HTML produced by markdown-it; this is intentional and is not replaced by JSX. See note on [HTMLExporter](../src/browser/core/HTMLExporter.ts) in §"Risks".)
   - Calls `refreshLines()` after each render.
2. Replace split.js for the editor/preview gutter with `react-resizable-panels`. Implement a `<Workspace>` component containing two `<Panel>`s separated by a `<PanelResizeHandle>`.
3. Wire the resize handle to call `editorManager.layout()` on drag (via `onResize` callback or a `useEffect` on panel size).
4. Replace split.js for the sidebar/wrapper gutter with the same library. Sidebar visibility is a context value (`sidebarOpen`) on `ManagersContext` or a dedicated `<UIStateContext>`.
5. Move the "split reset" button (currently `#split-reset`) into the React tree; reset by calling the panel group's `setLayout([50, 50])`.

**Exit criteria**:

- Drag-resize works smoothly in both modes.
- Scroll sync still works (relies on `refreshLines()` after render, which the new PreviewPane preserves).
- `dom.preview` references in [HTMLExporter](../src/browser/core/HTMLExporter.ts) still resolve (we keep the same data-id surface on the React-rendered preview).

**Out of scope**: tabs, toolbar, sidebar contents.

---

## Phase 4 — Top Chrome: Navbar + Tabs

**Goal**: The `<nav>` and the file-tabs row are React components.

**Tasks**:

1. Create [src/browser/react/components/Navbar.tsx](../src/browser/react/components/Navbar.tsx) covering:
   - Sidebar toggle button (calls `setSidebarOpen` from context).
   - App logo + active file name (`<ActiveFileLabel>` subscribes to `FilesContext`).
   - Character/word count (`<Counts>` subscribes to a new lightweight `useCounts(value)` hook driven by `editor:render`).
   - Settings cog → opens shadcn `Dialog` (placeholder until Phase 7).
   - Build version chip → opens About modal (placeholder).
2. Refactor [FileManager](../src/browser/core/FileManager.ts) to expose an observable surface:
   - `tabs: { path: string; name: string }[]` getter built from existing maps.
   - `activeFile` getter (already exists).
   - `on('change', listener): () => void` emitter, fired on add/close/activate/rename.
   - Remove DOM-mutation methods (`addTab`, drag listeners, tab close DOM cleanup). React components replace them.
3. Create [src/browser/react/contexts/FilesContext.tsx](../src/browser/react/contexts/FilesContext.tsx) — a `useSyncExternalStore` wrapper over FileManager's emitter.
4. Create [src/browser/react/components/TabBar.tsx](../src/browser/react/components/TabBar.tsx):
   - Renders tabs from `FilesContext`.
   - Click → `fileManager.activateFile(path)`.
   - Close → `fileManager.closeTab(path)`.
   - HTML5 drag-and-drop reorder → `fileManager.reorderTabs(newPathOrder)` (new method).
5. Update [BridgeListeners.ts](../src/browser/core/BridgeListeners.ts) to call the new FileManager API instead of DOM-mutating cloneNode hacks at lines 117-162 and 178-223.

**Exit criteria**:

- Tabs render, activate, close, drag-reorder.
- Renaming a file via the explorer updates the tab name without DOM stitching.
- Unsaved-change "\*" suffix still appears in the window title.

**Out of scope**: explorer tree, modals, toolbar.

---

## Phase 5 — Sidebar + File Tree

**Goal**: Sidebar and file tree become React components.

**Tasks**:

1. Refactor [FileTreeManager](../src/browser/core/FileTreeManager.ts):
   - Keep `treeRoot`, `directoryMap`, and the build logic, **but** store the tree as plain data (a `TreeNode[]` shape), not DOM nodes.
   - Expose `on('change', listener)` like FileManager.
   - Remove `buildFileTree`'s DOM construction; keep its sorting + add-file-to-tree data logic.
   - Remove `handleFileTreeClick`, `handleFileTreeContextMenu`, `showContextMenu`. React owns these.
2. Create [src/browser/react/contexts/FileTreeContext.tsx](../src/browser/react/contexts/FileTreeContext.tsx).
3. Create [src/browser/react/components/Sidebar.tsx](../src/browser/react/components/Sidebar.tsx) and `<FileTreePanel>`:
   - Renders the tree recursively.
   - Each directory: chevron + folder icon + name; click to expand/collapse with local state.
   - Each file: file icon + name; click to open via `fileManager.openFileFromPath(path)`.
4. Context menu: use shadcn `ContextMenu`. Migrate items from [explorerContextMenu.ts](../src/browser/core/mappings/explorerContextMenu.ts) — keep the mapping module, but its functions now return shadcn-shaped items instead of plain objects.
5. SweetAlert2 prompts inside the context menu remain temporarily; replaced in Phase 8.

**Exit criteria**:

- Open folder, expand directories, open file from tree all work.
- Right-click menu shows correct items per node type, including for empty tree.
- Lazy directory load (`hasChildren=true` not yet loaded) still issues `to:file:openpath`.

**Out of scope**: replacing SweetAlert2 prompts; modal restyling.

---

## Phase 6 — Editor Toolbar + Dropdowns

**Goal**: The `#editor-functions` toolbar and the alert/code/tables dropdowns are React.

**Tasks**:

1. Create [src/browser/react/components/EditorToolbar.tsx](../src/browser/react/components/EditorToolbar.tsx) with one button per `commands` entry in [mappings/editorCommands.ts](../src/browser/core/mappings/editorCommands.ts).
2. Convert the alert/code/tables dropdowns to shadcn `DropdownMenu`. Items are still driven by `alertblocks` and `codeblocks` arrays in the same mapping module.
3. CommandProvider keybindings stay untouched. Only the DOM-button binding in [CommandProvider.register()](../src/browser/core/providers/CommandProvider.ts:125-148) is removed; the React buttons call into the same private methods, exposed by promoting them to a public `executeCommand(key)` (or by exporting individual functions).
4. The "insert table" form becomes a shadcn `Popover` with input fields + an Insert button calling the existing `table()` logic.
5. Save/Export buttons inside the toolbar move into the navbar or stay in the toolbar — keep current layout; only the rendering layer changes.

**Exit criteria**:

- All toolbar actions work; keyboard shortcuts (including chord keys `Ctrl+L → X` for alerts, `Ctrl+K → X` for codeblocks, `Ctrl+T` for tables) still work.
- Dropdowns close after selection.
- Bootstrap `Dropdown` JS is no longer constructed in CommandProvider.

**Out of scope**: settings/about/shortcuts modals.

---

## Phase 7 — Modals + Settings/Export Refactor

**Goal**: All modals are shadcn `Dialog`s. SettingsProvider and ExportSettingsProvider lose their DOM-binding responsibilities.

**Tasks**:

1. **SettingsProvider refactor** ([SettingsProvider.ts](../src/browser/core/providers/SettingsProvider.ts)):
   - Keep: `getSettings`, `getSetting`, `setSetting`, `setSettings`, `setTheme`, `setAudoIndent` (sic), `setMinimap`, `setWordWrap`, `setWhitespace`, `setSystemThemeOverride`, persistence to localStorage/bridge.
   - Remove: `registerDOMListeners`, `populateLocaleOptions`, `register…ChangeListener`, `setUIState`. (React owns these.)
   - Add: `subscribe(listener)` emitter.
2. **SettingsContext** ([src/browser/react/contexts/SettingsContext.tsx](../src/browser/react/contexts/SettingsContext.tsx)): exposes `settings`, `setSetting(key, value)`. Internally uses `useSyncExternalStore`.
3. **Same refactor for ExportSettingsProvider**.
4. **`<SettingsModal>`**: shadcn `Dialog` + `Switch`/`Select` controls. Locale select populated by calling `getAvailableLocales()` once.
5. **`<ExportSettingsModal>`**: shadcn `Dialog` + form controls including a `Slider` for line spacing (preserve debouncing on persist).
6. **`<AboutModal>`** and **`<ShortcutsModal>`**: simple shadcn `Dialog` wrappers around the existing content (move from index.html into JSX).
7. **`<PropertiesModal>`** (file properties popup, currently SweetAlert2 in [dom.ts:261](../src/browser/dom.ts#L261)): keep on SweetAlert2 until Phase 8 or convert now if trivial.
8. Remove Bootstrap `Modal` construction in [CommandProvider](../src/browser/core/providers/CommandProvider.ts:40-50); modals are opened via React state (e.g. `useSettingsModal()`).
9. `BridgeListeners` `from:modal:open` handler dispatches to a `ModalsContext` instead of calling `Modal.toggle()`.
10. Live preview style updates (`syncPreviewToExportSettings`) continue, just driven by SettingsContext change rather than direct DOM listener.

**Exit criteria**:

- All four (or five) modals open, function, and persist as before.
- Locale change applies and persists.
- Toggling system-theme correctly disables the darkmode toggle (preserve current behaviour for desktop).
- ExportSettingsModal still updates the preview live and debounces persistence.

**Out of scope**: SweetAlert2 toast/prompt replacement.

---

## Phase 8 — Toasts + Prompts (drop SweetAlert2)

**Goal**: SweetAlert2 is gone.

**Tasks**:

1. Add `<Toaster />` from `sonner` at the root of `<App>`.
2. Replace [notify.send](../src/browser/util.ts:182) with a `useNotify()` hook that calls `sonner.toast.<level>()`. Update [BridgeListeners.notification handler](../src/browser/core/BridgeListeners.ts:238) to use the new emitter (or expose `notify` outside React as `sonnerToast` for non-component callers).
3. Replace SweetAlert2 prompts in [explorerContextMenu.ts](../src/browser/core/mappings/explorerContextMenu.ts) with a `useConfirm()` / `usePrompt()` hook that opens a shadcn `AlertDialog`/`Dialog`. The context-menu items become React handlers that call hooks.
4. Replace `closeTab` unsaved-changes confirmation in [FileManager.closeTab](../src/browser/core/FileManager.ts:102-134) with the same hook — but since FileManager is non-React, expose a registered `confirmCloseTab` function on the manager that React installs at mount time.
5. Replace [showFilePropertiesWindow](../src/browser/dom.ts:261) with a `<PropertiesModal>` (deferred from Phase 7 if needed).
6. Remove `sweetalert2` from package.json.

**Exit criteria**:

- No `import Swal` left in the codebase.
- All previously SweetAlert2-driven flows work: unsaved-change prompt on close tab, new/rename/delete prompts in explorer, file properties popup, notification toasts (success/error/info).

**Out of scope**: removing Bootstrap CSS/JS.

---

## Phase 9 — Cleanup: Bootstrap, Dispatcher Fold, dom.ts Prune

**Goal**: Strip every dependency made redundant by the migration.

**Tasks**:

1. Remove `bootstrap` import from [scss/index.scss](../src/browser/assets/scss/index.scss). Audit remaining usage:
   - Any utility classes (`d-none`, `text-muted`, `gap-2`, etc) in the React tree are replaced by Tailwind equivalents.
   - Components (modal, dropdown, tooltip) are already gone after Phases 6–8.
   - `container`/`container-fluid` references in [HTMLExporter.ts](../src/browser/core/HTMLExporter.ts) **stay** — those are for the exported HTML, which still CDN-loads Bootstrap.
2. Remove `bootstrap` from `package.json` dependencies (devDependency in current package).
3. Remove `split.js` (replaced in Phase 3).
4. Remove `@popperjs/core` (Bootstrap-only dependency).
5. Prune [dom.ts](../src/browser/dom.ts):
   - Delete anything no longer queried by non-React code.
   - What remains should be: nothing, ideally. If anything stays, document why.
6. Fold [EditorDispatcher](../src/browser/events/EditorDispatcher.ts):
   - `editor:render` — keep (it's how PreviewPane re-renders).
   - `editor:track:content` — keep (FileManager uses it).
   - `editor:bridge:settings` — replace with direct SettingsContext call into BridgeManager.
   - Decide whether to delete the dispatcher class entirely; if the remaining two events are React-internal, replace them with a context emitter.
7. Trim the remaining DOM `tooltip`/`refreshTooltips` plumbing in [dom.ts](../src/browser/dom.ts:123) and [i18n.ts](../src/browser/i18n.ts:357) — tooltips are now shadcn `Tooltip` components driven by `useTranslation`.
8. Remove `data-i18n-*` walker bits if no non-React DOM remains. (Likely all gone after Phase 4–7.)

**Exit criteria**:

- `package.json` no longer references `bootstrap`, `@popperjs/core`, `split.js`, `sweetalert2`.
- `dom.ts` is empty or removed.
- Bundle size measurably smaller (record before/after in commit).
- All flows still work.

---

## Phase 10 — Test Pass + Docs Update

**Goal**: React testing infrastructure in place; key components covered; docs reflect reality.

**Tasks**:

1. React Testing Library tests for:
   - `<TabBar>` — render, activate, close (with mocked FileManager).
   - `<FileTreePanel>` — render tree, expand/collapse, click open.
   - `<SettingsModal>` — toggles update SettingsContext.
   - `<EditorToolbar>` — button click calls correct provider method.
   - `<PreviewPane>` — re-renders on dispatch event.
2. Existing jest tests audited: remove any that assert on now-React DOM; replace with RTL equivalents.
3. Update [ARCHITECTURE.md](ARCHITECTURE.md):
   - Replace the "no framework" line and dom.ts-centric description.
   - Add a React layer section with the component tree and context map.
   - Note that managers retained their roles; only the view layer changed.
4. Update [src/browser/README.md](../src/browser/README.md) to reflect new structure.
5. Update [CLAUDE.md](../CLAUDE.md): rewrite "Conventions" + "Renderer Composition Root" sections.
6. Update [ROADMAP.md](ROADMAP.md): mark React migration 🟢 with date; open §4 (post-React opportunities).

**Exit criteria**:

- `npm test` shows non-trivial React coverage (>= the 5 component suites above).
- Docs match code.

---

## Risks & Mitigations

| Risk                                                                                                                  | Mitigation                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco re-mount on parent re-render (large perf hit, lost state)                                                      | `<EditorHost>` uses `useEffect(..., [])`; never re-renders body. Verified by mount counter.                                                                           |
| Scroll sync stops working after preview-render                                                                        | Preserve `refreshLines()` call after every `innerHTML` assignment in `<PreviewPane>`.                                                                                 |
| HTMLExporter reads `dom.preview.dom.outerHTML`                                                                        | Keep a stable id (`#preview-content`) on the React-rendered preview element.                                                                                          |
| i18n DOM walker stops finding bindings as nodes become React                                                          | Walker is naturally bounded to remaining `data-i18n-*` attrs; safe during migration.                                                                                  |
| Bootstrap utility class usage in copied-in HTML strings (e.g. modal HTML in [dom.ts:266](../src/browser/dom.ts#L266)) | Phase 8 converts these to React + Tailwind together with their owning flow.                                                                                           |
| Webpack + Tailwind v4 + Monaco interaction (slow rebuilds)                                                            | Profile in Phase 1; if too slow, consider a separate dev-only css watcher.                                                                                            |
| SweetAlert2 prompts return promises consumed by non-React code (FileManager.closeTab)                                 | Expose hook-registered handlers on the managers; React installs them at mount.                                                                                        |
| `webContents.send` from main → renderer before React has mounted                                                      | Composition root mounts React synchronously before `BridgeManager` registers listeners. Order in [index.ts](../src/browser/index.ts) is already correct; preserve it. |
| Tab DnD with React's reconciliation                                                                                   | Use `useRef` for drag-state; reorder via FileManager method that emits a single `change`.                                                                             |

## Out of Scope (for this migration)

- Switching state management to Redux/Zustand/MobX/Jotai/etc.
- Replacing markdown-it, KaTeX, highlight.js, or Monaco.
- Replacing FontAwesome.
- Replacing Webpack with Vite.
- Adding Server Components / SSR.
- Changing the Electron main process at all.
- Changing the IPC channel surface (the [preload.ts](../src/app/preload.ts) whitelists are stable).
- Adding a DI container (constructor injection is sufficient; see [ROADMAP.md §2](ROADMAP.md#2-dependency-wiring--di-cleanup)).

## Workflow (Slash Commands + Agents)

This migration is executed via project-scoped slash commands backed by custom agents. Definitions live in [`.claude/commands/`](../.claude/commands/) and [`.claude/agents/`](../.claude/agents/).

### Commands

| Command               | Purpose                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/migrate-status`     | Show the Phase Index, identify the next phase to execute, surface any blockers.                                                                                                                                                                                  |
| `/migrate-phase <N>`  | Execute phase N end-to-end: plan tasks via TodoWrite → implement (with parallel sub-agents where independent) → auto-run all three reviewers in parallel → synthesise → request commit approval. Never commits or updates status without explicit user approval. |
| `/migrate-review <N>` | Standalone parallel review of phase N's diff. Use for mid-phase checkpoints, after manual edits, or to re-check after fixes. Read-only.                                                                                                                          |

### Agents

| Agent                        | Type       | Role                                                                                                                                                                                                                                  |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-phase-executor`       | read+write | Implements one parallelisable slice of a phase. Used only when sub-tasks have strictly non-overlapping file ownership. Sequential work and shared infra (tsconfig, webpack, package.json, composition root) stay in the main session. |
| `react-phase-reviewer`       | read-only  | Verifies exit criteria, task completeness, out-of-scope adherence, scope creep.                                                                                                                                                       |
| `react-architecture-auditor` | read-only  | Verifies architectural rules: manager/React separation, no rogue DOM queries, no reintroduced legacy deps, no extra state libs, single Monaco instance, i18n discipline, stack discipline.                                            |
| `react-test-auditor`         | read-only  | Verifies test coverage for new components/hooks, runs lint + tsc + jest, reports gaps.                                                                                                                                                |

The three reviewers always run **in parallel** (a single message with three `Agent` tool calls) — they each have an independent cold context, so they don't share findings and don't waste tokens re-reading the same diff sequentially.

### Review cadence

- **End-of-phase**: automatic. Built into `/migrate-phase`.
- **Mid-phase**: on-demand via `/migrate-review N`. Not automatic — would burn tokens without strong signal.
- **Per-task**: not run. Trust the architecture rules to be caught at end-of-phase or on demand.

### Typical loop

```
/migrate-status                          → identify next phase (say, 3)
git checkout -b feature/react-phase-3-preview-workspace
/migrate-phase 3
  ↳ plan → implement → reviewers run in parallel → report
  ↳ address concerns (re-run /migrate-review 3 to verify)
  ↳ approve commit when ready
  ↳ status updates to 🟢 in Phase Index
/migrate-status                          → confirm; identify Phase 4
```

If a phase reveals a planning gap, **stop, surface the question, update this doc, then resume** — never work around the plan silently.

## Branching & Commits

- Branch per phase: `feature/react-phase-<N>-<slug>`.
- Squash-merge to `main` after each phase passes its exit criteria.
- Each commit follows Conventional Commits ([CONTRIBUTING.md](../CONTRIBUTING.md#commit-messages)). Migration commits use `feat(react): …`, `refactor(react): …`, `chore(react): …`.
- Keep PRs small; one phase per PR ideally.

## Executing a Phase (manual fallback)

Normally phases run via `/migrate-phase <N>` (see **Workflow** above). If you're executing manually:

1. Re-read **Decisions** and the relevant phase section.
2. Re-read the corresponding code paths in [ARCHITECTURE.md](ARCHITECTURE.md).
3. Branch: `feature/react-phase-<N>-<slug>` off `main`.
4. Implement tasks in listed order. Don't skip ahead.
5. Verify exit criteria.
6. Run `/migrate-review <N>` to dispatch the three reviewers, or smoke test + `npm test` + `npm run lint` manually.
7. Commit, open PR, and update the phase row's status emoji to 🟢 after merge.

If a phase reveals an assumption that's wrong, **stop and revise this plan first** rather than working around it.
