# CHANGELOG

### 2026-05-19 - v4.0.0

#### Added

- **AI Assistant**: In-editor agent (Anthropic / OpenAI / Ollama) in a right-hand sidebar with per-provider chat tabs, persisted conversations, streaming responses, and a workspace-scoped read/write tool catalog. Write tools confirm by default; `@`-mentions, active-file chip and selection sharing keep the agent grounded in workspace context. Translated across all 13 supported locales. Desktop-only.

#### Changed

- **Secure key transport**: AI provider API keys are RSA-OAEP-encrypted in the renderer before crossing IPC — plaintext never traverses the renderer↔main bridge. On-disk storage continues to use Electron `safeStorage`.
- **Workspace-scoped file IPC**: All assistant file operations resolve against the open workspace root (canonical paths, symlink escapes rejected); calls outside the workspace or without a workspace open are denied.

#### Fixed

- **Tab unsaved-indicator**: Saving via the menu or `Ctrl+S` now clears the tab's unsaved-changes dot (previously only the toolbar Save button did).
- **Menu accelerators on Windows/Linux**: `Ctrl+S`, `Ctrl+O` and other keybindings shown in the in-window title bar now actually fire, with the native menu bar still hidden.

---

### 2026-05-17 - v3.8.1

#### Fixed

- Fixed issue with react-resizable-panels fighting monaco editor and causing overflow issues.
- Fixed issue with splash screen hanging on web due to electron logger no-op

---

### 2026-05-17 - v3.8.0

#### Added

- **Workspace session persistence**: Open tabs, the active tab, and per-tab cursor/scroll position are restored across launches on both desktop and web.
- **Web file explorer**: The sidebar now supports opening, browsing, and editing local folders in Chromium-based browsers via the File System Access API; workspace handle persists across refresh via IndexedDB.
- **Code block styling**: Preview code blocks now render with a header bar showing the language and a copy button; shell/bash blocks render in a terminal style.

---

### 2026-05-16 - v3.7.0

#### Added

- **UI Migration** Migrated from direct-DOM based structure to React UI.
- **UI Libraries** Replaced bootstrap with Tailwind CSS.
- **Live Preview Styling** Implemented a custom preview styling similar to Github's rendered markdown preview.

---

### 2025-09-02 - v3.6.0

#### Added

- **Localization**: Languages now supported: German, Spanish, Italian, Dutch, Portuguese, Turkish, Russian, Ukrainian, Korean, Japanese and Chinese (Simplified).
- **Web**: For the web browser version, user's changes are now stored in local storage, if the user reloads they'll be able to resume editing from where they left off.

#### Fixed

- Fixed bug when attempting to open an .md file directly (from the OS, either by double-clicking or open with...) when the editor is already open.

---

### 2025-08-28 - v3.5.1

#### Added

- **Live Preview Styling**: The preview styling now updates live in response to changes to users' HTML/PDF file export settings.

---

### 2025-08-25 - v3.5.0

#### Added

- **Configurable export styling**: Added more comprehensive options for users to configure the styling of their HTML/PDF exports, settings persist to the user's settings file.

#### Fixed

- Fixed a bug with non-links rendering as links, for example "markdown.md" (without the protocol) was being rendered as a link.

---

### 2025-08-23 - v3.4.0

#### Added

- **File explorer context menu**: Added a context menu to the file explorer with options to open files and folders, rename, delete etc (only for desktop).

---

### 2025-08-22 - v3.3.1

#### Changed

- **Markdown optimizations**: Optimized exports

---

### 2025-08-22 - v3.3.0

#### Added

- **Automatic updates**: Application now checks for and downloads updates automatically on launch. App checks Github releases and will install the update after the user exits.
- **App logging**: Introduced electron-log for app logging, user log is located at `~/.mkeditor/main.log`.

---

### 2025-08-16 - v3.2.0

#### Added

- **LaTeX support**: Added support for writing expressions in LaTeX.

#### Changed

- **Bridge modularity**: Refactored out the bridge into a more modular structure.

---

### 2025-08-14 - v3.1.0

#### Added

- **Filetab reordering**: Added the ability to reorder open file tabs in the editor.

#### Changed

- **Filetree & DOM optimizations**: Various fixes and improvements to filetree and DOM rendering efficiency.

---

### 2025-08-12 - v3.0.1

#### Fixed

- **Large images layout bug**: Fixed an issue with large images causing a bug in the preview, images are now responsively resized.
- **User save prompt appearing incorrectly**: Fixed an issue with the user save prompt appearing when attempting to open a new file in a new tab. Prompt now only appears when you try to close the file without saving.

---

### 2025-08-11 - v3.0.0

#### Added

- **Filetree explorer and support for workspaces**: Added support for file tree explorer and editing multiple files.
