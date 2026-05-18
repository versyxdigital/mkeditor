# MKEditor — Project Context

Electron-based markdown editor built around Monaco. The same TypeScript bundle ships as a desktop app (Electron wraps it) and as a pure web app (deployed to GitHub Pages). Current version: 3.9.0.

The renderer is React 19 + shadcn/ui + Tailwind v4 on top of a set of plain-TS managers (Monaco, files, settings, markdown, IPC bridge). Migration history: [docs/REACT_MIGRATION.md](docs/REACT_MIGRATION.md). Subsystem READMEs: [src/app/README.md](src/app/README.md), [src/browser/README.md](src/browser/README.md), [src/browser/extensions/README.md](src/browser/extensions/README.md). For deeper detail see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For planned work see [docs/ROADMAP.md](docs/ROADMAP.md).

## Repo Layout

- [src/app/](src/app/) — Electron main process (Node). Compiled by `tsc` via [scripts/compile-app.mjs](scripts/compile-app.mjs) to `dist/app/`.
- [src/browser/](src/browser/) — Renderer (Monaco + React). Bundled by webpack to `dist/mkeditor.bundle.js` + `dist/mkeditor.bundle.css`.
- [locale/](locale/) — i18next JSON resources, one folder per language. Build step combines per-namespace JSON into `all.json` via [scripts/combine-locales.mjs](scripts/combine-locales.mjs).
- [tests/](tests/) — Jest + jsdom. Manager-level suites at the root; React component tests (RTL) under `tests/react/`. Mocks for `electron`, `monaco-editor`, CSS imports under [tests/**mocks**/](tests/__mocks__/).
- [@types/index.d.ts](@types/index.d.ts) — Global window augmentations (`window.executionBridge`, `window.mked`, `window.logger`, `window.setLanguage`).
- [build/](build/) — Installer resources (icons, license).

## Two Runtime Modes

The same renderer bundle detects which mode it's running in via [getExecutionBridge()](src/browser/util.ts):

- **Desktop**: `window.executionBridge` is injected by the Electron preload ([src/app/preload.ts](src/app/preload.ts)). Settings persist to `~/.mkeditor/settings.json`. File tree sidebar visible. Files open through IPC.
- **Web**: no bridge. Settings + last-edited content go to `localStorage` (`mkeditor-settings`, `mkeditor-export-settings`, `mkeditor-content`). Sidebar collapsed by default, "delete content" button shown in the toolbar. Exports use the File System Access API or `window.open` + `print()` for PDF.

Mode branching lives in [index.ts](src/browser/index.ts), [EditorManager](src/browser/core/EditorManager.ts), [SettingsProvider](src/browser/core/providers/SettingsProvider.ts), [ExportSettingsProvider](src/browser/core/providers/ExportSettingsProvider.ts), and a few React components that conditionally render desktop-only chrome.

## IPC Bridge Model

Channels are whitelisted in [preload.ts](src/app/preload.ts:15-53):

- **Renderer → Main** (`to:*`): `to:title:set`, `to:editor:state`, `to:settings:save`, `to:html:export`, `to:pdf:export`, `to:file:*`, `to:folder:*`, `to:i18n:set`.
- **Main → Renderer** (`from:*`): `from:theme:set`, `from:settings:set`, `from:file:*`, `from:folder:*`, `from:modal:open`, `from:command:palette`, `from:notification:display`, `from:path:*`, `from:i18n:set`.

Additionally `window.mked` exposes synchronous/invoke helpers for the `mked://` link provider, app locale, and path resolution. `window.logger` forwards renderer logs to `electron-log` via an `ipcMain.on('log', …)` handler in [AppBridge.ts](src/app/lib/AppBridge.ts).

Notifications cross the bridge as `{ status, key, values? }` (i18n) or `{ status, message }` (plain). [BridgeListeners.ts](src/browser/core/BridgeListeners.ts) translates and surfaces them via `sonnerToast` (the sonner `<Toaster />` in `<App>`).

## Renderer Composition Root

[src/browser/index.ts](src/browser/index.ts) wires the system at boot:

1. Register FontAwesome icons ([icons.ts](src/browser/icons.ts)) and pre-build the (now tiny) i18n binding for the splash `<h1>` ([i18n.ts](src/browser/i18n.ts)).
2. Initialise i18n with the user's locale (prefetch combined bundle, set `<html lang>` early, apply translations on load).
3. Construct an [EditorDispatcher](src/browser/events/EditorDispatcher.ts) and an [EditorManager](src/browser/core/EditorManager.ts) — Monaco is **not** created yet; that's `<EditorHost>`'s job inside the React tree.
4. `createRoot(#react-root).render(<App initialManagers onEditorReady />)` mounts the full provider tree synchronously, including the `<ModalsBridge>` / `<PromptsBridge>` / `<PropertiesBridge>` sentinels that install module-level seams.
5. `<EditorHost>`'s `useEffect` calls `editorManager.create({mount, watch:true})` once, then fires `onReady()`.
6. `onEditorReady` (in `index.ts`) attaches providers (`SettingsProvider`, `ExportSettingsProvider`, `CommandProvider`, `CompletionProvider`) and, on desktop, constructs `BridgeManager` (with its `FileManager` + `FileTreeManager`), wires `setPersistHandler` callbacks from each settings provider into `bridgeManager.saveSettingsToFile`, and pushes the updated managers back into React state via `setReactManagers`. The splash fades out.

## Manager / React Separation

The governing rule: **Managers own data and IPC. React owns UI and presentation.**

- Managers under [src/browser/core/](src/browser/core/) (`EditorManager`, `FileManager`, `FileTreeManager`, `BridgeManager`, providers, `Markdown`, `HTMLExporter`) and seam files at [src/browser/](src/browser/) (`dom.ts`, `notify.ts`, `splash.ts`, `util.ts`, `i18n.ts`) do **not** import React or Radix.
- React components under [src/browser/react/](src/browser/react/) do **not** import `ipcRenderer`, touch `window.executionBridge`, or read/write `localStorage` directly.
- Reactive manager state crosses the boundary via `subscribe(listener) → unsubscribe` + `getSnapshot()` (stable reference between emits). React contexts (`FilesContext`, `FileTreeContext`, `SettingsContext`, `ExportSettingsContext`) pull through `useSyncExternalStore`.
- Imperative cross-boundary calls (e.g., `BridgeListeners.from:modal:open` opening a React Dialog, `FileManager.closeTab` opening a React confirm) go through module-level `*External` functions registered by React at mount time:
  - `openModalExternal` (ModalsContext)
  - `openPromptExternal` / `confirmExternal` / `promptExternal` (PromptsContext)
  - `showPropertiesExternal` (PropertiesContext)
  - `sonnerToast` (`src/browser/notify.ts`)

When adding new cross-boundary functionality, follow this same seam pattern — don't add new imports from `react/` into `core/`.

## Core Subsystems (renderer)

- [EditorManager](src/browser/core/EditorManager.ts) — owns the single Monaco instance; watch loop fires `dispatcher.render()` (~150ms after a change) to trigger `<PreviewPane>` re-render and word/character count recompute.
- [Markdown](src/browser/core/Markdown.ts) — markdown-it instance with `AlertBlock`, `LineNumber`, `LinkTarget`, `ImageStyle`, `TableStyle`, KaTeX, and highlight.js (specific languages registered eagerly).
- [FileManager](src/browser/core/FileManager.ts) — open file tabs (`Map<path, ITextModel>`), drag-to-reorder via `reorderTabs`, close-with-unsaved-prompt via `openPromptExternal`, untitled counter.
- [FileTreeManager](src/browser/core/FileTreeManager.ts) — explorer tree model + lazy-load via bridge. React `<FileTreePanel>` renders from the snapshot.
- [BridgeManager](src/browser/core/BridgeManager.ts) — wires FileManager/FileTreeManager into IPC.
- [BridgeListeners](src/browser/core/BridgeListeners.ts) — central place where `from:*` channels mutate renderer state (modals, properties, notifications, files, theme, settings, i18n).
- [HTMLExporter](src/browser/core/HTMLExporter.ts) — builds standalone HTML (with optional CDN-linked Bootstrap/FontAwesome/highlight.js/KaTeX for the **export**), strips internal scroll-sync attrs, exports via Electron save dialog or web File System Access API.
- Providers in [core/providers/](src/browser/core/providers/):
  - `SettingsProvider` — Monaco options + `<body data-theme>` flip + Monaco theme. Exposes `subscribe`/`getSnapshot`/`updateSetting` + `setPersistHandler(fn)`.
  - `ExportSettingsProvider` — live preview style sync + debounced persist (same observable surface).
  - `CommandProvider` — Monaco actions + chord keys (`Ctrl+L → P` etc.). The toolbar registers `setOpenDropdown(fn)` so CommandProvider can open the Popover for chord-mode.
  - `CompletionProvider` — regex-triggered fenced-block proposals + auto-list continuation.
  - `MkedLinkProvider` — resolves `*.md` relative links to `mked://open?path=…`.

## Core Subsystems (main process)

- [main.ts](src/app/main.ts) — single-instance lock, log truncation, autoUpdater, `mked://` protocol scheme registration, BrowserWindow with `contextIsolation: true` + `nodeIntegration: false`, system tray, `did-finish-load` sends theme + settings + opens initial file.
- [AppBridge](src/app/lib/AppBridge.ts) — `ipcMain.on(...)` for every `to:*` channel; delegates to `AppStorage`/`AppSettings`. Also handles `mked://` URL parsing.
- [AppStorage](src/app/lib/AppStorage.ts) — file/folder CRUD, save dialogs, PDF generation via offscreen `BrowserWindow.printToPDF`, directory tree builder (filters `.md` and directories).
- [AppSettings](src/app/lib/AppSettings.ts) — `~/.mkeditor/settings.json` load/validate/merge-defaults/save.
- [AppMenu](src/app/lib/AppMenu.ts) — application menu and tray menu. Menu items send `from:*` channels that the renderer turns into actions.

## Build & Run

- `npm run build-editor` — generates [src/browser/version.ts](src/browser/version.ts) from `package.json#version`, combines locales, runs webpack ([webpack.config.js](webpack.config.js)). Output: `dist/`.
- `npm run build-app` — `tsc` over `src/app/*.ts` into `dist/app/`.
- `npm run serve-web` — http-server on `dist/`.
- `npm run serve-app` — `electron .` (uses `dist/app/main.js`).
- `npm run make-installer` — clean → build editor → build app → `electron-builder` (output in `releases/<platform>/<arch>/`).
- `npm test` — Jest, jsdom env, with mocks for `electron`/`monaco-editor`/CSS.
- `npm run lint` — ESLint flat config ([eslint.config.mjs](eslint.config.mjs)) on `src`.

## i18n

13 supported locales (en, de, es, fr, it, nl, pt, ru, uk, tr, zh, ja, ko). Build combines per-namespace JSON into `all.json` per locale; loader prefers `all.json` and falls back to per-namespace fetches. Main process never runs i18next — it sends i18n keys to the renderer instead. The legacy `data-i18n-*` walker remains in [i18n.ts](src/browser/i18n.ts) only for the splash `<h1>`; React components translate via `useTranslation`.

## Conventions Worth Knowing

- **Manager/React separation.** See the section above. New cross-boundary functionality goes through the established seam pattern.
- **Single Monaco instance.** Only `EditorManager.create(...)` calls `editor.create(...)`; `<EditorHost>`'s `useEffect` has `[]` deps so it never re-mounts.
- **Reactive provider surface.** Any state that React needs to render is exposed by its owning manager as `subscribe`/`getSnapshot`. Don't duplicate manager state in React component state.
- **shadcn copy-in pattern.** UI primitives live in [src/browser/react/components/ui/](src/browser/react/components/ui/). When adding a new Radix-backed primitive, copy the existing minimal wrapper style (forwardRef + `cn(...)` + theme tokens).
- **Tailwind theme tokens.** Light + `[data-theme='dark']` definitions in [tailwind.css](src/browser/react/styles/tailwind.css). `--primary` is the MKEditor brand teal (#519088).
- **Providers are attached imperatively** via `manager.provide(key, instance)` in `onEditorReady`. The provider maps live in [interfaces/Providers.ts](src/browser/interfaces/Providers.ts).
- **Mode flag.** Every persistence-touching subsystem takes `mode: 'web' | 'desktop'`. Avoid sprinkling `if (window.executionBridge)` checks.
- **File tree filter.** `readDirectory` returns only `.md` files and directories.
- **CSP-safe `mked://` protocol** is registered as privileged in main.ts and handled in [AppBridge.handleMkedUrl](src/app/lib/AppBridge.ts) — opens a linked markdown doc in a new tab inside the running instance.
- **Logging**: renderer calls `window.logger.info(...)` → preload `ipcRenderer.send('log', …)` → main forwards to electron-log. Log file at `~/.mkeditor/main.log`, truncated on each launch.
- **Exported HTML still CDN-loads Bootstrap.** The markdown-it extensions emit Bootstrap class names (`alert alert-info`, `img-fluid`, `table table-sm ...`) for the exported document. The bundled renderer no longer ships Bootstrap CSS; the live preview gets minimal fallback styling in `_preview.scss`.

## Planned Direction

The React migration is complete. Subsequent UI/UX iteration and a DI/wiring cleanup are open follow-ups. See [docs/ROADMAP.md](docs/ROADMAP.md) for current status and open questions.
