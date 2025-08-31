# MKEditor Electron App (Main Process)

This folder contains the Electron “main process” code that boots the desktop app, owns OS integrations (file system, menus, tray, auto‑updates), and exposes a safe bridge to the renderer (the editor UI in `src/browser`).

## Structure Overview

- `main.ts`: Application entrypoint. Creates the `BrowserWindow`, wires logging, auto‑updates, custom protocol, tray, and loads the renderer. On load, it pushes theme + settings to the renderer and opens the initial file if any.
- `preload.ts`: Runs in an isolated world and exposes a safe, whitelisted IPC bridge (`window.executionBridge`) plus helpers (`window.mked`, `window.logger`). This is the only surface the renderer uses to talk to the main process.
- `lib/`:
  - `AppBridge.ts`: IPC router/handlers for “to:*” channels from the renderer. Implements prompts, URL handling for `mked://`, and delegates to storage/settings.
  - `AppMenu.ts`: Builds the application & tray menus and wires menu items to “from:*” channels sent to the renderer.
  - `AppSettings.ts`: Loads/validates/persists settings at `~/.mkeditor/settings.json`, merges defaults, and notifies the renderer on success/error.
  - `AppStorage.ts`: File/folder operations (open/save, rename/delete, export to HTML/PDF, open directory/path); updates the renderer via “from:*” channels and notifications.
- `assets/`: Inline assets for the main process (e.g., tray icon base64).
- `interfaces/`: Main‑process interfaces for logging and settings.

## IPC & Bridge Model

- The preload script whitelists channels:
  - Renderer → Main (`send`): `to:*` channels.
  - Main → Renderer (`receive`): `from:*` channels.
- Notifications are localized in the renderer. The main process sends:
  - `{ status, key: 'notifications:…', values? }` for translated messages, or
  - `{ status, message }` as a plain fallback.
  The renderer maps these via i18n and shows a SweetAlert2 toast.

## Desktop‑Only Integrations

- Logging: `electron-log` writes to `~/.mkeditor/main.log`; configured in `main.ts`.
- Auto‑updates: `electron-updater` checks on `app.ready` and raises user notifications for available/downloaded updates via `from:notification:display` (with i18n keys).
- Custom protocol: `mked://` is registered and handled in `main.ts`; `AppBridge.handleMkedUrl` opens linked documents in the running instance in a new tab.
- System Tray: created in `main.ts` with menu actions from `AppMenu`.

## i18n Responsibilities

- The main process does not run i18next. Instead, it sends i18n keys to the renderer (e.g., `notifications:*`).
- The renderer loads namespaces (including `notifications`, `modals-*`, and menus) and translates incoming payloads.

## Build & Run

- Compile the main process TypeScript to `dist/app`:
  - `npm run build-app` compiles `src/app/**/*.ts` with `tsc` (through `scripts/compile-app.mjs`).
- Run the desktop app in development (after building the editor bundle):
  - `npm run build-editor` (renderer bundle)
  - `npm run serve-app` (launch Electron with `dist/app/main.js`)
- Make installers:
  - `npm run make-installer`

## Lifecycle Highlights

- Single instance lock ensures one running instance; subsequent launches focus the app and forward files.
- `app.on('open-file')` (macOS) and Windows argv handling open files in the same instance.
- On `did-finish-load`, the main process sends theme + settings and opens the initial file (or creates a new untitled file in the renderer).
- On window close, `AppBridge.promptUserBeforeQuit` can prompt to save based on editor state.