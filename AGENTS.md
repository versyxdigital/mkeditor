# MKEditor — Agent Instructions

This is the single source of truth for project-wide AI agent guidance. It applies throughout the repository. `CLAUDE.md` imports this file; keep provider-specific entry points as pointers instead of maintaining duplicate instructions.

## Project objectives

MKEditor is a Markdown editor built with TypeScript, React, and Monaco. One renderer bundle runs as a standalone web application and inside Electron on Windows, macOS, and Linux. Read [README.md](README.md) for the user-facing feature set and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution practices.

When implementing changes, preserve these priorities:

- Keep writing and editing responsive: Monaco editing, live preview, scroll sync, formatting commands, and keyboard navigation are the core experience.
- Protect users' documents, unsaved edits, undo history, settings, and sessions. Handle cancellation and storage failures explicitly.
- Preserve both runtime modes. Shared editing features should work on web and desktop; platform capabilities belong behind the existing bridge or an explicit mode boundary.
- Keep preview and exported HTML/PDF consistent, including alerts, tables, syntax highlighting, and KaTeX math.
- Keep the interface accessible, localised, and consistent across light and dark themes.
- Keep AI assistance optional and under the user's control. Provider access, context sharing, and file writes must respect the existing desktop and confirmation boundaries.

## Before changing code

1. Read the implementation and nearby tests for the affected subsystem. Trace the path from the UI through managers and the bridge when a change crosses layers.
2. Consult [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the overall design and [docs/ROADMAP.md](docs/ROADMAP.md) for planned work. Feature histories live in [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md), [docs/SESSION_RESTORE.md](docs/SESSION_RESTORE.md), [docs/TITLE_BAR.md](docs/TITLE_BAR.md), and [docs/REACT_MIGRATION.md](docs/REACT_MIGRATION.md).
3. Verify descriptions against current code and configuration. Some historical docs still describe the old web scratch-buffer flow, Bootstrap CDN exports, or a Markdown-only explorer. Do not reintroduce those behaviours based on prose alone. Read versions and commands from [package.json](package.json).
4. Keep the change focused. Preserve existing uncommitted work, follow neighbouring patterns, and avoid unrelated refactors, dependency upgrades, or formatting churn. Deferred roadmap proposals are not instructions to implement them during another task.

## Code map and ownership

| Concern                    | Start here                                                                                                                                                                                                                                    | Responsibility                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Renderer startup           | [src/browser/index.ts](src/browser/index.ts)                                                                                                                                                                                                  | Detect mode/platform, mount React, lazy-load managers, wire providers after Monaco is ready |
| Editor                     | [src/browser/core/EditorManager.ts](src/browser/core/EditorManager.ts)                                                                                                                                                                        | Primary Monaco editor, diff-preview factory, layout, editor events                          |
| Files and sessions         | [src/browser/core/FileManager.ts](src/browser/core/FileManager.ts)                                                                                                                                                                            | Models, tabs, dirty baselines, view state, session serialisation/restore                    |
| Explorer                   | [src/browser/core/FileTreeManager.ts](src/browser/core/FileTreeManager.ts)                                                                                                                                                                    | Tree state, lazy directory loading, rename/move updates                                     |
| Renderer bridge            | [src/browser/core/BridgeManager.ts](src/browser/core/BridgeManager.ts), [BridgeListeners.ts](src/browser/core/BridgeListeners.ts)                                                                                                             | Manager wiring, outgoing operations, incoming channel dispatch                              |
| Browser file access        | [src/browser/core/WebFileBridge.ts](src/browser/core/WebFileBridge.ts)                                                                                                                                                                        | File System Access API, virtual paths, IndexedDB handles, web session storage               |
| Settings and commands      | [src/browser/core/providers/](src/browser/core/providers/), [config.ts](src/browser/config.ts)                                                                                                                                                | Defaults, settings side effects/persistence, Monaco actions, completions, Markdown links    |
| React UI                   | [src/browser/react/App.tsx](src/browser/react/App.tsx), [contexts/](src/browser/react/contexts/), [components/](src/browser/react/components/)                                                                                                | Provider tree, chrome, panels, dialogs, hooks, presentation                                 |
| Markdown and export        | [Markdown.ts](src/browser/core/Markdown.ts), [extensions/](src/browser/extensions/), [markdownStyles.ts](src/browser/markdownStyles.ts), [HTMLExporter.ts](src/browser/core/HTMLExporter.ts)                                                  | Rendering pipeline, shared document styling, standalone exports                             |
| Desktop lifecycle          | [src/app/main.ts](src/app/main.ts), [AppWindow.ts](src/app/lib/AppWindow.ts), [AppMenu.ts](src/app/lib/AppMenu.ts), [menuModel.ts](src/app/lib/menuModel.ts)                                                                                  | Window, native integrations, menu actions, tray, updates, quit                              |
| Desktop bridge and storage | [src/app/preload.ts](src/app/preload.ts), [AppBridge.ts](src/app/lib/AppBridge.ts), [AppStorage.ts](src/app/lib/AppStorage.ts), [AppSettings.ts](src/app/lib/AppSettings.ts), [AppSession.ts](src/app/lib/AppSession.ts)                      | Restricted IPC, filesystem operations, persistence                                          |
| AI integration             | [AssistantManager.ts](src/browser/core/AssistantManager.ts), [AssistantTools.ts](src/browser/core/AssistantTools.ts), [AssistantContextSource.ts](src/browser/core/AssistantContextSource.ts), [AppAssistant.ts](src/app/lib/AppAssistant.ts) | Chat state, tool catalog, context access, upstream provider streams                         |
| Shared contracts           | [src/browser/interfaces/](src/browser/interfaces/), [src/app/interfaces/](src/app/interfaces/), [src/app/shared/](src/app/shared/), [@types/index.d.ts](@types/index.d.ts)                                                                    | Payloads, settings/session types, platform-neutral data, window declarations                |
| Localisation               | [locale/](locale/), [src/browser/i18n.ts](src/browser/i18n.ts)                                                                                                                                                                                | Namespace resources, language loading, translation runtime                                  |
| Validation                 | [tests/](tests/), [tests/react/](tests/react/), [tests/utils/render.tsx](tests/utils/render.tsx)                                                                                                                                              | Behaviour tests, React tests, provider/manager test helpers                                 |

## Architecture rules

**Managers own data and IPC. React owns UI and presentation.**

- Keep business logic, model mutations, persistence, provider calls, and IPC in managers/providers or the main process. React components call manager methods and render snapshots.
- Do not import React or Radix into `core/`. Do not import `ipcRenderer`, access `window.executionBridge`, or add direct storage access inside React components. Use contexts and manager methods.
- Expose reactive manager data through `subscribe(listener) → unsubscribe` and a stable `getSnapshot()`. File/tree managers use the equivalent `on('change', listener)` surface. Rebuild the snapshot when state changes; repeated reads between notifications must return the same reference.
- Read snapshots with `useSyncExternalStore` in contexts. Supply stable empty/default snapshots while managers are null during startup. Keep presentation-only state, such as dialog visibility and expansion, in React; do not mirror manager-owned state there.
- Imperative manager-to-UI interactions use registered module-level callbacks: `openModalExternal`, `openPromptExternal`, `showPropertiesExternal`, and the neutral seams [notify.ts](src/browser/notify.ts), [toolConfirm.ts](src/browser/toolConfirm.ts), [menuDispatch.ts](src/browser/menuDispatch.ts), and [assistantUiState.ts](src/browser/assistantUiState.ts). Follow an existing seam rather than coupling a manager to a component. Some older callbacks are exported from context modules; that is not a precedent for adding UI dependencies to managers.
- Keep composition in `index.ts` and the provider tree in `App.tsx`. React mounts before the async Monaco/manager imports finish; `EditorHost` creates the editor when its manager becomes available, then `onEditorReady` wires providers and bridges. Preserve this ordering and tolerate temporarily null managers.
- Reuse the existing `provide(key, instance)` wiring and injected callbacks for focused changes. A broader DI rewrite remains a separate architectural decision.
- Cross-folder imports are allowed for shared types and pure data, such as `src/app/interfaces/Assistant.ts`, `src/app/shared/fileExtensions.ts`, and the platform-neutral menu model. Keep Electron, Node filesystem APIs, and provider SDK runtime imports out of the renderer dependency graph. Shared code needed by main must fit `src/app/tsconfig.json`'s root.

## Web and desktop compatibility

- `getExecutionBridge()` detects the runtime at the composition root. Desktop uses the preload bridge; web uses `WebFileBridge`. Both implement `ContextBridgeAPI` and construct `BridgeManager`, `FileManager`, `FileTreeManager`, and the shared listeners.
- Use the existing `mode: 'web' | 'desktop'`, `Managers.platform`, and bridge abstractions at the appropriate layer. Avoid repeated global checks or user-agent sniffing in components.
- Web filesystem paths are virtual paths rooted at the selected directory name. Desktop paths are OS paths. Keep their resolution separate; reuse `normalizeVirtualPath` and the existing desktop path helpers. Cover Windows separators, POSIX paths, spaces, Unicode, and traversal when changing path handling.
- Web folder access depends on the File System Access API. Preserve capability checks and unavailable/cancelled/denied-permission behaviour. Silent restore may query permission; permission requests requiring a user gesture belong in an interactive action.
- Web settings use `localStorage`; sessions use `mkeditor-session`; workspace handles use IndexedDB. `mkeditor-content` is a legacy migration input, not the current persistence model.
- Desktop stores settings, sessions, and assistant data separately under `~/.mkeditor/` as `settings.json`, `session.json`, and `assistant.json`.
- The AI Assistant UI and provider calls are desktop-only. `BridgeManager` currently constructs an assistant manager in both modes, but web has no main-process AI service/config push. Preserve the feature gates; do not add browser API-key storage or a renderer SDK path as part of shared UI work.

## Monaco, files, and persistence

- There is one primary editable Monaco editor, owned by `EditorManager` and hosted by `EditorHost`. Switching file tabs swaps models rather than recreating the editor. Read-only diff previews are a supported exception, created through `EditorManager.createDiffPreview` and disposed through their returned handles.
- `FileManager` owns tab/model identity, dirty flags, saved baselines, view state, and rename/move bookkeeping. Use its operations so these stay in sync. Dirty state uses Monaco alternative-version IDs so undoing back to a saved revision clears the dirty indicator.
- Preserve undo/redo for targeted editing operations with Monaco edits, following existing `executeEdits` paths. Reserve whole-model replacement for flows that intentionally load or replace a complete document.
- For operations targeting the backing file, use `getActiveEditablePath()` where appropriate. `activeFile` can be a synthetic `diff://...` tab ID; untitled buffers may have no filesystem path. Never send synthetic IDs to filesystem operations.
- Prefer an open Monaco model over disk when reading document context: it contains the user's unsaved edits. Reuse the read/context helpers rather than opening unnecessary tabs or implementing another file cache.
- Preserve unsaved-change prompts for closing tabs, switching workspaces, and quitting. Keep cancellation non-destructive, and do not report a successful write until the relevant acknowledged operation has succeeded. AI tools use awaited file helpers because menu save channels are fire-and-forget.
- Preserve session restore guards: restore once, suppress saves during replay, and suspend web session saves before seeding an untitled buffer so startup cannot overwrite a saved session. Ephemeral diff tabs must stay out of persisted sessions.
- Keep settings, session, and assistant schemas validated and compatible with existing saved data. Update defaults, interfaces, load/merge validation, persistence, and UI together when adding settings. Use the existing atomic temporary-file/rename paths for session and assistant writes; preserve unrelated sections of `assistant.json`.
- Preserve final session/conversation flushes on shutdown. [quitFlush.ts](src/app/lib/quitFlush.ts) waits for both acknowledgements with a bounded timeout; web has its own `beforeunload` flush. Do not assume a debounce always fires before exit.
- Clean up listeners, observers, timers, and Monaco resources at their owning lifecycle boundary. Keep method receivers intact (`disposable.dispose()`). Detach/swap active models before disposing them; diff-preview handles dispose the editor before their models.
- The explorer's curated extension list is defined in [src/app/shared/fileExtensions.ts](src/app/shared/fileExtensions.ts) and consumed by desktop, web, and the filter UI. Update that source rather than duplicating allowlists; Markdown is the default visible selection.

## Desktop IPC and AI boundaries

- Keep `contextIsolation: true` and `nodeIntegration: false`. Extend the narrow preload API instead of exposing raw Electron/Node access.
- For a new send/receive channel, add it to the appropriate `senderWhitelist` or `receiverWhitelist` in `preload.ts`, implement its handler, and update its payload types and callers. Invoke helpers also need their preload exposure and `@types/index.d.ts` declaration. Consider the web bridge behaviour for shared operations.
- Register main-process handlers through `AppBridge`/`AppWindow`'s sender-scoped helpers. Use `AppStorage.assertInWorkspace` for renderer-invoked workspace filesystem access and operate on the validated path. Preserve canonicalisation and traversal checks; a renderer-side path check cannot replace the main-process boundary.
- Keep one menu definition in `menuModel.ts` for native menus and the React title bar. Preserve macOS native menu behaviour and Windows/Linux window controls.
- `AssistantManager` owns conversations, drafts, context controls, stream buffers, pending confirmations, and call routing. `AssistantTools` owns descriptors, classification, previews, and execution through existing managers. `AssistantContextSource` owns read-only context access. `AppAssistant` owns provider SDK adapters, upstream streams, cancellation, and stable error-code mapping.
- Keep Anthropic/OpenAI/Ollama provider handling behind the existing Vercel AI SDK integration. The renderer must not instantiate provider clients or receive stored keys. New provider support needs coordinated contracts, configuration, UI, localisation, and tests.
- Key entry briefly exists in renderer memory; `SecureChannelClient` encrypts it before IPC, main's `SecureChannel` decrypts it, and `AssistantKeyStore` uses Electron `safeStorage` for encryption at rest. Preserve both boundaries. Config responses expose `hasKey`, never secret values. Do not log keys or add plaintext persistence fallbacks when encryption is unavailable.
- Define tools once in `AssistantTools`' catalog, including JSON Schema, read/write classification, execution, and relevant preview/full-preview support. Write tools require the user's confirmation unless that conversation explicitly enables auto-accept. Keep unknown tools rejected and confirmation/cancellation handling consistent for inline and modal UI.
- Route chunks, tool calls, errors, and completion by `callId`/`toolCallId`, not the active provider tab. Preserve provider/conversation isolation, ignore late events for finished calls, and clear pending confirmations on cancellation.
- Preserve the upstream tool-loop ordering: append the assistant tool-call message and collect matching tool results before starting the next provider turn. Failures/rejections still need a matching result while the call is live; do not leave the stream waiting indefinitely.
- Respect per-conversation context sharing and explicit file mentions. Do not add silent workspace scanning or automatic disclosure of additional files.

## TypeScript and coding style

- Follow [.prettierrc](.prettierrc): two-space indentation, semicolons, single quotes, and spaces inside object braces. Let Prettier decide wrapping. Format changed files instead of running a repository-wide write for an unrelated task.
- Keep TypeScript strict. Use `import type` or inline `type` imports for type-only dependencies, as required by [eslint.config.mjs](eslint.config.mjs). Prefer explicit domain interfaces, narrow unions, and `unknown` with validation at external boundaries over new unchecked `any` casts. Existing permissive lint rules are not a reason to weaken new code.
- Match local naming and exports: PascalCase manager/component files, camelCase functions and fields, `use...` hooks, and named exports in most managers/components. Markdown-it extensions currently use default exports; follow the surrounding module's convention.
- React uses function components and typed props; `import * as React` and `React.use...` are the prevailing style. Reuse contexts/hooks and existing UI primitives before adding another state store or component framework.
- Keep functions and helpers focused. Prefer direct, readable control flow, explicit success/failure results where callers need them, and small dependency interfaces/callbacks for test seams.
- Use comments to explain lifecycle ordering, platform constraints, invariants, and non-obvious workarounds. Update relevant comments when behaviour changes; avoid narrating straightforward statements.
- Preserve existing debounce/batching and lazy-loading boundaries. Monaco, manager imports, and modals are loaded asynchronously to limit startup work. Avoid pulling heavy SDKs, extra Monaco features/languages, or large UI dependencies into the initial renderer bundle without a task-specific reason.
- Webpack routes bare Monaco imports through [src/browser/monaco.ts](src/browser/monaco.ts) to retain the supported language/feature subset and version-specific diff lifecycle fixes. Keep [tests/monaco.compatibility.test.ts](tests/monaco.compatibility.test.ts) and real-browser editing/completion/diff checks in the validation path when upgrading Monaco or changing this entry point.

## UI, Markdown, and localisation

- Reuse shadcn/Radix primitives in `src/browser/react/components/ui/`, `cn(...)` for class composition, and existing variant/ref conventions. Keep keyboard interactions, focus handling, accessible labels, tooltips, and dialog dismissal working.
- Use the shared palette in `src/app/shared/designTokens.ts` and Tailwind aliases in `react/styles/tailwind.css`; support light and `[data-theme='dark']` modes. Follow the document-first neutral surfaces and restrained teal brand accent in [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Avoid feature-local colour systems or reintroducing Bootstrap UI JavaScript/SweetAlert2.
- Document styling is separate from app chrome. [markdownStyles.ts](src/browser/markdownStyles.ts) is injected into the live preview and inlined by `HTMLExporter`. Extensions still emit some Bootstrap-compatible class names, but exports no longer load Bootstrap/FontAwesome from a CDN. Keep shared styling in this stylesheet and verify styled/unstyled HTML and print/PDF behaviour when changing it.
- Extend the existing markdown-it singleton and modular plugins. Preserve default renderer delegation and use token attribute helpers. `LineNumber` metadata is required by `ScrollSync`; exports strip that internal metadata.
- Assistant messages use `renderAssistantMarkdown`, which disables raw HTML during rendering and restores the shared parser option afterwards. Keep this separate from the document preview's intentional raw-HTML support. `HTMLExporter.sanitizeHTML` removes internal preview markers; it is not a general security sanitizer.
- Preserve existing local-asset and `mked://` link resolution through the dedicated helpers. Relative links/images should resolve against the real document/workspace, including when a diff tab covers the editor.
- Translate new user-visible strings through `useTranslation()` in React or `t` from `i18n.ts` outside React. Include the hook's `language` dependency when memoising translated labels so language/bundle changes invalidate them.
- Edit namespace JSON sources under `locale/<language>/`, including nested `menus/` and `modals/` files. Preserve key parity across the 13 supported locales and reuse established namespaces. `all.json` is generated by `scripts/combine-locales.mjs`; regenerate it instead of hand-editing it. `node scripts/audit-i18n-coverage.mjs` can report gaps after regeneration, but does not replace review of dynamic keys or translation quality.
- Main does not run i18next. Send notifications as `{ status, key: 'notifications:...', values? }` and translate in the renderer; use the existing sonner seam. The old `data-i18n-*` DOM walker remains only for the splash heading.

## Validation and delivery

Use the Node/npm toolchain in [package.json](package.json) and [.github/workflows/tests.yml](.github/workflows/tests.yml) (Node 24.x, selected by [.nvmrc](.nvmrc)). Install locked dependencies with `npm ci` when needed.

| Purpose                       | Command                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| Check formatting              | `npm run prettier-check`                                        |
| Format specific files         | `npx prettier <changed-files> --write`                          |
| Lint production source        | `npm run lint`                                                  |
| Run the unit/component suite  | `npm test -- --runInBand`                                       |
| Run a relevant suite          | `npm test -- --runInBand --runTestsByPath tests/<file>.test.ts` |
| Build renderer                | `npm run build-editor`                                          |
| Compile Electron main/preload | `npm run build-app`                                             |
| Serve built web app           | `npm run serve-web`                                             |
| Launch built desktop app      | `npm run serve-app`                                             |

- Jest uses `ts-jest` and jsdom. Manager/main-process suites live in `tests/`; React Testing Library suites live in `tests/react/`. Reuse `tests/utils/render.tsx` and existing observable manager fakes. Extend the Electron/Monaco mocks under `tests/__mocks__/` when the changed API requires it.
- Add or update behavioural tests for feature work and bug fixes. Prioritise data integrity, state transitions, subscription/snapshot behaviour, denied permissions, failed writes, cancellation, restore, and concurrency where relevant. Assert user-visible outcomes and contracts instead of duplicating implementation details.
- Run focused tests while iterating. For code changes, complete formatting, lint, tests, and the affected builds; run both builds for shared contracts or dependencies. CI runs all three checks and both builds, and the Husky pre-commit hook runs formatting, lint, and tests. Do not bypass failing checks to present work as verified.
- For documentation-only changes, check formatting, links, command names, and factual claims against source; application tests/builds are unnecessary unless behaviour or configuration also changed.
- Browser/OS integration needs manual verification when affected: edit/save/undo and preview; switch tabs/workspaces with unsaved content; restore after relaunch; export HTML/PDF; exercise relevant desktop/web capability paths; check keyboard use, both themes, and localisation. Unit mocks do not prove native pickers, OS key storage, Electron menus, or printing work.
- `build-editor` regenerates `src/browser/version.ts` from `package.json` and locale `all.json` bundles. Edit their sources, not generated output. Review build-generated diffs and avoid committing unrelated artifacts from `dist/`, `releases/`, or `coverage/`.
- Keep architecture and feature docs aligned when changing ownership, IPC, persistence, or user-visible behaviour. Keep agent guidance here and `CLAUDE.md` as its import pointer. Avoid copying exhaustive versions, channel lists, or schemas into this file when their code definitions can be linked.
- Report what changed, why, which checks actually ran, and any remaining limits or failures. Distinguish pre-existing failures from regressions. Changes remain subject to developer review under the repository's AI usage policy; do not claim testing or manual review that did not happen.
