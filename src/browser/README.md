# MKEditor Renderer (`src/browser/`)

The renderer is the browser-side bundle: Monaco editor, markdown preview, React UI tree, i18n runtime, and the IPC seams that the Electron preload exposes. The same bundle ships as a pure web app (deployed to GitHub Pages) and as the renderer process inside the desktop Electron build.

For the full architecture see [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md). For the React migration that shaped the current layout see [docs/REACT_MIGRATION.md](../../docs/REACT_MIGRATION.md).

## Layout

Top-level seam files at `src/browser/`:

- `index.ts` — composition root. Constructs the dispatcher + `EditorManager`, mounts `<App>` synchronously into `#react-root`, then wires providers + (desktop) `BridgeManager` in `onEditorReady`.
- `i18n.ts` — i18next bundle loader + the (now tiny) `data-i18n-*` walker for the splash `<h1>`.
- `icons.ts` — FontAwesome icon registry.
- `dom.ts` — small constant map (`editor.dom`, `preview.dom`, `preview.wrapper`, `meta.scroll`) for non-React consumers (`HTMLExporter`, `ScrollSync`, `LineNumber`).
- `notify.ts` — `sonnerToast(level, msg)` neutral seam shared by React + non-React callers.
- `splash.ts` — boot-time splash fade-out.
- `util.ts` — debounce, `getExecutionBridge`, `syncPreviewToExportSettings`.
- `config.ts` — default `EditorSettings` + `ExportSettings`.
- `version.ts` — build-generated.

Subfolders:

- `core/` — managers (Monaco + IPC + persistence + markdown pipeline). Pure TS, no React.
  - `EditorManager`, `FileManager`, `FileTreeManager`, `BridgeManager`, `BridgeListeners`, `Markdown`, `HTMLExporter`
  - `providers/`: `SettingsProvider`, `ExportSettingsProvider`, `CommandProvider`, `CompletionProvider`, `MkedLinkProvider`
  - `completion/`, `mappings/`
- `events/` — `EditorDispatcher` (decouples Monaco's watch loop from React subscribers via `editor:render` + `editor:track:content`).
- `extensions/` — Monaco extensions (`WordCount`, `ScrollSync`) + markdown-it extensions (`AlertBlock`, `LineNumber`, `LinkTarget`, `ImageStyle`, `TableStyle`).
- `interfaces/` — TypeScript types shared by both sides.
- `react/` — the React UI tree (function components, React 19).
  - `App.tsx` — providers + chrome + modals + sonner Toaster.
  - `contexts/` — one context per reactive concern (`Settings`, `ExportSettings`, `Files`, `FileTree`, `Modals`, `Prompts`, `Properties`, `UIState`, `Managers`). Each wraps a manager via `useSyncExternalStore`.
  - `hooks/` — `useTranslation`, `useCounts`, `useNotify`.
  - `components/` — `Navbar`, `TabBar`, `Sidebar`, `FileTreePanel`, `Workspace`, `EditorHost`, `EditorToolbar`, `PreviewPane`, `BottomToolbarRight`, `Icon`, and `modals/*`.
  - `components/ui/` — shadcn copy-in primitives (`Dialog`, `ContextMenu`, `DropdownMenu`, `Popover`, `Tooltip`, `Switch`, `Select`, `Checkbox`, `Input`, `Label`, `Button`) — thin Radix wrappers using Tailwind theme tokens.
  - `styles/tailwind.css` — Tailwind v4 entry + theme tokens (light + `[data-theme='dark']`).
- `assets/` — SCSS partials (`_base`, `_editor`, `_preview`, `_sidebar`, `_tabs`, `_darkmode`) + `intro.ts` (welcome markdown).
- `views/index.html` — minimal shell: splash overlay, `#react-root` mount, bottom `<nav>` with the `#editor-functions` and `#bottom-toolbar-right` portal hosts. All Tailwind-styled.

## Manager / React separation

The governing rule is **managers own data and IPC; React owns UI and presentation.**

- Managers under `core/` do not import React or any Radix module.
- React components under `react/` do not import `ipcRenderer`, touch `window.executionBridge`, or read/write `localStorage` directly.
- Reactive provider state crosses the boundary via `subscribe(listener) → unsubscribe` + `getSnapshot()` (stable reference between emits). React contexts pull through `useSyncExternalStore`.
- Imperative cross-boundary calls (e.g., `BridgeListeners.from:modal:open` opening a React Dialog, or `FileManager.closeTab` opening a React confirm) go through module-level `*External` functions registered by React at mount time:
  - `openModalExternal` (ModalsContext)
  - `openPromptExternal` / `confirmExternal` / `promptExternal` (PromptsContext)
  - `showPropertiesExternal` (PropertiesContext)
  - `sonnerToast` (`src/browser/notify.ts`)

## Runtime Modes & Bridge Model

`index.ts` uses `getExecutionBridge()` (from `util.ts`) to detect mode:

- **Web**: returns `'web'`. Sidebar collapsed by default, `<EditorToolbar>` shows the delete-content button, settings + last-edited content persist to `localStorage`.
- **Desktop**: returns the bridge object created in the Electron preload. Sidebar visible, file tree populated, settings persist via IPC.

Renderer perspective of bridge channels:

- Send (`to:*`): `to:title:set`, `to:editor:state`, `to:settings:save`, `to:html:export`, `to:pdf:export`, `to:file:*`, `to:folder:*`, `to:i18n:set`.
- Receive (`from:*`): `from:file:*`, `from:folder:*`, `from:settings:set`, `from:theme:set`, `from:notification:display`, `from:path:*`, `from:modal:open`, `from:command:palette`, `from:i18n:set`.

`BridgeListeners.ts` is the single entry point for `from:*` channels — see [ARCHITECTURE.md §4](../../docs/ARCHITECTURE.md) for the per-flow detail.

## i18n Model & Namespaces

- Namespaces: `app`, `navbar`, `sidebar`, `toolbar`, `menus-explorer`, `menus-codeblocks`, `menus-alerts`, `menus-tables`, `modals-settings`, `modals-export`, `modals-about`, `modals-shortcuts`, `modals-unsaved`, `modals-properties`, `notifications`.
- `scripts/combine-locales.mjs` produces a per-language `all.json` at build time. At runtime, the loader prefers the combined bundle and falls back to per-namespace fetches; missing namespaces are supplemented dynamically; English fallbacks are ensured for `notifications`.
- Usage from React: `const { t } = useTranslation(); t('navbar:settings_tooltip')`. The hook subscribes to i18next's `languageChanged` event so consuming components re-render on locale change.
- Usage from non-React: `import { t } from '../i18n'`.
- Legacy attribute-driven binding (`data-i18n-text` / `-title` / `-placeholder`) remains for the splash `<h1>` only — every other label translates through React.

## Build & Run

- Build the renderer bundle: `npm run build-editor` (generates `version.ts`, combines locales, runs Prettier, runs webpack → `dist/mkeditor.bundle.js` + `dist/mkeditor.bundle.css`).
- Run the web demo: `npm run serve-web` (serves `dist/` over http-server).
- Run the desktop app: `npm run serve-app` (after `build-editor`; launches Electron pointing at `dist/app/main.js`).

## Lifecycle Highlights

1. `icons.ts` registers FontAwesome glyphs.
2. `initI18n(mode)` builds the (tiny) splash binding, prefetches the combined locale bundle, initialises i18next, applies translations, sets `<html lang>`.
3. `new EditorDispatcher` + `new EditorManager({mode, dispatcher})` — Monaco is **not** created yet; that's `<EditorHost>`'s job inside React.
4. `createRoot(#react-root).render(<App initialManagers onEditorReady />)` mounts the full provider tree synchronously, including the `<ModalsBridge>` / `<PromptsBridge>` / `<PropertiesBridge>` sentinels that install the module-level seams.
5. `<EditorHost>`'s `useEffect` runs once: calls `editorManager.create({mount, watch:true})`, then `onReady()` triggers `index.ts.onEditorReady` which attaches providers + (desktop) constructs `BridgeManager`, wires `setPersistHandler` callbacks, and pushes the new managers back into React state.
6. `showSplashScreen({duration:750})` fades the splash overlay + bottom `<nav>` in.
