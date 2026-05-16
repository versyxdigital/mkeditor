# MKEditor — Roadmap

Living document. Tracks planned work, open architectural questions, and recently completed milestones. Update as decisions land. For current architecture see [ARCHITECTURE.md](ARCHITECTURE.md); for quick context see [../CLAUDE.md](../CLAUDE.md).

## Status Legend

- 🟢 Done
- 🟡 In progress
- 🔵 Planned, not started
- ⚪ Open question / needs decision

---

## Recently Landed

- 🟢 **Context & architecture docs** *(2026-05-16)* — Added [CLAUDE.md](../CLAUDE.md) and [docs/ARCHITECTURE.md](ARCHITECTURE.md) covering process boundaries, IPC contract, renderer composition, data flows, build pipeline, conventions.

---

## 1. React Migration *(planned — top priority)*

🟡 Replace the renderer's direct-DOM/Bootstrap UI layer with React. Monaco itself stays as-is — React owns the chrome around it (toolbar, sidebar, file tree, tabs, modals, settings, splash, splits), not the editor surface.

**Detailed plan**: [REACT_MIGRATION.md](REACT_MIGRATION.md) — stack decisions, target architecture, ten-phase execution plan, risks, and per-phase exit criteria. **Always defer to that doc for the migration.** This entry is a status pointer.

### Status

Stack decided 2026-05-16: React 19 + shadcn/ui + Tailwind v4, staying on Webpack, replacing split.js and SweetAlert2 along the way. Open questions from the prior version of this section are all answered in [REACT_MIGRATION.md §Decisions](REACT_MIGRATION.md#decisions). Execution not yet started.

---

## 2. Dependency Wiring / DI Cleanup

⚪ The current `manager.provide<T>(key, instance)` pattern (see [interfaces/Providers.ts](../src/browser/interfaces/Providers.ts)) has known sharp edges: weak typing on the indexed map, implicit construction order in [index.ts](../src/browser/index.ts), nullable provider fields requiring `?.` everywhere, and the same instances being registered against multiple managers.

**Status**: discussion in progress. Options on the table:

- **(A) Drop `provide()` for constructor injection** — pass deps directly to constructors, kill the indexed maps. Zero new deps, fixes typing and nullability, easier tests. Composition stays in `index.ts` as a `bootstrap()` function.
- **(B) Adopt a lightweight DI container** — e.g. `typed-inject` (~5kb, no decorators) or `tsyringe` (decorators, needs `reflect-metadata`). Buys lifecycle hooks, scoped resolution, swap-by-token testing. Cost: bundle weight + framework convention.
- **(C) Defer until React migration** — the migration tears up the provider wiring anyway; introducing context-based DI naturally during React adoption avoids doing the cleanup twice.

Decision needed before significant new feature work touches provider wiring.

---

## 3. Bring Up to Date *(catch-all)*

🔵 Generic "modernise" bucket. Concrete items to be added as they're identified — placeholders below.

- ⚪ **Dependency audit** — bundle size, security advisories, deprecations. Specifically check Electron (currently `^37.4.0`), Monaco (`^0.52.2`), markdown-it (`^14.1.0`).
- ⚪ **CI coverage** — extend GitHub Actions beyond the existing test workflow if useful (e.g. lint gate, build verification per platform).
- ⚪ **Logging levels as a setting** — TODO already in [main.ts:34](../src/app/main.ts#L34).
- ⚪ **Recent documents** — TODO in [main.ts:224](../src/app/main.ts#L224) ("get recent documents working or remove").
- ⚪ **Auto-update on macOS** — currently disabled pending code signing.

---

## 4. Post-React Opportunities *(speculative)*

Don't pursue these until React migration lands.

- ⚪ **Re-evaluate Bootstrap dependency** — once components are React, consider replacing the JS portion with headless primitives; keep or drop CSS independently.
- ⚪ **Component-level tests** — React Testing Library suite covering tabs, file tree, modals, settings.
- ⚪ **Theming** — current dark/light flips a `data-theme` body attribute; explore CSS-variables-driven themes once the component tree is in place.
- ⚪ **Plugin/extension system for users** — markdown-it has the seams already ([extensions/README.md](../src/browser/extensions/README.md)); the UI side would be far cleaner to extend post-React.

---

## How to Update This Doc

- Move items between sections as status changes; add a 🟢 entry with a date under **Recently Landed** when a milestone ships.
- When an ⚪ open question is resolved, write the decision in the same section and strike (or remove) the question.
- For larger workstreams (like React migration) keep one anchor heading and edit in-place rather than creating duplicate sections.
