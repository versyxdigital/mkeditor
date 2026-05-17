# Custom Title Bar Plan

Phased plan for replacing the native window chrome on Windows/Linux with an in-window VSCode-style title bar that hosts the app logo, menu (File / Edit / View / Help), and native window controls — while leaving the native menu bar intact on macOS. The high-level entry in [ROADMAP.md](ROADMAP.md) links here.

Read first: [../CLAUDE.md](../CLAUDE.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions

| Area                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Window chrome        | `frame: false` on Windows + Linux. `titleBarStyle: 'hiddenInset'` on macOS (native traffic lights stay; we draw the bar around them).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Menu surface         | Windows + Linux: custom in-window menu inside `<TitleBar>`. macOS: native menu bar (system top), unchanged. Web: same `<TitleBar>` component, no drag region, no window controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Menu source-of-truth | A single `src/app/lib/menuModel.ts` (plain TS, no Electron deps) declares each item as `{ id, label, accelerator?, darwinAccelerator?, action }`. `AppMenu` (same dir) builds an Electron `Menu` from it on macOS; React `<TitleBar>` imports the same file via webpack (`../../app/lib/menuModel`). It lives under `src/app/` because `src/app/tsconfig.json` excludes `../browser` — the renderer is allowed to import across, the main process is not. The tray context menu is **out of scope** for the model: tray entries (Show Window / Open Recent / Quit) are tray-only and stay as an inline `Menu.buildFromTemplate` in `AppMenu.buildTrayContextMenu`. |
| Accelerators         | Default to Electron's `CmdOrCtrl+` modifier so a single string covers both macOS and Windows/Linux (Electron resolves at runtime). For the rare case where the platforms genuinely differ (e.g. DevTools — `Alt+Cmd+I` on macOS vs `Ctrl+Shift+I` elsewhere), set `darwinAccelerator` and `AppMenu.resolveAccelerator` picks it on darwin. `menuModel.ts` itself contains **no `process.platform` checks** — webpack would otherwise bake the build-machine's platform into the renderer bundle.                                                                                                                                                                   |
| Action dispatch      | Existing IPC channels stay (`from:file:*`, `from:folder:*`, `from:command:palette`, `from:modal:open`). The renderer menu calls a module-level seam (`dispatchMenuAction`) registered by `<App>` at mount time — same pattern as `openModalExternal` / `confirmExternal`.                                                                                                                                                                                                                                                                                                                                                                                          |
| Window controls      | Drawn in HTML inside `<TitleBar>`. Three new IPC channels: `to:window:minimize`, `to:window:maximize`, `to:window:close`. Maximize button toggles between maximize/restore based on the latest `from:window:state` event.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Maximize state       | Main listens for `BrowserWindow` `maximize`/`unmaximize` and emits `from:window:state` (boolean). Renderer holds the boolean in `<TitleBar>` state and flips the icon. Double-click on the drag region toggles the same action.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Drag region          | Whole `<TitleBar>` has `-webkit-app-region: drag`. Every interactive child (logo button, menu buttons, window controls) gets `-webkit-app-region: no-drag`. Web mode drops the drag CSS entirely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Existing `<Navbar>`  | Stays. Its responsibilities (active file label, copy-path button, character/word counts, settings/help quick-links) are unchanged. The redundant inline logo moves to `<TitleBar>`. Sidebar toggle stays in `<Navbar>` (it sits beside the active file label).                                                                                                                                                                                                                                                                                                                                                                                                     |
| Keyboard nav         | Alt opens the first menu; Left/Right cycles menus; Esc closes. Native menu on macOS handles its own — we only implement this for the custom bar.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| State ownership      | `AppMenu` owns the menu model on disk-side. `<TitleBar>` owns drag region + button state + dropdown open state. Menu actions resolve to the same IPC channels the native menu uses today; no React component knows the menu schema.                                                                                                                                                                                                                                                                                                                                                                                                                                |

### State ownership rule

> **Managers own the IPC + menu model. React owns the bar layout, dropdowns, and window-control buttons.**

`menuModel.ts` is plain data — both AppMenu and `<TitleBar>` consume it. `<TitleBar>` never imports `ipcRenderer` or `window.executionBridge` directly; menu actions go through `dispatchMenuActionExternal` (registered at mount); window controls go through a typed `useWindowControls()` hook that calls into BridgeManager.

## Target Architecture

```
src/app/
├── lib/
│   ├── AppMenu.ts                     MODIFIED — build Electron Menu from menuModel; install on macOS only
│   ├── AppWindow.ts                   NEW — window-control IPC handlers + maximize/unmaximize emitter
│   └── menuModel.ts                   NEW — plain TS, no Electron deps; types + File/Edit/View/Help groups
├── main.ts                            MODIFIED — frame: false (win/linux) / hiddenInset (mac); construct AppWindow
└── preload.ts                         MODIFIED — whitelist to:window:* and from:window:state

src/browser/
├── core/
│   └── BridgeManager.ts               MODIFIED — windowMinimize() / windowMaximize() / windowClose(); subscribe/getSnapshot for isMaximized
├── react/
│   ├── components/
│   │   ├── TitleBar.tsx               NEW — logo + menu bar + window controls + drag region
│   │   └── TitleBar.menu.tsx          NEW — per-menu <DropdownMenu> built from MenuItem[]
│   ├── contexts/
│   │   └── WindowContext.tsx          NEW — exposes isMaximized + minimize/maximize/close imperative API
│   └── App.tsx                        MODIFIED — render <TitleBar> above <Navbar>; register dispatchMenuActionExternal

locale/<lng>/menu.json                 NEW — File/Edit/View/Help labels (en first; others fall back until mirrored)
docs/
├── TITLE_BAR.md                       this doc
├── ROADMAP.md                         MODIFIED — link this plan, add the milestone row
└── ARCHITECTURE.md                    MODIFIED at end of P3 — document the title-bar surface and IPC

tests/
├── AppWindow.test.ts                  NEW — window-control IPC handlers (min/max/close + state emission)
├── menuModel.test.ts                  NEW — every menu entry maps to a real IPC channel or role
└── react/
    ├── TitleBar.test.tsx              NEW — menu open/close, action dispatch, window-control clicks
    └── TitleBar.maximize.test.tsx     NEW — icon flips on isMaximized change
```

## Menu Schema

```ts
/** Plain string union — avoids importing Electron types so the renderer can use the same file. */
type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'togglefullscreen'
  | 'quit';

type MenuAction =
  | { kind: 'channel'; channel: string; payload?: unknown }
  | { kind: 'role'; role: MenuRole }
  | { kind: 'command'; commandId: string };

interface MenuItem {
  /** Stable id for tests, keyboard nav, and the i18n key (`menu.<id>`). */
  id: string;
  /** English label. Renderer translates via `t(\`menu.\${id}\`)` once i18n
   *  is wired in P2 and falls back to this string. `role`-action items
   *  intentionally omit the label so Electron picks the OS default
   *  ("Exit" on Windows for `quit`, etc.). */
  label: string;
  /** Default Electron accelerator. `CmdOrCtrl+` means Cmd on macOS and
   *  Ctrl elsewhere — Electron resolves it at runtime, and the renderer
   *  reads the same syntax in P2. */
  accelerator?: string;
  /** macOS override for `accelerator`. Set only when the platforms can't
   *  share a single `CmdOrCtrl+` expression (e.g. DevTools). */
  darwinAccelerator?: string;
  action?: MenuAction;
  /** Visual separator above this item. */
  separatorBefore?: boolean;
}

interface MenuGroup {
  id: 'file' | 'edit' | 'view' | 'help';
  /** English label shown on the menu-bar button. */
  label: string;
  items: MenuItem[];
}

type MenuModel = MenuGroup[];
```

## Cross-cutting Concerns

- **No new `?.` provider chains.** `<TitleBar>` consumes contexts (`useFiles`, `useModals`, `useWindowControls`); the rest is plain props.
- **IPC discipline.** Three new channels (`to:window:minimize`, `to:window:maximize`, `to:window:close`) and one inbound event (`from:window:state`) are whitelisted in [preload.ts](../src/app/preload.ts). No `window.executionBridge` access from React.
- **Restore ordering.** `from:window:state` fires immediately on the renderer's first `from:settings:set` (or any reload) so the maximize icon hydrates correctly. Replays on every `BrowserWindow` `maximize`/`unmaximize`.
- **Web mode.** `<TitleBar>` still renders the menu (so the user can reach File / Edit / View / Help the same way) but conditionally omits window controls and drag region. Menu actions that don't apply on the web (e.g. `app.quit`) are filtered out by the model loader when `mode === 'web'`.
- **Menu i18n.** New `locale/<lng>/menu.json` namespace. Keys: `menu.file`, `menu.file.new`, `menu.file.open`, … English added in P1; other locales mirrored at the end of P3.
- **Accelerators on macOS.** macOS keeps the native menu, so accelerators are registered by Electron itself. Windows/Linux: `<TitleBar>` registers `CommandProvider` chord-key entries from the same model so `Ctrl+N` / `Ctrl+O` etc. continue to work even when no menu is open.
- **Drag region pitfalls.** Children of a `drag` region absolutely must opt into `no-drag` or they swallow clicks. Add an ESLint check (or at minimum a comment + unit assertion) so future additions follow the rule.
- **macOS traffic-lights.** `trafficLightPosition` is set so the lights align vertically with the menu row. Verified in P3 smoke.
- **Single Monaco focus.** Clicking a menu button must not steal focus from the editor when the dropdown closes without selection. Use Radix's `restoreFocus` behaviour; verified in P3.

## Phase Index

| #   | Phase                                                           | Status |
| --- | --------------------------------------------------------------- | ------ |
| 1   | Main-process infrastructure (frameless window + IPC + AppMenu)  | 🔵     |
| 2   | Renderer `<TitleBar>` (menu bar + window controls + drag)       | 🔵     |
| 3   | Polish (maximize sync, keyboard nav, macOS verify, tests, i18n) | 🔵     |

---

## Phase 1 — Main-process infrastructure

**Goal:** make the window frameless on Windows/Linux, keep traffic lights on macOS, wire the window-control IPC, and refactor `AppMenu` to build from `menuModel`. No renderer changes yet — the app will boot with no menu visible on Windows/Linux (intentional; P2 reintroduces it in the renderer).

### Tasks

1. **Create [src/app/lib/menuModel.ts](../src/app/lib/menuModel.ts)** — declare types (`MenuAction`, `MenuItem`, `MenuGroup`, `MenuModel`) and the data (File / Edit / View / Help groups) in a single file. Items copied verbatim from `AppMenu.register()` (lines 49-170). No Electron runtime imports; the `role` field is a plain string union. Webpack lets the renderer import this via `../../app/lib/menuModel`.
2. **Refactor [src/app/lib/AppMenu.ts](../src/app/lib/AppMenu.ts)** — replace the inline `Menu.buildFromTemplate([…])` with a `buildFromModel(menuModel)` helper that maps each `MenuAction` to its Electron equivalent (channel send / `role` / `click` handler). `register()` only calls `app.applicationMenu = …` when `process.platform === 'darwin'`; otherwise sets `null` so the OS menu strip disappears on Windows/Linux.
3. **Create [src/app/lib/AppWindow.ts](../src/app/lib/AppWindow.ts)** — owns `to:window:minimize | maximize | close` `ipcMain.on` handlers (delegate to `BrowserWindow.minimize() / maximize() / unmaximize() / close()`). Listens for the window's own `maximize` / `unmaximize` events and emits `from:window:state` (`{ isMaximized: boolean }`). Sends an initial state on `did-finish-load`.
4. **Update [src/app/main.ts](../src/app/main.ts)** — pass `frame: false` (Windows/Linux) or `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 12, y: 12 }` (macOS) to the `BrowserWindow` constructor. Construct `AppWindow` after the window opens.
5. **Update [src/app/preload.ts](../src/app/preload.ts)** — whitelist `to:window:minimize`, `to:window:maximize`, `to:window:close`, and `from:window:state`.
6. **Tests** — `tests/AppWindow.test.ts` covers the three IPC handlers and the state emission on maximize/unmaximize.
7. **Run end-of-phase reviewers** in parallel (architecture-auditor, phase-reviewer, test-auditor) once implementation is complete.
8. **Report and request commit approval.**

### Exit criteria

- ✅ Desktop boot on Windows: window has no native frame; no menu strip; existing AppMenu actions still trigger via existing accelerators on macOS.
- ✅ `to:window:*` channels move the window; `from:window:state` fires on maximize/unmaximize.
- ✅ macOS build still shows the native menu bar (traffic lights present, `Menu.setApplicationMenu(menu)` ran).
- ✅ No renderer changes — splash + editor still load; tests still pass.

---

## Phase 2 — Renderer `<TitleBar>` component

**Goal:** put the in-window menu and window-control buttons back. After this phase, Windows/Linux users see logo + File/Edit/View/Help + min/max/close, draggable window, working menu actions. macOS continues to use the native menu (unchanged from P1 end-state).

### Tasks

1. **Create [src/browser/react/contexts/WindowContext.tsx](../src/browser/react/contexts/WindowContext.tsx)** — exposes `{ isMaximized, minimize, maximize, close }`. Subscribes to BridgeManager's window state observable (added in this phase to BridgeManager). Falls back to no-op on web.
2. **Add window-control surface to [src/browser/core/BridgeManager.ts](../src/browser/core/BridgeManager.ts)** — `subscribe/getSnapshot` for `isMaximized`, plus `windowMinimize() / windowMaximize() / windowClose()` methods that proxy to the bridge.
3. **Wire `from:window:state` in [src/browser/core/BridgeListeners.ts](../src/browser/core/BridgeListeners.ts)** — flip BridgeManager's `isMaximized` snapshot on each event.
4. **Create [src/browser/react/components/TitleBar.tsx](../src/browser/react/components/TitleBar.tsx)** — flex row: logo (`./icon.png`) · menu buttons (one per `MenuGroup`) · spacer · window-control trio. CSS: bar gets `-webkit-app-region: drag`; every child gets `-webkit-app-region: no-drag`. Web mode drops both rules.
5. **Create [src/browser/react/components/TitleBar.menu.tsx](../src/browser/react/components/TitleBar.menu.tsx)** — wraps `<DropdownMenu>` from existing UI primitives; renders each `MenuItem` as a `<DropdownMenuItem>` with the accelerator label on the right.
6. **Register `dispatchMenuActionExternal` in [src/browser/react/App.tsx](../src/browser/react/App.tsx)** — module-level seam (same pattern as `openModalExternal`). Resolves `MenuAction` against `useModals`, `useFiles`, and BridgeManager's command dispatcher.
7. **Mount `<TitleBar>` at the top of `<App>`** — above `<Navbar>`. The redundant logo `<img>` inside `<Navbar>` is removed; `<Navbar>`'s sidebar toggle + active-file label + counts stay.
8. **Tests** — `tests/react/TitleBar.test.tsx` covers menu open, action dispatch (mock seam), window-control button clicks.
9. **Reviewers + commit approval.**

### Exit criteria

- ✅ Windows/Linux desktop: logo + File/Edit/View/Help buttons visible at the top of the window; clicking each opens a dropdown; clicking an item fires the matching IPC channel (verified via test).
- ✅ Drag region: clicking-and-dragging an empty part of the title bar moves the window.
- ✅ Window-control buttons minimize / maximize / close the window via the new IPC.
- ✅ macOS: title strip is empty (native menu still in use at the system bar; `<TitleBar>` renders nothing meaningful and is hidden via `mode === 'darwin'` guard, or shows just the logo — pick in P2 task 7).
- ✅ Web: `<TitleBar>` renders logo + File/Edit/View/Help; no drag, no window controls.

---

## Phase 3 — Polish, tests, i18n, macOS verify

**Goal:** the title bar feels native. Maximize icon stays in sync, double-click toggles, keyboard nav works, macOS traffic lights are aligned, every locale has the menu strings, and the architecture doc is updated.

### Tasks

1. **Maximize icon double-click** — `<TitleBar>`'s drag region has an `onDoubleClick` handler that fires `windowMaximize()` (which toggles based on current state).
2. **Keyboard navigation** — Alt focuses the first menu button; Left/Right cycle; Esc closes any open dropdown.
3. **Active menu indicator** — clicking File highlights the File button while its dropdown is open. Reuse Radix's `data-state="open"` attribute.
4. **macOS verify** — boot the macOS build (CI matrix once available; until then, manual on local Mac if accessible). Confirm: traffic lights at `(12, 12)` align with the title row; native menu still visible at system top; `<TitleBar>` either empty or showing logo only.
5. **i18n mirror** — translate `locale/en/menu.json` into the other 12 locales (de, es, fr, it, ja, ko, nl, pt, ru, tr, uk, zh). Match the existing `notifications.json` style: short, idiomatic.
6. **Tests** — expand `TitleBar.test.tsx` with keyboard-nav cases and the maximize-icon flip test. `menuModel.test.ts` asserts every entry resolves to a real action.
7. **[ARCHITECTURE.md](ARCHITECTURE.md)** — new section under §3 (renderer composition) documenting the title bar + window-control IPC surface.
8. **[ROADMAP.md](ROADMAP.md)** — move the milestone row into **Recently Landed** with the date.
9. **Reviewers + commit approval.**

### Exit criteria

- ✅ Maximize icon reflects current state on boot and after every state change.
- ✅ Double-click drag region toggles maximize/restore.
- ✅ Alt opens the menu; Left/Right cycles; Esc closes.
- ✅ macOS: traffic lights aligned; native menu intact; no platform-conditional regression.
- ✅ Every locale has `menu.json`.
- ✅ `npm test`, `npm run lint`, and a clean `npm run build-editor` + `npm run build-app`.

---

## Future Considerations

- **Tabs in the title bar.** VSCode merges the title bar with tabs when the activity bar is hidden. Out of scope for this plan; revisit once the title bar is in.
- **Recent files menu.** ROADMAP §3 has a pending item for `recentDocuments`. The menu model is the natural home for it once enabled.
- **Custom themes.** A user-configurable accent could re-tint the title bar without touching its layout.
