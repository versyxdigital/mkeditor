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
│       │   │  → mount <App> → onEditorReady wires     │                    │
│       │   │  Providers + (BridgeManager if desktop)  │                    │
│       │   └──┬───────────────┬──────────────┬────────┘                    │
│       │      │               │              │                             │
│       │      v               v              v                             │
│  ┌────┴─────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │
│  │  EditorManager   │  │ BridgeMgr    │  │ React tree (src/browser/     │ │
│  │  - Monaco (1)    │  │  - FileMgr   │  │   react/)                    │ │
│  │  - watch loop    │  │  - FileTreeMgr│ │  - App + Navbar + TabBar +   │ │
│  │  - dispatcher    │  │  - bridge    │  │    Workspace + EditorHost +  │ │
│  │    .render()     │  │    listeners │  │    PreviewPane + EditorToolbar│ │
│  └────────┬─────────┘  └──────┬───────┘  │  - 5 Modals + sonner Toaster │ │
│           │                   │          │  - Contexts wrap managers via│ │
│           v                   v          │    useSyncExternalStore      │ │
│   ┌──────────────────────────────────────│  - Module-level *External    │ │
│   │  Providers (Settings, ExportSettings,│    seams for non-React calls │ │
│   │  Commands, Completion, MkedLink)     └──────────────────────────────┘ │
│   │   - subscribe / getSnapshot / updateSetting / setPersistHandler       │ │
│   └────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│   Markdown (markdown-it + extensions)  ─►  PreviewPane #preview-content   │
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
- Communicates with main _only_ through whitelisted IPC channels via `window.executionBridge`.

### Preload (`src/app/preload.ts`)

Runs in an isolated world. Exposes three objects on `window`:

- `executionBridge` — `{ send, receive }` with whitelists for `to:*` (renderer → main) and `from:*` (main → renderer).
- `mked` — synchronous and invoke-style helpers used by the link provider, locale lookup, and path resolution.
- `logger` — forwards renderer logs to `electron-log` via `ipcRenderer.send('log', …)`.

The channel whitelists are the **canonical contract** between the two processes; see [preload.ts:15-53](../src/app/preload.ts#L15-L53).

## 3. Renderer Module Map

The renderer has two halves: the **managers** (data + IPC, no React) under `src/browser/core/` + the seam files in `src/browser/`, and the **React tree** (UI + presentation) under `src/browser/react/`.

```
src/browser/
├── index.ts                       composition root — mounts <App>, constructs managers,
│                                  wires the persist-handler callbacks
├── i18n.ts                        i18next bundle loader + data-i18n walker (splash only)
├── icons.ts                       FontAwesome registry
├── dom.ts                         small constant map (editor / preview / scroll meta) used by
│                                  non-React modules (HTMLExporter, ScrollSync, LineNumber)
├── notify.ts                      sonnerToast(level, msg) — neutral seam shared by React +
│                                  non-React callers (BridgeListeners)
├── splash.ts                      showSplashScreen + fade helpers (boot-time)
├── util.ts                        debounce, getExecutionBridge, syncPreviewToExportSettings
├── config.ts                      default EditorSettings + ExportSettings
├── version.ts                     generated at build from package.json
│
├── views/index.html               minimal shell: splash overlay, #react-root mount, bottom
│                                  <nav> with #editor-functions and #bottom-toolbar-right
│                                  portal hosts. All Tailwind-styled.
├── assets/                        SCSS partials (base, editor, preview, sidebar, tabs,
│                                  darkmode) + intro.ts (welcome markdown)
│
├── core/  (managers — data + IPC, no React)
│   ├── EditorManager.ts           Monaco lifecycle + watch loop (dispatches editor:render)
│   ├── Markdown.ts                markdown-it instance with all extensions
│   ├── FileManager.ts             tab model map + open/close (with prompt seam) + reorder
│   ├── FileTreeManager.ts         tree model + bridge plumbing (no DOM build now)
│   ├── BridgeManager.ts           desktop-only orchestrator (FileManager + FileTreeManager)
│   ├── BridgeListeners.ts         registerBridgeListeners(): from:* dispatch
│   ├── HTMLExporter.ts            CDN-styled standalone HTML export
│   ├── completion/                fenced block + list marker logic
│   ├── mappings/                  editor command table + explorer context menu items
│   └── providers/
│       ├── SettingsProvider.ts         Monaco options + theme; subscribe/getSnapshot/
│       │                              updateSetting + setPersistHandler
│       ├── ExportSettingsProvider.ts   live preview style + debounced persist (same surface)
│       ├── CommandProvider.ts          Monaco actions + chord keys (drives toolbar popovers
│       │                              via a registered setOpenDropdown callback)
│       ├── CompletionProvider.ts       regex-triggered fenced block proposals
│       └── MkedLinkProvider.ts         markdown-relative-link → mked://
│
├── events/
│   ├── Dispatcher.ts              minimal EventTarget-like base
│   └── EditorDispatcher.ts        wraps it: render(), setTrackedContent(), message()
│
├── extensions/
│   ├── editor/{WordCount,ScrollSync}.ts
│   └── renderer/{AlertBlock,LineNumber,LinkTarget,ImageStyle,TableStyle}.ts
│
├── interfaces/
│   ├── Bridge.ts        ContextBridgeAPI ({ send, receive })
│   ├── Completion.ts    CompletionItem, Matcher
│   ├── Dispatcher.ts    Dispatcher, ListenerEvent
│   ├── Editor.ts        EditorSettings, ExportSettings, SettingsFile, EditorCommand
│   ├── File.ts          File, FileProperties, RenamedPath
│   └── Providers.ts     Providers / EditorProviders / BridgeProviders
│
└── react/  (UI — React 19 + shadcn/ui + Tailwind v4)
    ├── App.tsx                    top-level composition: providers + chrome + modals
    ├── lib/utils.ts               cn() helper (shadcn default)
    ├── styles/tailwind.css        @tailwind + theme tokens (light + [data-theme='dark'])
    ├── hooks/
    │   ├── useTranslation.ts      thin i18next.on('languageChanged') wrapper
    │   ├── useCounts.ts           word/character count from editor:render
    │   └── useNotify.ts           re-exports sonnerToast from src/browser/notify.ts
    ├── contexts/
    │   ├── ManagersContext.tsx    provides editor / file / tree / bridge / providers
    │   ├── SettingsContext.tsx    useSyncExternalStore over SettingsProvider
    │   ├── ExportSettingsContext.tsx     same for ExportSettingsProvider
    │   ├── FilesContext.tsx       useSyncExternalStore over FileManager
    │   ├── FileTreeContext.tsx    useSyncExternalStore over FileTreeManager
    │   ├── UIStateContext.tsx     sidebar open/closed + toggle
    │   ├── ModalsContext.tsx      open/closeModal('settings'|'shortcuts'|...) + the
    │   │                          openModalExternal seam used by BridgeListeners +
    │   │                          CommandProvider keybindings
    │   ├── PromptsContext.tsx     Dialog-driven prompt/confirm; openPromptExternal /
    │   │                          confirmExternal / promptExternal seams used by
    │   │                          FileManager.closeTab + explorerContextMenu
    │   └── PropertiesContext.tsx  FileProperties modal state + showPropertiesExternal
    ├── components/
    │   ├── Navbar.tsx             top chrome (sidebar toggle, file name, counts, cog,
    │   │                          help) — shadcn Tooltip for icon hints
    │   ├── TabBar.tsx             native HTML5 DnD reorder; close button → FileManager
    │   ├── Sidebar.tsx, FileTreePanel.tsx     file explorer
    │   ├── Workspace.tsx          react-resizable-panels editor/preview split
    │   ├── EditorHost.tsx         Monaco mount (single useEffect, never re-mounted)
    │   ├── EditorToolbar.tsx      shadcn Button toolbar (bold/italic/lists/...);
    │   │                          alert/code/tables Popovers
    │   ├── PreviewPane.tsx        subscribes to editor:render; writes Markdown.render
    │   │                          into #preview-content innerHTML
    │   ├── BottomToolbarRight.tsx darkmode shadcn Switch + build chip → AboutModal
    │   ├── Icon.tsx               FontAwesome SVG wrapper (no MutationObserver)
    │   ├── modals/
    │   │   ├── SettingsModal.tsx       shadcn Switch/Select/Checkbox/Input
    │   │   ├── ExportSettingsModal.tsx same
    │   │   ├── AboutModal.tsx, ShortcutsModal.tsx, PropertiesModal.tsx
    │   └── ui/                    shadcn copy-in primitives (Dialog, ContextMenu,
    │                              DropdownMenu, Popover, Tooltip, Switch, Select,
    │                              Checkbox, Input, Label, Button)
```

### Provider attachment

There are two "manager" classes, each with a generic `provide<T>(key, instance)` that mutates a typed map:

```ts
// EditorManager.providers: EditorProviders
//   bridge, commands, completion, settings, exportSettings

// BridgeManager.providers: BridgeProviders
//   settings, commands, completion, exportSettings
```

This is the only DI surface — there's no container. Order in [index.ts](../src/browser/index.ts) matters: providers are constructed, attached to the editor, then (desktop) the bridge is constructed and the _same_ provider instances are re-attached to it.

After the bridge is up, the composition root calls `settings.setPersistHandler(s => bridgeManager.saveSettingsToFile(s))` and the same for `exportSettings` — providers persist directly through a callback rather than firing an event.

### Manager ↔ React seam

Managers do not import React or Radix; React does not own data or IPC. The two sides communicate through three patterns:

1. **`useSyncExternalStore` over a manager observable surface.** Each manager exposing reactive state implements `subscribe(listener) → unsubscribe` + `getSnapshot()` returning a stable reference (only re-built on emit). `FilesContext`, `FileTreeContext`, `SettingsContext`, `ExportSettingsContext` all read this way; React re-renders only on emits.
2. **Module-level callback seams (`*External` functions).** Non-React callers reach the React tree through plain functions: `openModalExternal`, `openPromptExternal` / `confirmExternal` / `promptExternal`, `showPropertiesExternal`, `sonnerToast`. Each is a `let` in its owning module that React's `<App>` installs at first render via a one-off `register*` call inside a sentinel component. `BridgeListeners.from:modal:open`, `from:path:properties`, `from:notification:display`, `FileManager.closeTab`, and the explorer context-menu actions all use these.
3. **Imperative refs.** The shared `workspaceGroupRef` (`react-resizable-panels` Group) is passed from `<App>` to both `<Workspace>` and `<EditorToolbar>` so the split-reset button can call `setLayout({...})` without a DOM bridge.

### Custom event bus

[EditorDispatcher](../src/browser/events/EditorDispatcher.ts) is a tiny `EventTarget`-like that decouples Monaco's watch loop from the React tree:

- `editor:render` — fired by `EditorManager.watch` after a debounced re-render tick + by `FileManager.activateFile`; consumed by `<PreviewPane>` (writes `Markdown.render(...)` into `#preview-content.innerHTML`) and `useCounts` (recomputes word/character counts in the navbar).
- `editor:track:content` — fired when a file save / open updates the baseline; consumed by `EditorManager`'s watch loop to compare against current value.
- `message` — kept for completeness; not currently used in the React tree.

`editor:bridge:settings` was dropped in Phase 9 — settings persist via the `setPersistHandler` callback described above.

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
  │                   apply translations (splash <h1>), set <html lang>
  ├─ new EditorDispatcher
  ├─ new EditorManager({mode, dispatcher})  (no Monaco yet — that's <EditorHost>'s job)
  ├─ createRoot(#react-root).render(<App initialManagers={...} onEditorReady=…/>)
  │     React mounts the full provider tree synchronously; <ModalsBridge>,
  │     <PromptsBridge>, <PropertiesBridge> install the module-level seams.
  ├─ <EditorHost> useEffect runs:
  │     editorManager.create({mount, watch:true})  → monaco.editor.create(...)
  │     onReady() callback fires…
  └─ onEditorReady() in index.ts:
       ├─ provide SettingsProvider, ExportSettingsProvider, CommandProvider,
       │         CompletionProvider on editorManager
       ├─ desktop only:
       │   ├─ new BridgeManager → registers from:* listeners
       │   ├─ attach providers to BridgeManager
       │   ├─ wire settings.setPersistHandler(s => bridge.saveSettingsToFile(s))
       │   │  and the same for exportSettings
       │   ├─ new MkedLinkProvider(mkeditor)
       │   ├─ editorManager.updateBridgedContent({init:true})
       │   └─ override window.setLanguage to flow through the bridge
       └─ setReactManagers(prev => ({...prev, bridgeManager, fileManager, ...}))
           ↑ pushes the now-attached providers back into React state so
             SettingsContext / ExportSettingsContext / FilesContext re-
             subscribe with the live managers.
       └─ showSplashScreen({duration:750}) — fades splash + bottom nav in.
```

### 4.2 Boot (web)

Same as above minus:

- No `executionBridge`, so `mode === 'web'`.
- React renders the sidebar collapsed by default (`initialSidebarOpen = false`); delete-content button shown in `<EditorToolbar>`.
- `SettingsProvider`/`ExportSettingsProvider` read from `localStorage` instead of receiving via `from:settings:set`. Neither has a registered `persistHandler` — `persist()` falls through to localStorage.
- `EditorManager` reads `mkeditor-content` from `localStorage` as initial editor content (falls back to `welcomeMarkdown`).
- `updateBridgedContent` writes back to `localStorage` on each debounced change.
- `onEditorReady` still calls `setReactManagers(prev => ({...prev}))` to force a React re-read so the now-attached providers wire through to `SettingsContext` / `ExportSettingsContext`.

### 4.3 Edit → preview render

1. User types in Monaco.
2. `onDidChangeModelContent` fires in [EditorManager.watch](../src/browser/core/EditorManager.ts).
3. Debounced `updateBridgedContent()` runs (~250ms) → desktop sends `to:editor:state` with `hasChanged` boolean; web writes content to `localStorage`.
4. `CompletionProvider.autoContinueListMarkers` runs synchronously if Enter was the last key.
5. `CompletionProvider.suggestOnValidInput` updates active proposal regex if user just typed `:::` or ` ``` `.
6. `setTimeout(..., 150)` fires `dispatcher.render()`.
7. `<PreviewPane>` subscribes to `editor:render` and writes `Markdown.render(value)` into `#preview-content.innerHTML`, then calls `refreshLines()` to invalidate the ScrollSync line cache.
8. `useCounts` (in `<Navbar>`) also subscribes to `editor:render` and recomputes word/character counts from the latest editor value.
9. `LineNumber` extension stamped `class="has-line-data" data-line-start data-line-end` on rendered tokens so ScrollSync can find them.

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
- [FileTreeManager.buildFileTree](../src/browser/core/FileTreeManager.ts) updates its in-memory snapshot when receiving a new root or partial subtree, sorted directories-first by name. Each directory is registered in `directoryMap` so subsequent partial updates can be merged in place. Snapshot emit drives a React re-render via `FileTreeContext`.
- `<FileTreePanel>` renders the tree from `FileTreeContext`; expand state lives in component-local React state. Lazy-loading fires `fileTreeManager.requestDirectoryContents(path)` on first expand of a `hasChildren && !loaded` directory.
- Right-click on any row populates `contextNode` from the closest `<li[data-path]>` and feeds it to [getContextMenuItems](../src/browser/core/mappings/explorerContextMenu.ts) inside a single top-level Radix `<ContextMenu>` wrapper. Items depend on whether you clicked empty space, a file, or a folder. Actions translate to `to:file:create`, `to:folder:create`, `to:file:rename`, `to:file:delete`, `to:file:properties`. Prompt + confirm flows go through `promptExternal` / `confirmExternal` (`PromptsContext`).
- Rename triggers `from:path:renamed` so that any open tab with the old path gets its model re-keyed in [BridgeListeners.ts](../src/browser/core/BridgeListeners.ts).

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

`<SettingsModal>` consumes `SettingsContext` and drives each control through `updateSetting(key, value)`:

1. `updateSetting` writes `currentSettings[key] = value`.
2. `applyOne(key)` runs the matching side effect — Monaco option update (`autoindent`, `minimap`, `wordwrap`, `whitespace`), `<body data-theme>` flip + `editor.setTheme('vs'|'vs-dark')` for `darkmode`, or `window.setLanguage(...)` for `locale`.
3. `emit()` rebuilds the snapshot reference and notifies subscribers — `useSyncExternalStore` triggers a React re-render in any consumer of `SettingsContext` (the modal itself, the bottom-toolbar darkmode switch).
4. `persist()` writes to localStorage (web) or calls the registered `persistHandler` (desktop) which routes to `bridgeManager.saveSettingsToFile` → `to:settings:save` → [AppSettings.saveSettingsToFile](../src/app/lib/AppSettings.ts:161) merges with the existing file, writes, and sends a success toast.

`ExportSettingsProvider` follows the same pattern but debounces (~250ms; ~400ms for the line-spacing slider) and dedupes against the last persisted JSON to avoid redundant writes. It also calls `syncPreviewToExportSettings` so the live preview reflects export styling immediately.

### 4.11 Language change

- User picks a locale in the Settings modal's `<Select>`. `SettingsContext.updateSetting('locale', code)` triggers `SettingsProvider.applyOne('locale')` which calls `window.setLanguage(code)`.
- Web: this is bound directly to `changeLanguage(lng)`.
- Desktop: bound to `BridgeManager.setLanguage` → `to:i18n:set` → `AppBridge` re-broadcasts as `from:i18n:set` → renderer's bootstrap listener calls `changeLanguage(lng)`.
- `changeLanguage` loads the combined bundle for that locale (falls back to per-namespace fetches), switches i18next, then `applyTranslations` walks the (now tiny) bindings table — only the splash `<h1>` still uses `data-i18n-text`. React components re-render through `useTranslation` (which subscribes to i18next's `languageChanged` event).

### 4.12 Session restore

Open tabs, the active tab, and per-tab Monaco view state (cursor, selection, scroll, folding) persist across app launches.

**Persistence surface.** Desktop writes `~/.mkeditor/session.json` via [AppSession](../src/app/lib/AppSession.ts) (sibling to `AppSettings`). The write is **atomic**: payload goes to `session.json.tmp`, then `fs.renameSync` swaps it into place. A power loss during the write leaves either the prior file intact or the new one — never a truncated mix. Web is symmetric via `localStorage['mkeditor-session']` (Phase 3).

**Payload shape** (renderer side, [Session.ts](../src/browser/interfaces/Session.ts)):

```ts
interface SessionPayload {
  version: 1;
  tabs: SessionTab[];              // insertion order = tab order
  activeFile: string | null;       // must match a tabs[].path or be null
  workspaceRoot: string | null;    // desktop only; re-walked on restore
}

interface SessionTab {
  path: string;                                  // real path or `untitled-N`
  name: string;
  viewState: editor.ICodeEditorViewState | null;
  untitledContent?: string;                      // inlined for untitled only, non-empty
}
```

**Save cadence.** Structural-event-driven. [`FileManager.scheduleSessionSave()`](../src/browser/core/FileManager.ts) is a 300 ms debounced trigger called from `addTab`, `closeTab`, `activateFile`, `reorderTabs`, `renameTab`, `replaceUntitled`, and (from [BridgeListeners](../src/browser/core/BridgeListeners.ts)) the first `from:folder:opened` event for a new workspace root. It captures the active tab's current `saveViewState()` at write time (the prior tab's state is already cached on switch-out). No keystroke-level writes — the worst-case crash loss is the active-at-crash tab's cursor position; everything else was captured on the last tab switch.

**Workspace root.** `serializeSession` reads `FileTreeManager.treeRoot` through a getter injected by `BridgeManager` (`fileManager.setWorkspaceRootGetter`) — FileManager doesn't take a direct dependency on FileTreeManager. On restore, after `restoreSession` replays tabs, `BridgeListeners` sends `to:file:openpath` for the persisted root; main's `AppStorage.openPath` reads the directory and dispatches the normal `from:folder:opened` which re-populates the tree. A folder that no longer exists is nulled out by `AppSession.buildRestoreEnvelope` before the envelope ships.

**Quit flush.** `app.on('before-quit')` in [main.ts](../src/app/main.ts) sends `from:session:flush-request` to the renderer and waits up to 250 ms for a `to:session:save` ack. The renderer's listener in [BridgeListeners](../src/browser/core/BridgeListeners.ts) calls `serializeSession()` synchronously and ships the result; main hits `AppSession.save()` and lets quit proceed.

**Restore.** At `did-finish-load`, main calls `AppSession.buildRestoreEnvelope(AppSession.load())` and sends `from:session:restore` with a [`SessionRestoreEnvelope`](../src/app/interfaces/Session.ts):

```ts
interface SessionRestoreEnvelope {
  session: SessionPayload | null;
  missing: string[];                  // real paths that no longer exist
  contents: Record<string, string>;   // pre-loaded file contents for kept tabs
}
```

Main pre-validates real-file paths against the filesystem, drops missing ones from `session.tabs`, lists them in `missing`, and reads contents for survivors. The renderer's [`FileManager.restoreSession`](../src/browser/core/FileManager.ts) replays everything synchronously — no per-file IPC round-trip — then activates the previously-active tab and `restoreViewState`s it. Untitled tabs are recreated from `untitledContent`. The `untitledCounter` advances past any restored synthetic id so newly-created scratch tabs don't collide.

`restoreSession` is idempotent (one-shot per FileManager instance) and `restoring` is flag-suppressed during replay so the debounced save trigger doesn't immediately echo the session back to disk.

**Missing-file toast.** `BridgeListeners` surfaces one consolidated sonner toast via `notifications:session_file_missing` (with `{{files}}` interpolation) when `envelope.missing.length > 0` — never per-file noise.

**IPC channels** (whitelisted in [preload.ts](../src/app/preload.ts)):

| Channel                       | Direction         | Payload                     | Purpose                                |
| ----------------------------- | ----------------- | --------------------------- | -------------------------------------- |
| `to:session:save`             | renderer → main   | `SessionPayload`            | Debounced + final-flush persist        |
| `from:session:restore`        | main → renderer   | `SessionRestoreEnvelope`    | Boot-time replay payload               |
| `from:session:flush-request`  | main → renderer   | none                        | "Send me your final session, now"      |

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
  locale: string; // 'en','de','es','fr','it','nl','pt','ru','uk','tr','zh','ja','ko'
}

interface ExportSettings {
  withStyles: boolean;
  container: 'container' | 'container-fluid';
  fontSize: number;
  lineSpacing: number;
  background: string; // hex
  fontColor: string; // hex
}

interface SettingsFile extends EditorSettings {
  exportSettings: ExportSettings;
}
```

The defaults live in [AppSettings.settings](../src/app/lib/AppSettings.ts:31) (main) and [src/browser/config.ts](../src/browser/config.ts) (web). `AppSettings` repairs files missing keys via `deepMerge`/`hasAllKeys` ([src/app/util.ts](../src/app/util.ts)) on each boot — so adding a new setting is safe for existing users.

## 6. Markdown Pipeline

[Markdown](../src/browser/core/Markdown.ts) is a single shared markdown-it instance configured at import time:

| Order | Plugin                                                         | Effect                                                                                                                                                                    |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| init  | `MarkdownIt({ html, breaks, linkify })`                        | Base parsing. `linkify` is locked down to require explicit protocols.                                                                                                     |
| 1     | [AlertBlock](../src/browser/extensions/renderer/AlertBlock.ts) | Registers 8 markdown-it-container types (`primary`, `success`, etc.) rendering Bootstrap alerts. Also tags `<a>` inside alerts with `alert-link`.                         |
| 2     | [LineNumber](../src/browser/extensions/renderer/LineNumber.ts) | Pushes `class="has-line-data"`, `data-line-start`, `data-line-end` on selected tokens (paragraph_open, image, code_block, fence, list_item_open). Required by ScrollSync. |
| 3     | [LinkTarget](../src/browser/extensions/renderer/LinkTarget.ts) | Adds `target="_blank"` to all `<a>`.                                                                                                                                      |
| 4     | [ImageStyle](../src/browser/extensions/renderer/ImageStyle.ts) | Adds `img-fluid` to `<img>`.                                                                                                                                              |
| 5     | [TableStyle](../src/browser/extensions/renderer/TableStyle.ts) | Adds `table table-sm table-bordered table-striped` to `<table>`.                                                                                                          |
| 6     | `@vscode/markdown-it-katex`                                    | LaTeX math, both inline (`$…$`) and block (`$$…$$`).                                                                                                                      |
| —     | `hljs.highlight` callback                                      | Highlight.js for fenced code blocks (languages registered eagerly).                                                                                                       |

Custom extension protocol is described in [src/browser/extensions/README.md](../src/browser/extensions/README.md).

The `alert alert-*`, `img-fluid`, and `table table-sm table-bordered table-striped` classes are Bootstrap names that survive into the rendered markup so the **exported** HTML (which CDN-loads Bootstrap) renders them correctly. The **live preview** in the editor pane gets minimal fallback styling from [\_preview.scss](../src/browser/assets/scss/_preview.scss) (responsive `img`, `.container`/`.container-fluid` width); alert blocks and tables show as unstyled blocks in the live preview today. A follow-up can add Tailwind-aware fallback rules to match the export's appearance.

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

Jest + jsdom under [tests/](../tests/). Manager-level tests live at the root; React component tests use `@testing-library/react` and live under `tests/react/`.

| File                           | Covers                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `app.test.ts`                  | Asserts `BrowserWindow` is constructed on `app.ready`.                                                                 |
| `bridge.test.ts`               | `BridgeManager` registers all expected `from:*` listeners and forwards correctly.                                      |
| `editor.test.ts`               | `EditorManager` calls `monaco.editor.create` with the right options.                                                   |
| `markdown.test.ts`             | `Markdown` produces alerts, target="\_blank", responsive images, line markers, LaTeX, and resists fuzzy linkification. |
| `providers.test.ts`            | Providers attach to both `EditorManager` and `BridgeManager` correctly.                                                |
| `react/TabBar.test.tsx`        | Render, activate-on-click, close-button (with mocked FileManager).                                                     |
| `react/FileTreePanel.test.tsx` | Render top-level nodes, expand directory, click file → `openFileFromPath`.                                             |
| `react/SettingsModal.test.tsx` | Toggling checkboxes calls `SettingsProvider.updateSetting`.                                                            |
| `react/EditorToolbar.test.tsx` | Button clicks call the matching CommandProvider method; ref-based split-reset.                                         |
| `react/PreviewPane.test.tsx`   | Catch-up render on mount; re-renders on `editor:render` event.                                                         |

Mocks in [tests/**mocks**/](../tests/__mocks__/) stand in for `electron`, `monaco-editor`, and CSS imports. The `tests/utils/render.tsx` helper wraps a component in the full provider tree with stubbable manager overrides — see existing component tests for usage.

## 9. Notable Conventions and Gotchas

- **Managers own data + IPC. React owns UI + presentation.** Managers under [core/](../src/browser/core/) and the seam files at [src/browser/](../src/browser/) (`dom.ts`, `notify.ts`, `splash.ts`, `util.ts`, `i18n.ts`) do not import React or Radix. React components under [react/](../src/browser/react/) do not import `ipcRenderer` or read `localStorage` directly.
- **Cross-boundary seams.** Non-React callers reach the React tree through module-level `*External` functions registered by sentinel components inside `<App>`. Adding a new seam = define a `let externalFn` in the owning context, export a `register*` setter, install it from a `<Bridge>` component during the React mount.
- **Reactive provider surface.** Any state that React needs to render is exposed by its owning manager as `subscribe(listener) → unsubscribe` + `getSnapshot()` (returning a stable reference between emits). React contexts pull through `useSyncExternalStore`. Don't add fields directly to React state if a manager already owns them.
- **Single Monaco instance.** Only [EditorManager.create](../src/browser/core/EditorManager.ts) calls `editor.create(...)`; `<EditorHost>`'s `useEffect` has `[]` deps so it never re-mounts. If you find yourself needing a second Monaco instance, you almost certainly want a model swap instead.
- **Mode flag**: every persistence-touching subsystem takes `mode: 'web' | 'desktop'`. Avoid sprinkling `if (window.executionBridge)` checks — go through the constructor flag.
- **Channel whitelists**: when you add a new IPC channel, you **must** add it to both lists in [preload.ts](../src/app/preload.ts) or it will silently no-op.
- **Notifications**: prefer `{ status, key: 'notifications:<key>', values }`. Plain-string `message` works but won't be localised. Toasts render via `sonner` (see [notify.ts](../src/browser/notify.ts) + the `<Toaster />` in `<App>`).
- **Tooltips**: shadcn `<Tooltip>` only (no `data-bs-toggle`, no Bootstrap JS). The Bootstrap CSS that used to back tooltips is no longer bundled.
- **Bootstrap CDN in exports**: [HTMLExporter](../src/browser/core/HTMLExporter.ts) still injects CDN `<link>`/`<script>` for Bootstrap, FontAwesome, highlight.js, KaTeX into the exported standalone HTML when `withStyles` is on. That's deliberate — the export is a self-contained document, not the live preview.
- **File tree filter**: today `readDirectory` returns only `.md` files and directories. Other extensions are invisible to the explorer.
- **`from:file:opened` reuse**: opening a file when the only open tab is an untitled empty tab re-keys that tab in place rather than creating a second one ([BridgeListeners.ts](../src/browser/core/BridgeListeners.ts)).
- **Log truncation**: `main.log` is truncated on every Electron launch ([main.ts:28](../src/app/main.ts#L28)). Capture it before relaunching for repro.
- **PDF export on macOS**: auto-update is disabled without code signing; mac users are on manual downloads. PDF export uses an offscreen window — works fine without signing.
- **`mked://` only opens local `.md` files** that already appear in the open file tree ([MkedLinkProvider.ts](../src/browser/core/providers/MkedLinkProvider.ts)).
- **Welcome content**: first-run editor content comes from [src/browser/assets/intro.ts](../src/browser/assets/intro.ts); in web mode it's replaced once the user has written anything (persisted to `localStorage`).
- **i18n walker is tiny now**: only the splash `<h1 data-i18n-text="app:app_name">` in [views/index.html](../src/browser/views/index.html) still uses the attribute-driven walker. Everything else translates via `useTranslation`.

## 10. React Migration

The React migration documented in [docs/REACT_MIGRATION.md](REACT_MIGRATION.md) is complete (Phases 1-10). The renderer is now React 19 + shadcn/ui + Tailwind v4 on top of the existing managers and IPC bridge. The legacy Bootstrap / SweetAlert2 / split.js / @popperjs/core dependencies are all gone; only `bootstrap` CSS is referenced in the exported HTML CDN injection, not in the bundle.

Subsequent UI/UX work should:

- Follow the shadcn copy-in pattern in [src/browser/react/components/ui/](../src/browser/react/components/ui/) when adding new primitives.
- Add managers' state via `subscribe`/`getSnapshot` + a context wrapper, not via React state owned in components.
- Cross the manager/React boundary through new `*External` seams, mirroring `openModalExternal` / `openPromptExternal` / `showPropertiesExternal` / `sonnerToast`.
