# Session Restore Plan

Phased plan for making MKEditor reopen with the same tabs, the same active tab, and the same cursor/scroll positions after the app is closed and relaunched. The high-level entry in [ROADMAP.md](ROADMAP.md) links here.

Read first: [../CLAUDE.md](../CLAUDE.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions

| Area              | Decision                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence file  | `~/.mkeditor/session.json` on desktop (sibling to `settings.json`), `mkeditor-session` localStorage key on web                                                                                                            |
| Atomic write      | Write to `session.json.tmp` then `fs.rename` into place. Same pattern as `AppSettings.save()` if it doesn't already do it; introduce here if not.                                                                          |
| Untitled tabs     | Persist with `content` inlined under the synthetic `untitled-N` id, but **only when the buffer is non-empty**. Empty scratch tabs are dropped on quit. Restored untitled tabs reuse the synthetic id; counter advances past the highest restored id. |
| Missing files     | Skip the tab silently (don't open) **and** surface one toast naming the dropped paths via a new `notifications:session_file_missing` key (with `{{files}}` interpolation). Keep the rest of the session intact.            |
| Save cadence      | Structural-event-driven. Writes fire on `addTab` / `closeTab` / `activateFile` / `reorderTabs` / `renameTab` / `replaceUntitled`, debounced ~300 ms. The active tab's current `saveViewState()` is captured at write time. |
| Quit flush        | Electron `app.on('before-quit')` triggers a final synchronous flush (via `mainWindow.webContents.send('from:session:flush-request')` + a renderer ack — or a renderer-side `pagehide` write). Pick the simplest in P1.    |
| Web save cadence  | Same triggers, but writes are synchronous (`localStorage.setItem`), so no debounce needed. A `beforeunload` listener handles the quit-flush equivalent.                                                                   |
| Crash resilience  | Atomic write covers truncation. Worst-case loss after crash: cursor pos for the at-crash active tab (everything else was captured on switch-out).                                                                          |
| State ownership   | `FileManager.serializeSession()` / `restoreSession(payload)` own the data shape; main-process `AppSession` owns disk I/O; web-mode equivalent in `WebFileBridge`. **No React file knows the session schema.**             |

### State ownership rule

> **Managers own session data and IPC. React owns nothing about session restore.**

The session payload is owned by `FileManager` (it already owns tabs, models, originals, viewStates). Disk persistence is owned by `AppSession` (desktop) / `WebFileBridge` (web). React components never read or write the session — they just re-render off the existing `FilesContext` snapshot once `restoreSession` repopulates `FileManager`.

## Target Architecture

```
src/app/
├── lib/
│   └── AppSession.ts                  NEW — read/write ~/.mkeditor/session.json with atomic rename
├── AppBridge.ts                       MODIFIED — wire to:session:save handler + from:session:restore at boot
└── preload.ts                         MODIFIED — whitelist new channels

src/browser/
├── core/
│   ├── FileManager.ts                 MODIFIED — serializeSession() / restoreSession() + debounced save trigger
│   └── WebFileBridge.ts               MODIFIED — session save/load via localStorage; restore walks handles
└── core/BridgeListeners.ts            MODIFIED — handle from:session:restore (replay tabs + active)

locale/<lng>/notifications.json        MODIFIED — add session_file_missing key (en first; others fall back)
docs/
├── SESSION_RESTORE.md                 this doc
└── ARCHITECTURE.md                    MODIFIED at end of P2 — document the persistence surface

tests/
├── AppSession.test.ts                 NEW — atomic write, schema validation, missing-file behaviour
└── FileManager.session.test.ts        NEW — serialize/restore round-trip, untitled handling
```

## Session Schema

```ts
interface SessionPayload {
  /** Format version for forward-compat. Bump if the shape ever changes. */
  version: 1;
  /** Insertion order = tab order. */
  tabs: SessionTab[];
  /** Path of the active tab, or null. Must match one of `tabs[].path` or be null. */
  activeFile: string | null;
}

interface SessionTab {
  /** Real file path, or a synthetic `untitled-N` id. */
  path: string;
  /** Display name (tab label). */
  name: string;
  /** Monaco view state — cursor, selection, scroll, folding. Null for never-activated tabs. */
  viewState: editor.ICodeEditorViewState | null;
  /** Inline content. Present iff `path.startsWith('untitled')` AND the buffer is non-empty. */
  untitledContent?: string;
}
```

## Cross-cutting Concerns

- **No `?.` provider chains in React.** React doesn't touch session at all; this is a manager-layer feature.
- **IPC discipline.** New channels (`to:session:save`, `from:session:restore`, optional `from:session:flush-request`) are whitelisted in [preload.ts](../src/app/preload.ts) — no `window.executionBridge` access elsewhere.
- **Restore ordering.** `from:session:restore` fires _after_ `from:settings:set` and _before_ any `from:file:opened` triggered by command-line args. `FileManager.restoreSession` is a no-op if it's already been called (idempotent guard).
- **Untitled IDs.** `FileManager.untitledCounter` is bumped past `max(restored untitled ids)` so subsequent untitled creation doesn't collide.
- **Missing-file toast** uses the existing `from:notification:display` plumbing — `BridgeListeners` already translates and surfaces via sonner.
- **Web mode** mirrors the same surface: `WebFileBridge.serializeSession()` / `restoreSession()` use localStorage. The FS-Access handle map is rebuilt on workspace restore (already wired), and session paths are validated against the rebuilt map.
- **Performance**: the active tab's view state is captured at save time via `mkeditor.saveViewState()`. Inactive tabs' view states are already in `FileManager.viewStates` (captured on switch-out). Both go into the payload.

## Phase Index

| #   | Phase                                                       | Status |
| --- | ----------------------------------------------------------- | ------ |
| 1   | Main-process infrastructure (AppSession + IPC + atomic write) | 🔵     |
| 2   | Renderer integration (serialize/restore + debounce + toast)   | 🔵     |
| 3   | Web mode parity (localStorage + handle re-walk)               | 🔵     |

A phase is **complete** only when its exit criteria are met _and_ `npm test`, `npm run lint`, and a manual smoke (desktop + web for P3) pass. **Each phase ends with a focused commit (or small commit series) on a `feature/session-phase-N-<slug>` branch.**

---

## Phase 1 — Main-process infrastructure

Build the disk-persistence surface and IPC channels with no renderer behaviour change beyond receiving an empty session at boot.

### Tasks

1. **`src/app/lib/AppSession.ts`** — new class with:
   - `static load(): SessionPayload | null` — reads `~/.mkeditor/session.json`. Returns `null` on missing file. Returns `null` and logs on JSON parse failure. Validates `version === 1` and basic shape; mismatch returns `null`.
   - `static save(payload: SessionPayload): void` — writes to `~/.mkeditor/session.json.tmp` then `fs.renameSync` into place. Synchronous so the `before-quit` flush works. Catches and logs errors; never throws.
   - Schema validation matches the `SessionPayload` / `SessionTab` interface above.
2. **`src/app/preload.ts`** — whitelist `to:session:save` (renderer→main) and `from:session:restore` (main→renderer).
3. **`src/app/AppBridge.ts`** — register `ipcMain.on('to:session:save', ...)` that calls `AppSession.save(payload)`. At `did-finish-load` time (after the existing settings push), call `AppSession.load()` and send `from:session:restore` with the payload (or `null`).
4. **`src/app/main.ts`** — add `app.on('before-quit')` hook that sends `from:session:flush-request` to the renderer and waits up to ~250 ms for an ack (`to:session:save` arriving) before completing quit. If no ack arrives, proceed anyway — we still have the last debounced write.
5. **`tests/AppSession.test.ts`** — unit tests for: missing file returns null; valid JSON parses; corrupted JSON returns null without throwing; atomic write writes-then-renames; concurrent saves don't corrupt (best-effort — use a sequential test if jest's parallel model can't simulate this).

### Out of scope

- Any renderer-side session logic (no `FileManager.serializeSession` yet).
- Web mode (`WebFileBridge` untouched).
- Toast for missing files (P2 handles).
- Documentation updates to ARCHITECTURE.md (P2).

### Exit criteria

- `AppSession.load()` and `AppSession.save()` work and have unit tests.
- `~/.mkeditor/session.json.tmp` exists transiently during a save and is renamed atomically; killing the process mid-save never leaves a half-written `session.json`.
- Channels `to:session:save` and `from:session:restore` are whitelisted in preload.
- Bare renderer (no FileManager wiring yet) receives `from:session:restore` at boot — verifiable via a one-line `console.info` in `BridgeListeners` that you remove in P2.
- `before-quit` hook fires and times out cleanly when the renderer isn't ack-ing yet.
- `npm test` green, `npm run lint` green, `npm run build-app` succeeds.

---

## Phase 2 — Renderer integration

Wire `FileManager` to the new channels: serialize on tab events, restore at boot, surface a toast when restored files have vanished.

### Tasks

1. **`FileManager.serializeSession(): SessionPayload`** — walks `tabs`, captures the active tab's current `saveViewState()` first (so it's the freshest), inlines `untitledContent` only when the model is non-empty, returns the payload.
2. **`FileManager.restoreSession(payload)`** — replays each tab:
   - For real paths: `bridge.send('to:file:openpath', { path })` _without_ setting `openingFile = true` (we're driving a batch). Track missing files via the existing `from:notification:display` plumbing for paths the bridge reports as not found.
   - For untitled paths: create a model from `untitledContent`, register in `models`/`originals`/`tabs`, advance `untitledCounter` past the synthetic id.
   - After all tabs land, activate the previous active tab (or the first tab if active is missing) and restore its `viewState`.
   - Idempotent: subsequent calls in the same session are no-ops.
3. **`FileManager.scheduleSessionSave()`** — internal debounced trigger (300 ms). Calls `serializeSession()` and `bridge.send('to:session:save', payload)`. Triggered from `addTab`, `closeTab`, `activateFile`, `reorderTabs`, `renameTab`, `replaceUntitled`.
4. **`BridgeListeners`** — handle `from:session:restore` by calling `FileManager.restoreSession(payload)`. Handle `from:session:flush-request` by calling `serializeSession()` and sending one final `to:session:save` synchronously.
5. **Missing-file toast** — collect missing paths during `restoreSession`, fire one `sonnerToast` via the new `notifications:session_file_missing` key with `{{files}}` interpolation. Add the key to `locale/en/notifications.json`; other locales fall back via `fallbackLng: 'en'`.
6. **ARCHITECTURE.md** — add a "Session restore" subsection covering payload shape, save cadence, atomic write, and the IPC channels.
7. **`tests/FileManager.session.test.ts`** — serialize/restore round-trip; untitled inline persistence (with and without content); missing-file path triggers the toast key; counter advances past restored untitled ids.

### Out of scope

- Web mode (P3).
- New React UI for session (there's no UI — the existing TabBar re-renders off `FilesContext`).
- Any change to `viewStates` capture behaviour (already lands in P0).

### Exit criteria

- Reopening the desktop app reopens every previously-open tab in the same order, with the same active tab, at the same cursor position.
- An untitled tab with typed content survives a relaunch; an empty untitled tab does not.
- Deleting a workspace file between sessions surfaces exactly one toast on the next launch and the rest of the session is intact.
- Renaming a tab in the file tree, then quitting and relaunching, reopens the file under its new name with the cursor at the right line.
- `npm test` green (incl. the new `FileManager.session.test.ts`), `npm run lint` green, `npm run build-editor` succeeds.
- Desktop smoke pass.

---

## Phase 3 — Web mode parity

Bring the same behaviour to the web build via localStorage and the existing IDB-persisted FS-Access handle.

### Tasks

1. **`WebFileBridge`** — implement the same `to:session:save` / `from:session:restore` channel handling. Save writes to `localStorage.setItem('mkeditor-session', JSON.stringify(payload))`. Load reads at boot and dispatches `from:session:restore` from inside `restoreWorkspace` after the handle map is rebuilt.
2. **Handle re-walk integration** — `restoreSession` on web must run _after_ `restoreWorkspace(false)` (or after the user clicks "Restore previous folder"). For each session tab whose path is inside the workspace root, validate the handle exists in `this.handles`; missing paths feed the same missing-file toast.
3. **Quit-flush equivalent** — `window.addEventListener('beforeunload', ...)` fires one final synchronous serialize-and-save. localStorage is synchronous, so no ack needed.
4. **Save cadence** — same triggers as desktop, but write directly through `localStorage.setItem` from `WebFileBridge.send('to:session:save', ...)`. The 300 ms debounce in `FileManager` covers both modes uniformly.
5. **Untitled-tab content** — in web mode, the existing `mkeditor-content` localStorage entry (single buffer) becomes redundant once session restore is live. Migrate any existing `mkeditor-content` into the first untitled tab of a freshly-written `mkeditor-session` on first launch after this phase, then drop the old key.
6. **Tests** — extend the existing `FileManager.session.test.ts` (or add `WebFileBridge.session.test.ts`) covering: web save round-trip, beforeunload flush, missing-file behaviour when a workspace file is gone after handle re-walk.

### Out of scope

- Multiple workspaces (single root only, matching the existing FS-Access design).
- Cross-tab synchronisation (closing the browser tab and reopening shares state; two simultaneously-open tabs of the editor would race localStorage — acknowledge but don't fix).

### Exit criteria

- A web user with a workspace open who refreshes the page returns to the same tabs and cursor positions after re-granting permission.
- An untitled tab with content survives a refresh in web mode.
- A pre-existing `mkeditor-content` localStorage entry from a previous version of the app migrates into the first untitled tab cleanly and the old key is removed.
- Missing-file toast surfaces the same way as desktop.
- `npm test` green, `npm run lint` green, `npm run build-editor` succeeds.
- Web smoke pass in Chromium.

---

## How to Update This Doc

- When a phase ships, flip its row to 🟢 with today's date.
- If implementation reveals a planning gap, **stop, update this doc first, then resume**.
- New decisions go in the Decisions table — don't bury them in phase bodies.
- Don't add new phases retroactively; if scope grows, file a follow-up in ROADMAP and link back.
