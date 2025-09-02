# CHANGELOG

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
