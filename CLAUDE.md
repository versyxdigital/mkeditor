# MKEditor — Project Context

Electron-based markdown editor built around Monaco. Same TypeScript bundle runs as a desktop app (Electron wraps it) and as a pure web app (deployed to GitHub Pages). Current version: 3.6.0.

For deeper details see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For planned work see [docs/ROADMAP.md](docs/ROADMAP.md). **Active migration: [docs/REACT_MIGRATION.md](docs/REACT_MIGRATION.md) (React 19 + shadcn/ui) — consult before any renderer work. Execute via `/migrate-phase <N>` and `/migrate-review <N>` (see `.claude/commands/` and `.claude/agents/`); do not freelance phase work.** Subsystem READMEs: [src/app/README.md](src/app/README.md), [src/browser/README.md](src/browser/README.md), [src/browser/extensions/README.md](src/browser/extensions/README.md).

## Repo Layout

- [src/app/](src/app/) — Electron main process (Node). Compiled by `tsc` via [scripts/compile-app.mjs](scripts/compile-app.mjs) to `dist/app/`.
- [src/browser/](src/browser/) — Renderer (DOM + Monaco). Bundled by webpack to `dist/mkeditor.bundle.js` + `dist/mkeditor.bundle.css`.
- [locale/](locale/) — i18next JSON resources, one folder per language. Build step combines per-language JSON into `all.json` via [scripts/combine-locales.mjs](scripts/combine-locales.mjs).
- [tests/](tests/) — Jest + jsdom. Mocks for `electron`, `monaco-editor`, `sweetalert2` under [tests/**mocks**/](tests/__mocks__/).
- [@types/index.d.ts](@types/index.d.ts) — Global window augmentations (`window.executionBridge`, `window.mked`, `window.logger`, `window.setLanguage`).
- [build/](build/) — Installer resources (icons, license).

## Two Runtime Modes

The same renderer bundle detects which mode it's running in via [getExecutionBridge()](src/browser/util.ts#L101):

- **Desktop**: `window.executionBridge` is injected by the Electron preload ([src/app/preload.ts](src/app/preload.ts)). Settings persist to `~/.mkeditor/settings.json`. File tree sidebar visible. Files open through IPC.
- **Web**: no bridge. Settings + last-edited content go to `localStorage` (`mkeditor-settings`, `mkeditor-export-settings`, `mkeditor-content`). Sidebar hidden, "delete content" button shown. Exports use the File System Access API or `window.open` + `print()` for PDF.

Mode branching lives mostly in [index.ts](src/browser/index.ts), [EditorManager](src/browser/core/EditorManager.ts), [SettingsProvider](src/browser/core/providers/SettingsProvider.ts), and [ToolbarListeners.ts](src/browser/core/ToolbarListeners.ts).

## IPC Bridge Model

Channels are whitelisted in [preload.ts](src/app/preload.ts:15-53):

- **Renderer → Main** (`to:*`): `to:title:set`, `to:editor:state`, `to:settings:save`, `to:html:export`, `to:pdf:export`, `to:file:*`, `to:folder:*`, `to:i18n:set`.
- **Main → Renderer** (`from:*`): `from:theme:set`, `from:settings:set`, `from:file:*`, `from:folder:*`, `from:modal:open`, `from:command:palette`, `from:notification:display`, `from:path:*`, `from:i18n:set`.

Additionally `window.mked` exposes synchronous/invoke helpers for the `mked://` link provider, app locale, and path resolution (see preload.ts lines 94-102). `window.logger` forwards renderer logs to `electron-log` via an `ipcMain.on('log', …)` handler in [AppBridge.ts](src/app/lib/AppBridge.ts:57).

Notifications cross the bridge as `{ status, key, values? }` (i18n) or `{ status, message }` (plain). The renderer's [BridgeListeners.ts](src/browser/core/BridgeListeners.ts:238) translates and surfaces them via a SweetAlert2 toast.

## Renderer Composition Root

[src/browser/index.ts](src/browser/index.ts) wires the system at boot:

1. Register FontAwesome icons ([icons.ts](src/browser/icons.ts)) and pre-build i18n bindings ([i18n.ts](src/browser/i18n.ts:165-203)).
2. Initialise i18n with the user's locale (prefetch combined bundle, set `<html lang>` early, apply translations on load).
3. Construct an [EditorDispatcher](src/browser/events/EditorDispatcher.ts) (custom event bus) and an [EditorManager](src/browser/core/EditorManager.ts) — this creates the Monaco instance.
4. Attach providers to the editor: `SettingsProvider`, `ExportSettingsProvider`, `CommandProvider`, `CompletionProvider`.
5. Desktop only: attach `BridgeManager` (which spins up `FileManager` + `FileTreeManager` and `registerBridgeListeners`) and `MkedLinkProvider`.
6. Split panes via split.js, sidebar toggle, splash fade.

## Core Subsystems (renderer)

- [EditorManager](src/browser/core/EditorManager.ts) — owns the Monaco instance, listens for `editor:render`, drives preview rendering and watch loop (debounced bridge updates, scroll sync, auto-continue lists, word/character counts).
- [Markdown](src/browser/core/Markdown.ts) — markdown-it instance with `AlertBlock`, `LineNumber`, `LinkTarget`, `ImageStyle`, `TableStyle`, KaTeX, and highlight.js (specific languages registered eagerly).
- [FileManager](src/browser/core/FileManager.ts) — open file tabs (`Map<path, ITextModel>`), drag-to-reorder, close-with-unsaved-prompt, untitled counter.
- [FileTreeManager](src/browser/core/FileTreeManager.ts) — explorer tree, click-to-open, lazy-load directories, context menu.
- [BridgeManager](src/browser/core/BridgeManager.ts) — wires FileManager/FileTreeManager into IPC.
- [BridgeListeners](src/browser/core/BridgeListeners.ts) — central place where `from:*` channels mutate renderer state.
- [HTMLExporter](src/browser/core/HTMLExporter.ts) — builds standalone HTML (with optional CDN-linked Bootstrap/FontAwesome/highlight.js/KaTeX), strips internal scroll-sync attrs, exports via Electron save dialog or web File System Access API.
- Providers in [core/providers/](src/browser/core/providers/) — `SettingsProvider` (Monaco options + DOM toggles + theme), `ExportSettingsProvider` (preview live-styling + debounced persist), `CommandProvider` (Monaco actions + Bootstrap modals/dropdowns + chord keybindings from [mappings/editorCommands.ts](src/browser/core/mappings/editorCommands.ts)), `CompletionProvider` (regex-triggered fenced-block proposals + auto-list continuation), `MkedLinkProvider` (resolves `*.md` relative links to `mked://open?path=…`).
- [events/Dispatcher.ts](src/browser/events/Dispatcher.ts) — minimal custom event-target implementation; events are `editor:render`, `editor:track:content`, `editor:bridge:settings`, `message`.
- [dom.ts](src/browser/dom.ts) — centralised `querySelector` registry. **Every renderer module references DOM through this object.** When the DOM changes, only this file needs to be updated.

## Core Subsystems (main process)

- [main.ts](src/app/main.ts) — entry: single-instance lock, log truncation, autoUpdater, `mked://` protocol scheme registration, BrowserWindow with `contextIsolation: true` + `nodeIntegration: false`, system tray, `did-finish-load` sends theme + settings + opens initial file.
- [AppBridge](src/app/lib/AppBridge.ts) — `ipcMain.on(...)` for every `to:*` channel; delegates to `AppStorage`/`AppSettings`. Also handles `mked://` URL parsing.
- [AppStorage](src/app/lib/AppStorage.ts) — file/folder CRUD, save dialogs, PDF generation via offscreen `BrowserWindow.printToPDF`, directory tree builder (filters `.md` and directories).
- [AppSettings](src/app/lib/AppSettings.ts) — `~/.mkeditor/settings.json` load/validate/merge-defaults/save. Uses [deepMerge / hasAllKeys](src/app/util.ts) to repair partial files.
- [AppMenu](src/app/lib/AppMenu.ts) — application menu and tray menu. Menu items send `from:*` channels that the renderer turns into actions.

## Build & Run

- `npm run build-editor` — generates [src/browser/version.ts](src/browser/version.ts) from `package.json#version`, combines locales, runs Prettier, runs webpack ([webpack.config.js](webpack.config.js)). Output: `dist/`.
- `npm run build-app` — `tsc` over `src/app/*.ts` into `dist/app/`.
- `npm run serve-web` — http-server on `dist/`.
- `npm run serve-app` — `electron .` (uses `dist/app/main.js`).
- `npm run make-installer` — clean → build editor → build app → `electron-builder` (output in `releases/<platform>/<arch>/`).
- `npm test` — Jest, jsdom env, with mocks for `electron`/`monaco-editor`/`sweetalert2`.
- `npm run lint` — ESLint flat config ([eslint.config.mjs](eslint.config.mjs)) on `src`.

## i18n

13 supported locales (en, de, es, fr, it, nl, pt, ru, uk, tr, zh, ja, ko). Build combines per-namespace JSON into `all.json` per locale; loader prefers `all.json` and falls back to per-namespace fetches. DOM bindings via `data-i18n-text` / `data-i18n-title` / `data-i18n-placeholder` are collected in one pass at boot and applied synchronously. Main process never runs i18next — it sends i18n keys to the renderer instead. See [src/browser/i18n.ts](src/browser/i18n.ts).

## Conventions Worth Knowing

- **No frontend framework** — everything is direct DOM. All selectors flow through [dom.ts](src/browser/dom.ts). UI dynamism comes from Bootstrap (modals, dropdowns, tooltips), SweetAlert2 (prompts/toasts), and split.js (resizable panes).
- **Providers are attached imperatively** via `manager.provide(key, instance)`. The provider maps live in [interfaces/Providers.ts](src/browser/interfaces/Providers.ts) (renderer) and [src/app/interfaces/Providers.ts](src/app/interfaces/Providers.ts) (main).
- **Mode branches stay shallow** — most subsystems take `mode: 'web' | 'desktop'` and switch persistence only.
- **File tree filters to `.md` and directories** ([AppStorage.readDirectory](src/app/lib/AppStorage.ts:477)).
- **CSP-safe `mked://` protocol** is registered as privileged in main.ts and handled in [AppBridge.handleMkedUrl](src/app/lib/AppBridge.ts:257) — opens a linked markdown doc in a new tab inside the running instance.
- **Logging**: renderer calls `window.logger.info(...)` → preload `ipcRenderer.send('log', …)` → main forwards to electron-log. Log file at `~/.mkeditor/main.log`, truncated on each launch.

## Planned Direction

A React migration is on the roadmap to replace the current direct-DOM UI layer; a DI/wiring cleanup is also under discussion. Architecture today is friendly to those changes because (a) all DOM access funnels through [dom.ts](src/browser/dom.ts), (b) the Monaco instance, file managers, providers, and bridge are not coupled to view code, and (c) i18n bindings are attribute-based. See [docs/ROADMAP.md](docs/ROADMAP.md) for current status, open questions, and rough phasing.
