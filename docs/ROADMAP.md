# MKEditor — Roadmap

Living document. Tracks planned work, open architectural questions, and recently completed milestones. Update as decisions land. For current architecture see [ARCHITECTURE.md](ARCHITECTURE.md); for quick context see [../CLAUDE.md](../CLAUDE.md).

## Status Legend

- 🟢 Done
- 🟡 In progress
- 🔵 Planned, not started
- ⚪ Open question / needs decision

---

## Recently Landed

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
- 🟢 **CI coverage** _(2026-05-17)_ — `.github/workflows/tests.yml` (renamed to `CI`) now runs lint, jest, `build-editor`, and `build-app` on every PR/push to `main`/`develop`. Build steps catch webpack/tsc errors that the unit suite misses.
- ⚪ **Logging levels as a setting** — TODO at [main.ts:34](../src/app/main.ts#L34).
- ⚪ **Recent documents** — TODO at [main.ts:224](../src/app/main.ts#L224) ("get recent documents working or remove").
- ⚪ **Auto-update on macOS** — currently disabled pending code signing.

---

## 4. Post-React Opportunities

Now that the React migration is in.

- 🔵 **Session restore (open tabs + view state).** Today `FileManager.viewStates` keeps per-tab cursor/selection/scroll/folding in memory, so switching tabs within a session restores exactly where you were — but a fresh launch starts every tab at top-of-file and the open-tab list itself is lost. Goal: tabs reopen on launch, each at the last cursor/scroll position. Full plan in [SESSION_RESTORE.md](SESSION_RESTORE.md) — three phases, agents (`session-phase-executor`, `session-phase-reviewer`, `session-architecture-auditor`, `session-test-auditor`), and slash commands (`/session-phase`, `/session-status`, `/session-review`) live alongside the React-migration equivalents.
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
