# MKEditor — Roadmap

Living document. Tracks planned work, open architectural questions, and recently completed milestones. Update as decisions land. For current architecture see [ARCHITECTURE.md](ARCHITECTURE.md); for quick context see [../CLAUDE.md](../CLAUDE.md).

## Status Legend

- 🟢 Done
- 🟡 In progress
- 🔵 Planned, not started
- ⚪ Open question / needs decision

---

## Recently Landed

- 🟢 **Custom title bar** _(2026-05-17)_ — Frameless window on Windows/Linux with a VSCode-style in-window strip: logo + File/Edit/View/Help dropdowns + native min/max/close + drag region. macOS keeps its native menu bar via `titleBarStyle: 'hiddenInset'`. Menu items are model-driven (single `src/app/lib/menuModel.ts` consumed by both `AppMenu` and React `<TitleBar>`), Alt opens menus + Left/Right cycles, and labels are localised across all 13 supported locales. Three-phase delivery covered in [TITLE_BAR.md](TITLE_BAR.md); end-to-end surface in [ARCHITECTURE.md §4.13](ARCHITECTURE.md).
- 🟢 **Session restore** _(2026-05-17)_ — Open tabs, the active tab, the workspace folder, and per-tab cursor/scroll/folding state survive quit/relaunch on both desktop and web. Three-phase delivery covered in [SESSION_RESTORE.md](SESSION_RESTORE.md); end-to-end surface documented in [ARCHITECTURE.md §4.12](ARCHITECTURE.md).
- 🟢 **Web file explorer** _(2026-05-17)_ — Sidebar can open, browse, and edit local folders in Chromium-based browsers via the File System Access API. Workspace handle persists across refresh via IndexedDB.
- 🟢 **Dependency bumps + CI + pre-commit hook** _(2026-05-17)_ — Electron `^37.4.0` → `^42.1.0`, Monaco `^0.52.2` → `^0.55.1`, TS + ESLint upgraded. CI workflow extended with `prettier-check` and `build-editor`/`build-app` verification. Husky pre-commit hook runs `prettier-check` + `lint` + `test` on every commit (`npm install` wires it via `prepare`).
- 🟢 **React migration** _(2026-05-16)_ — Renderer rewritten as React 19 + shadcn/ui + Tailwind v4 on top of the existing managers and IPC bridge. Bootstrap, SweetAlert2, split.js, and `@popperjs/core` removed. CSS bundle shrunk ~229 KB. See [REACT_MIGRATION.md](REACT_MIGRATION.md) for the full ten-phase history; current state described in [ARCHITECTURE.md](ARCHITECTURE.md) and [../CLAUDE.md](../CLAUDE.md).
- 🟢 **Context & architecture docs** _(2026-05-16)_ — Added [CLAUDE.md](../CLAUDE.md) and [docs/ARCHITECTURE.md](ARCHITECTURE.md) covering process boundaries, IPC contract, renderer composition, data flows, build pipeline, conventions.

---

## 1. React Migration _(complete)_

🟢 Done (2026-05-16). The renderer is React 19 + shadcn/ui + Tailwind v4. Managers (Monaco, Files, FileTree, Bridge, providers) keep their roles; only the view layer changed. Bootstrap renderer-side, SweetAlert2, split.js, and `@popperjs/core` are gone. See [REACT_MIGRATION.md](REACT_MIGRATION.md) for the phase-by-phase history.

---

## 2. Dependency Wiring / DI Cleanup

⚪ The `manager.provide<T>(key, instance)` pattern (see [interfaces/Providers.ts](../src/browser/interfaces/Providers.ts)) still has the sharp edges that motivated the original entry: weak typing on the indexed map, implicit construction order in [index.ts](../src/browser/index.ts), the same provider instances registered against both `EditorManager` and `BridgeManager`. The React migration grew this pattern (every manager now also has a `subscribe`/`getSnapshot` observable surface + module-level `*External` callback seams), but didn't change the underlying `provide()` mechanism.

**Status**: deferred from before the React migration; now ready to revisit. Options:

- **(A) Drop `provide()` for constructor injection** — pass deps directly to constructors, kill the indexed maps. Zero new deps, fixes typing and nullability, easier tests. Composition stays in `index.ts` as a `bootstrap()` function.
- **(B) Adopt a lightweight DI container** — e.g. `typed-inject` (~5kb, no decorators) or `tsyringe` (decorators, needs `reflect-metadata`). Buys lifecycle hooks, scoped resolution, swap-by-token testing. Cost: bundle weight + framework convention.

Decision needed before significant new feature work touches provider wiring.

---

## 3. Bring Up to Date _(catch-all)_

🟡 In progress. Concrete items below.

- 🟢 **Dependency bumps** _(2026-05-17)_ — Electron `^37.4.0` → `^42.1.0`, Monaco `^0.52.2` → `^0.55.1`, TypeScript and ESLint upgraded alongside (see `package.json` for current versions). markdown-it stays on `^14.1.0` (current major).
- 🟢 **CI coverage** _(2026-05-17)_ — `.github/workflows/tests.yml` (renamed to `CI`) now runs `prettier-check`, `lint`, `test`, `build-editor`, and `build-app` on every PR/push to `main`/`develop`. Build steps catch webpack/tsc errors that the unit suite misses.
- 🟢 **Pre-commit hook** _(2026-05-17)_ — Husky 9 installed via the `prepare` script; `.husky/pre-commit` runs `prettier-check` + `lint` + `test` before every commit. `git commit --no-verify` bypasses in emergencies.
- ⚪ **Logging levels as a setting** — TODO at [main.ts:34](../src/app/main.ts#L34).
- ⚪ **Recent documents** — TODO at [main.ts:224](../src/app/main.ts#L224) ("get recent documents working or remove").
- ⚪ **Auto-update on macOS** — currently disabled pending code signing.

---

## 4. Post-React Opportunities

Now that the React migration is in.

- 🟢 **Session restore** _(2026-05-17)_ — Tabs, active tab, workspace folder, and per-tab cursor/scroll/folding persist across launches on both desktop and web. Three-phase delivery is documented in [SESSION_RESTORE.md](SESSION_RESTORE.md); end-to-end architecture in [ARCHITECTURE.md §4.12](ARCHITECTURE.md).
- 🔵 **AI Assistant** — In-editor agent that connects to OpenAI / Anthropic / Ollama and works against the open workspace + active editor. Right-hand collapsible sidebar (mirroring the file tree) with a tab per provider, per-provider conversation history, streaming responses, and a full read/write tool catalog (read/write/edit/create files, list workspace, operate on the active document or selection). Desktop routes provider calls through a main-process proxy with `safeStorage`-encrypted keys; web mode calls providers directly. Eight-phase delivery is documented in [AI_ASSISTANT.md](AI_ASSISTANT.md).
- 🔵 **Markdown-extension styling for the live preview.** The markdown-it extensions still emit Bootstrap class names (`alert alert-*`, `img-fluid`, `table table-sm table-bordered table-striped`) so the exported HTML (which CDN-loads Bootstrap) renders correctly. The live preview only has minimal fallback styling in `_preview.scss` — alert blocks and tables show as unstyled blocks today. Add Tailwind-aware rules (or rewrite the extensions to emit Tailwind classes + keep Bootstrap classes for export only) so the live preview matches the export.
- 🔵 **Expanded component test coverage.** Phase 10 landed the 5 spec'd RTL suites (`TabBar`, `FileTreePanel`, `SettingsModal`, `EditorToolbar`, `PreviewPane`). Next layer: the rest of `react/components/modals/*`, `BottomToolbarRight`, `Navbar`, the `PromptDialog` flow, hooks (`useCounts`, `useNotify`).
- ⚪ **Theming customisation.** Dark/light is hardwired today; explore exposing the brand `--primary` and a couple of secondary tokens as user settings.
- ⚪ **Plugin/extension system for users.** markdown-it has the seams already ([extensions/README.md](../src/browser/extensions/README.md)); the React UI side is now much easier to extend.
- ⚪ **Phase 9 dom.ts residue.** `dom.ts` retains four constants (`editor.dom`, `preview.dom`, `preview.wrapper`, `meta.scroll`) for `HTMLExporter` + `ScrollSync` + `LineNumber` + the test fallback. If those consumers move under React (or expose their own seam), the file can be retired entirely.
- ⚪ **`document.getElementById` portal-host pattern.** `<EditorToolbar>` and `<BottomToolbarRight>` portal into static-HTML hosts inside the bottom `<nav>` shell. Could be cleaned up by either rendering the bottom nav from React directly, or moving the `<nav>` shell inside `#react-root`.

---

## How to Update This Doc

- Move items between sections as status changes; add a 🟢 entry with a date under **Recently Landed** when a milestone ships.
- When an ⚪ open question is resolved, write the decision in the same section and strike (or remove) the question.
- For larger workstreams (like React migration) keep one anchor heading and edit in-place rather than creating duplicate sections.
