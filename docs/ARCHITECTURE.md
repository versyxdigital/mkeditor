# MKEditor — Architecture

This document describes how MKEditor is put together internally: how the two execution contexts (Electron main + renderer) interact, what each subsystem owns, and the data flows for the main user journeys (boot, edit/preview, save, open, export, settings change, language change). For a quick orientation see [CLAUDE.md](../CLAUDE.md); for build/run see [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. High-Level Picture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          Electron Main Process                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ main.ts  │  │ AppMenu  │  │ AppSettings  │  │ AppStorage             │ │
│  │  - BW    │  │  - tray  │  │  - load/save │  │  - file dialogs        │ │
│  │  - logs  │  │  - menu  │  │  - merge     │  │  - PDF print (offscr.) │ │
│  │  - auto- │  └─────┬────┘  │  - notify    │  │  - dir tree            │ │
│  │   update │        │       └──────┬───────┘  │  - rename/delete/props │ │
│  │  - mked://       v               v          └──────────┬─────────────┘ │
│  └────┬─────┘   ┌───────────────────────────────────────┐ │               │
│       │         │              AppBridge                │<┘               │
│       │         │  ipcMain.on(to:*)  ipcMain.handle(*)  │                 │
│       │         └──┬─────────────────────────────────┬──┘                 │
│       │            │ from:* (webContents.send)       │                    │
└───────┼────────────┼─────────────────────────────────┼────────────────────┘
        │            v                                 │  IPC (whitelisted)
        │   ┌─────────────────────────────────────────┐│
        │   │             preload.ts (isolated)       ││
        │   │  exposes:  window.executionBridge       ││
        │   │            window.mked  window.logger   ││
        │   └────────────────────┬────────────────────┘│
        │                        │                     │
┌───────┼────────────────────────┼─────────────────────┼────────────────────┐
│       │       Renderer Process │ (Chromium + bundled webpack output)      │
│       │                        v                                          │
│       │   ┌──────────────────────────────────────────┐                    │
│       │   │              index.ts (boot)             │                    │
│       │   │  icons → i18n → Dispatcher → Editor      │                    │
│       │   │  → Providers → (BridgeManager if desk.)  │                    │
│       │   └──┬───────────────┬───────────────────────┘                    │
│       │      │               │                                            │
│       │      v               v                                            │
│  ┌────┴─────────────┐   ┌────────────────────┐    ┌────────────────────┐  │
│  │  EditorManager   │   │ BridgeManager      │    │ Providers          │  │
│  │  - Monaco (1)    │   │  - FileManager     │    │  - Settings        │  │
│  │  - render→preview│   │  - FileTreeManager │    │  - ExportSettings  │  │
│  │  - watch loop    │   │  - registerListn.. │    │  - Commands        │  │
│  └─────────┬────────┘   └─────────┬──────────┘    │  - Completion      │  │
│            │                      │               │  - MkedLink        │  │
│            v                      v               └──────┬─────────────┘  │
│      ┌─────────────────────────────────────────────────┐ │                │
│      │                  dom.ts (singleton refs)        │<┘                │
│      └─────────────────────────────────────────────────┘                  │
│                                                                           │
│   Markdown (markdown-it + extensions)  ─►  preview innerHTML              │
│   HTMLExporter (CDN-styled)            ─►  to:html / to:pdf or web export │
└───────────────────────────────────────────────────────────────────────────┘
```

## 2. Process Boundaries

### Main process (`src/app/`)
Runs Node. Owns:
- `BrowserWindow` lifecycle, single-instance lock, OS file associations (`.md`), tray, app menu.
- `~/.mkeditor/settings.json` (read/write/merge).
- File system access for the editor: open/save dialogs, open path, directory tree, create/rename/delete file or folder, properties.
- HTML export (writes the renderer-built HTML to disk) and PDF export (offscreen `BrowserWindow.printToPDF`).
- `mked://` custom protocol: registered as privileged in [main.ts](../src/app/main.ts:52-63); on a request, [AppBridge.handleMkedUrl](../src/app/lib/AppBridge.ts:257) parses `mked://open?path=…` and routes through `AppStorage.openActiveFile`.
- Auto-update polling via `electron-updater`. Update events propagate as `from:notification:display` toasts with i18n keys.
- `electron-log` to `~/.mkeditor/main.log` (truncated each launch).

### Renderer process (`src/browser/`)
Runs in Chromium with `contextIsolation: true` and `nodeIntegration: false`. Owns:
- Monaco editor + markdown-it preview.
- All UI state (tabs, file tree, settings UI, modals, splits, themes).
- i18n via i18next (loaded over `fetch`).
- Communicates with main *only* through whitelisted IPC channels via `window.executionBridge`.

### Preload (`src/app/preload.ts`)
Runs in an isolated world. Exposes three objects on `window`:
- `executionBridge` — `{ send, receive }` with whitelists for `to:*` (renderer → main) and `from:*` (main → renderer).
- `mked` — synchronous and invoke-style helpers used by the link provider, locale lookup, and path resolution.
- `logger` — forwards renderer logs to `electron-log` via `ipcRenderer.send('log', …)`.

The channel whitelists are the **canonical contract** between the two processes; see [preload.ts:15-53](../src/app/preload.ts#L15-L53).

## 3. Renderer Module Map

```
src/browser/
├── index.ts                       composition root
├── i18n.ts                        i18next bundle loader + DOM binding
├── icons.ts                       FontAwesome registry
├── dom.ts                         singleton DOM query map + tooltip/splash/split helpers
├── util.ts                        debounce, notify (toast mixin), getOSPlatform,
│                                  getExecutionBridge, selfRender, syncPreviewToExportSettings
├── config.ts                      default EditorSettings + ExportSettings
├── version.ts                     generated at build from package.json
│
├── views/index.html               base shell (all IDs read by dom.ts)
├── assets/                        SCSS, icons, intro.js (welcome markdown)
│
├── core/
│   ├── EditorManager.ts           Monaco lifecycle + render loop + watch
│   ├── Markdown.ts                markdown-it instance with all extensions
│   ├── FileManager.ts             tab model map + open/close/save plumbing
│   ├── FileTreeManager.ts         file tree DOM build + context menu trigger
│   ├── BridgeManager.ts           desktop-only orchestrator (FileManager + FileTreeManager)
│   ├── BridgeListeners.ts         registerBridgeListeners(): from:* dispatch
│   ├── ToolbarListeners.ts        registerUIToolbarListeners(): save/export buttons
│   ├── HTMLExporter.ts            CDN-styled standalone HTML export
│   ├── completion/                fenced block + list marker logic
│   ├── mappings/                  editor command table + explorer context menu items
│   └── providers/
│       ├── SettingsProvider.ts         Monaco options + DOM toggles + theme + persist
│       ├── ExportSettingsProvider.ts   live preview style + debounced persist
│       ├── CommandProvider.ts          Monaco actions, Bootstrap modals/dropdowns, chord keys
│       ├── CompletionProvider.ts       regex-triggered fenced block proposals
│       └── MkedLinkProvider.ts         markdown-relative-link → mked://
│
├── events/
│   ├── Dispatcher.ts              minimal EventTarget-like base
│   └── EditorDispatcher.ts        wraps it: render(), setTrackedContent(), bridgeSettings()
│
├── extensions/
│   ├── editor/{WordCount,ScrollSync}.ts
│   └── renderer/{AlertBlock,LineNumber,LinkTarget,ImageStyle,TableStyle}.ts
│
└── interfaces/
    ├── Bridge.ts        ContextBridgeAPI ({ send, receive })
    ├── Completion.ts    CompletionItem, Matcher
    ├── Dispatcher.ts    Dispatcher, ListenerEvent
    ├── Editor.ts        EditorSettings, ExportSettings, SettingsFile, EditorCommand
    ├── File.ts          File, FileProperties, RenamedPath
    └── Providers.ts     Providers/EditorProviders/BridgeProviders/ModalProviders/...
```

### Provider attachment

There are two "manager" classes, each with a generic `provide<T>(key, instance)` that mutates a typed map:

```ts
// EditorManager.providers: EditorProviders
//   bridge, commands, completion, settings, exportSettings

// BridgeManager.providers: BridgeProviders
//   settings, commands, completion, exportSettings
```

This is the only DI surface — there's no container. Order in [index.ts](../src/browser/index.ts) matters: providers are constructed, attached to the editor, then (desktop) the bridge is constructed and the *same* provider instances are re-attached to it.

### Custom event bus

[EditorDispatcher](../src/browser/events/EditorDispatcher.ts) is a tiny `EventTarget`-like that other modules use to decouple the editor watch loop from settings persistence and re-renders:
- `editor:render` — fired by `FileManager.activateFile`; handled in `EditorManager` to recompute counts + preview.
- `editor:track:content` — used to update the "originalValue" baseline that drives the "unsaved changes" star in the title bar.
- `editor:bridge:settings` — `SettingsProvider`/`ExportSettingsProvider` emit this on a user change; `BridgeManager` listens and forwards as `to:settings:save`.

There is no global event bus — every event flows through the single `EditorDispatcher` instance constructed in `index.ts`.

## 4. Key Data Flows

### 4.1 Boot (desktop)

```
main.ts (ready)
  ├─ create BrowserWindow + load dist/index.html
  ├─ instantiate AppSettings (reads/repairs ~/.mkeditor/settings.json)
  ├─ instantiate AppBridge.register() (binds ipcMain.on('to:*'))
  ├─ instantiate AppMenu.register() (sends from:* on menu clicks)
  ├─ build tray
  ├─ register mked:// scheme
  └─ on did-finish-load:
       send 'from:theme:set'    (system theme or stored darkmode)
       send 'from:settings:set' (the merged settings file)
       AppStorage.openActiveFile(context, file?)  → 'from:file:opened'

Renderer (index.ts)
  ├─ icons.ts registers FA glyphs
  ├─ initI18n(mode) — prepareBindings, prefetch combined bundle, init i18next,
  │                   apply translations, set <html lang>
  ├─ new EditorDispatcher
  ├─ new EditorManager({init:true, watch:true})
  │     → editor.create(...)
  │     → registerUIToolbarListeners(...)
  │     → onDidChangeModelContent → debounced bridge update + auto-list +
  │                                  CompletionProvider.suggestOnValidInput +
  │                                  setTimeout(render+counts, 150)
  ├─ attach SettingsProvider, ExportSettingsProvider, CommandProvider,
  │         CompletionProvider
  ├─ if desktop:
  │     api.receive('from:i18n:set', changeLanguage)
  │     new BridgeManager → registers from:* listeners
  │     attach providers to BridgeManager
  │     new MkedLinkProvider(mkeditor)
  │     editorManager.updateBridgedContent({init:true})
  └─ wire splits + sidebar + splash
```

### 4.2 Boot (web)

Same as above minus:
- No `executionBridge`, so `mode === 'web'`.
- Sidebar (`#sidebar`) hidden, delete-content button shown.
- `SettingsProvider`/`ExportSettingsProvider` read from `localStorage` instead of receiving via `from:settings:set`.
- `EditorManager` reads `mkeditor-content` from `localStorage` as initial editor content (falls back to `welcomeMarkdown`).
- `updateBridgedContent` writes back to `localStorage` on each debounced change.

### 4.3 Edit → preview render

1. User types in Monaco.
2. `onDidChangeModelContent` fires in [EditorManager.watch](../src/browser/core/EditorManager.ts:187).
3. Debounced `updateBridgedContent()` runs (~250ms) → desktop sends `to:editor:state` with `hasChanged` boolean; web writes content to `localStorage`.
4. `CompletionProvider.autoContinueListMarkers` runs synchronously if Enter was the last key.
5. `CompletionProvider.suggestOnValidInput` updates active proposal regex if user just typed `:::` or ```` ``` ````.
6. `setTimeout(..., 150)` updates word/character counts and calls `EditorManager.render`.
7. `render()` calls `Markdown.render(value)` and assigns to `dom.preview.dom.innerHTML`, then `refreshLines()` invalidates the ScrollSync line cache.
8. `LineNumber` extension stamped `class="has-line-data" data-line-start data-line-end` on rendered tokens so ScrollSync can find them.

### 4.4 Scroll sync

When `settings.scrollsync` is true and the editor scrolls:
1. `EditorManager.watch` reads `getVisibleRanges()[0].startLineNumber`.
2. Calls `ScrollSync(line, dom.preview.wrapper)`.
3. ScrollSync looks up the cached line elements (rebuilt on demand after a render), interpolates between two adjacent ones, and adjusts `preview.scrollTop`.

### 4.5 Save (desktop)

`Ctrl/Cmd+S` → AppMenu sends `from:file:save` with payload `'to:file:save'`.
- [BridgeListeners](../src/browser/core/BridgeListeners.ts:70) receives this, reads the current model + active file path, and replies on `to:file:save` with `{ content, file }`.
- `AppBridge` ipc handler calls `AppStorage.saveFile`, which writes the file synchronously and pushes `from:notification:display` (success/error key).
- The saved path is set as the active file → `from:file:opened` fires → renderer updates tab name + original tracker.

### 4.6 Save As / new untitled

Same chain but with `to:file:saveas` (no path). The user picks a path in the OS dialog; on success it's set as active and a `from:file:opened` is sent back.

### 4.7 Open file

- From the menu: AppMenu sends `from:file:open` → renderer sends `to:file:open` → `AppStorage.showOpenDialog` → on selection, `setActiveFile` → `from:file:opened`.
- From the file tree: click on a file in [FileTreeManager](../src/browser/core/FileTreeManager.ts:197) calls `openFileFromPath(path)` → `FileManager.openFileFromPath` → `to:file:openpath` → `AppStorage.openPath` (handles directory or file).
- From `mked://`: `MkedLinkProvider` resolves the relative `.md` link, calls `window.mked.openMkedUrl('mked://open?path=…')`, which sends an IPC message to the main process; the protocol handler routes back through `AppBridge.handleMkedUrl` → `AppStorage.openActiveFile`.
- From OS double-click / Open With: main process resolves the file from `process.argv` (Windows) or the `open-file` event (macOS) and routes through `AppStorage.openActiveFile`.

### 4.8 File tree workflow

- User clicks **Open Folder** in the menu or empty-tree context menu → `to:folder:open` → `AppStorage.openDirectory` → `from:folder:opened` with `{ path, tree }`.
- [FileTreeManager.buildFileTree](../src/browser/core/FileTreeManager.ts:49) clears the tree when receiving a new root, then builds nested `<ul>`/`<li>` nodes (directories first, sorted by name). Each directory is registered in `directoryMap` so that subsequent partial-tree updates can be inserted in place.
- Right-click → [getContextMenuItems](../src/browser/core/mappings/explorerContextMenu.ts:13) — items depend on whether you clicked empty space, a file, or a folder. Actions translate to `to:file:create`, `to:folder:create`, `to:file:rename`, `to:file:delete`, `to:file:properties`.
- Rename triggers `from:path:renamed` so that any open tab with the old path gets its model re-keyed in [BridgeListeners.ts:178-223](../src/browser/core/BridgeListeners.ts#L178-L223).

### 4.9 Export to HTML / PDF

Both go through [HTMLExporter.generateHTML](../src/browser/core/HTMLExporter.ts:110) which:
- Parses the preview's outerHTML via `DOMParser`.
- Strips internal line-tracking attributes (`data-line-start`, `data-line-end`, `has-line-data`).
- If `withStyles`, injects CDN `<link>`/`<script>` tags for Bootstrap, FontAwesome, highlight.js, KaTeX, plus inline overrides.
- Applies `fontSize`, `lineHeight`, `backgroundColor`, `color` from `ExportSettings`.

Desktop:
- HTML: `to:html:export` → `AppStorage.saveFile` (auto-detects HTML by the `<!DOCTYPE html>` prefix and changes filters/i18n keys).
- PDF: `to:pdf:export` → an offscreen `BrowserWindow` loads the HTML as a data URL, waits for fonts + images, calls `printToPDF`, then a save dialog.

Web:
- HTML: `HTMLExporter.webExport(html, 'text/html', '.html')` → `showSaveFilePicker` (File System Access API).
- PDF: opens a new window, writes HTML, waits for stylesheets to load, calls `print()`.

### 4.10 Settings change

DOM toggles in `#app-settings` are listened to by [SettingsProvider](../src/browser/core/providers/SettingsProvider.ts) — each handler updates Monaco options (or `<body data-theme>` for darkmode), then calls `persist()`:
- Web: writes the whole `EditorSettings` to `localStorage`.
- Desktop: emits `editor:bridge:settings` → [BridgeManager](../src/browser/core/BridgeManager.ts:72) sends `to:settings:save` → [AppSettings.saveSettingsToFile](../src/app/lib/AppSettings.ts:161) merges with the existing file, writes, and sends a success toast.

`ExportSettingsProvider` follows the same pattern but debounces (~250ms; ~400ms for the line-spacing slider) and dedupes against the last persisted JSON to avoid redundant writes. It also calls `syncPreviewToExportSettings` so the live preview reflects export styling immediately.

### 4.11 Language change

- User picks a locale in `#locale-setting`. SettingsProvider stores it and calls `window.setLanguage(lng)`.
- Web: this is bound directly to `changeLanguage(lng)`.
- Desktop: bound to `BridgeManager.setLanguage` → `to:i18n:set` → `AppBridge` re-broadcasts as `from:i18n:set` → renderer's bootstrap listener calls `changeLanguage(lng)`.
- `changeLanguage` loads the combined bundle for that locale (falls back to per-namespace fetches), switches i18next, then `applyTranslations` walks the pre-built bindings table and updates `textContent` / `title` / `placeholder`. `refreshTooltips` rebuilds Bootstrap tooltips.

## 5. Settings Schema

[`SettingsFile`](../src/app/interfaces/Settings.ts) (and the renderer mirror in [src/browser/interfaces/Editor.ts](../src/browser/interfaces/Editor.ts)):

```ts
interface EditorSettings {
  autoindent: boolean;
  darkmode: boolean;
  wordwrap: boolean;
  whitespace: boolean;
  minimap: boolean;
  systemtheme: boolean;
  scrollsync: boolean;
  locale: string;       // 'en','de','es','fr','it','nl','pt','ru','uk','tr','zh','ja','ko'
}

interface ExportSettings {
  withStyles: boolean;
  container: 'container' | 'container-fluid';
  fontSize: number;
  lineSpacing: number;
  background: string;   // hex
  fontColor: string;    // hex
}

interface SettingsFile extends EditorSettings {
  exportSettings: ExportSettings;
}
```

The defaults live in [AppSettings.settings](../src/app/lib/AppSettings.ts:31) (main) and [src/browser/config.ts](../src/browser/config.ts) (web). `AppSettings` repairs files missing keys via `deepMerge`/`hasAllKeys` ([src/app/util.ts](../src/app/util.ts)) on each boot — so adding a new setting is safe for existing users.

## 6. Markdown Pipeline

[Markdown](../src/browser/core/Markdown.ts) is a single shared markdown-it instance configured at import time:

| Order | Plugin                                    | Effect                                                                          |
|-------|-------------------------------------------|---------------------------------------------------------------------------------|
| init  | `MarkdownIt({ html, breaks, linkify })`   | Base parsing. `linkify` is locked down to require explicit protocols.            |
| 1     | [AlertBlock](../src/browser/extensions/renderer/AlertBlock.ts) | Registers 8 markdown-it-container types (`primary`, `success`, etc.) rendering Bootstrap alerts. Also tags `<a>` inside alerts with `alert-link`. |
| 2     | [LineNumber](../src/browser/extensions/renderer/LineNumber.ts) | Pushes `class="has-line-data"`, `data-line-start`, `data-line-end` on selected tokens (paragraph_open, image, code_block, fence, list_item_open). Required by ScrollSync. |
| 3     | [LinkTarget](../src/browser/extensions/renderer/LinkTarget.ts) | Adds `target="_blank"` to all `<a>`.                                              |
| 4     | [ImageStyle](../src/browser/extensions/renderer/ImageStyle.ts) | Adds `img-fluid` to `<img>`.                                                      |
| 5     | [TableStyle](../src/browser/extensions/renderer/TableStyle.ts) | Adds `table table-sm table-bordered table-striped` to `<table>`.                  |
| 6     | `@vscode/markdown-it-katex`               | LaTeX math, both inline (`$…$`) and block (`$$…$$`).                              |
| —     | `hljs.highlight` callback                 | Highlight.js for fenced code blocks (languages registered eagerly).               |

Custom extension protocol is described in [src/browser/extensions/README.md](../src/browser/extensions/README.md).

## 7. Build Pipeline

```
package.json scripts
├── prebuild      → writes src/browser/version.ts from package.json#version
├── build-editor  → prebuild → combine-locales.mjs → prettier → webpack
│                   produces dist/{index.html, mkeditor.bundle.js, mkeditor.bundle.css,
│                                  favicon.ico, icon.png, locale/, fonts/}
├── build-app     → compile-app.mjs → tsc src/app/*.ts → dist/app/
├── make-installer→ clean dist + releases → build-editor → build-app → electron-builder
├── serve-web     → http-server dist
├── serve-app     → electron .   (uses dist/app/main.js as main)
├── test          → jest (jsdom)
└── lint / prettier
```

Webpack config ([webpack.config.js](../webpack.config.js)):
- Single entry: `[src/browser/index.ts, scss/index.scss]`.
- Monaco bundled via `MonacoWebpackPlugin` with explicit `languages: ['markdown']` and a fixed feature allowlist (no full Monaco footprint).
- CopyWebpackPlugin pulls in icon assets, the HTML view, the `locale/` tree, and KaTeX fonts.
- HTML minimizer + Terser for production.

## 8. Tests

Lightweight Jest + jsdom suite under [tests/](../tests/):

| File                    | Covers                                                                         |
|-------------------------|--------------------------------------------------------------------------------|
| `app.test.ts`           | Asserts `BrowserWindow` is constructed on `app.ready`.                          |
| `bridge.test.ts`        | `BridgeManager` registers all expected `from:*` listeners and forwards correctly.|
| `editor.test.ts`        | `EditorManager` calls `monaco.editor.create` with the right options.           |
| `markdown.test.ts`      | `Markdown` produces alerts, target="_blank", responsive images, line markers, LaTeX, and resists fuzzy linkification. |
| `providers.test.ts`     | Providers attach to both `EditorManager` and `BridgeManager` correctly.        |

Mocks in [tests/__mocks__/](../tests/__mocks__/) stand in for `electron`, `monaco-editor`, and `sweetalert2`.

## 9. Notable Conventions and Gotchas

- **Centralised DOM**: every renderer module reads/writes the DOM via [dom.ts](../src/browser/dom.ts). If you change HTML in [views/index.html](../src/browser/views/index.html), update `dom.ts` (and likely the test fixtures in [tests/](../tests/)). 59 IDs flow through that file today.
- **No framework**: Bootstrap (modals, dropdowns, tooltips), SweetAlert2 (prompts/toasts), split.js (panes) are the entire "UI framework". DOM mutations are imperative.
- **Mode flag**: every persistence-touching subsystem takes `mode: 'web' | 'desktop'`. Avoid sprinkling `if (window.executionBridge)` checks elsewhere — go through the constructor flag.
- **Channel whitelists**: when you add a new IPC channel, you **must** add it to both lists in [preload.ts](../src/app/preload.ts) or it will silently no-op.
- **Notifications**: prefer `{ status, key: 'notifications:<key>', values }`. Plain-string `message` works but won't be localised.
- **File tree filter**: today `readDirectory` returns only `.md` files and directories. Other extensions are invisible to the explorer.
- **`from:file:opened` reuse**: opening a file when the only open tab is an untitled empty tab re-keys that tab in place rather than creating a second one ([BridgeListeners.ts:117-162](../src/browser/core/BridgeListeners.ts#L117-L162)).
- **Log truncation**: `main.log` is truncated on every Electron launch ([main.ts:28](../src/app/main.ts#L28)). Capture it before relaunching for repro.
- **PDF export on macOS**: auto-update is disabled without code signing; mac users are on manual downloads. PDF export uses an offscreen window — works fine without signing.
- **`mked://` only opens local `.md` files** that already appear in the open file tree ([MkedLinkProvider.ts:26-33](../src/browser/core/providers/MkedLinkProvider.ts#L26-L33)).
- **Welcome content**: first-run editor content comes from [src/browser/assets/intro.js](../src/browser/assets/intro.js); in web mode it's replaced once the user has written anything (persisted to `localStorage`).
- **i18n init quirk**: there's a TODO noting `i18next.init` fails on first load if combined bundle is loaded synchronously; the workaround is `prepareI18n(initialLng, false)` then `changeLanguage(lng)` ([i18n.ts:314-339](../src/browser/i18n.ts#L314-L339)).

## 10. Planned Direction

A React migration is on the roadmap to replace the current direct-DOM layer. No design has been committed yet; this document records that the current architecture is amenable to it because:

- All DOM access is funneled through one module ([dom.ts](../src/browser/dom.ts)), so the surface to replace is small and well-defined.
- The Monaco instance is created by `EditorManager` and reused everywhere; React would own the surrounding chrome, not the editor itself.
- Providers and bridge logic have no view-layer coupling — they manipulate Monaco options, IPC, and DOM through `dom.ts`.
- i18n is attribute-driven (`data-i18n-*`); a React layer can offer a hook + provider over the same i18next instance.
- Bootstrap components could be swapped one-by-one with a React UI library or retained behind thin wrappers.

When that work begins, this document should be updated with the chosen approach.
