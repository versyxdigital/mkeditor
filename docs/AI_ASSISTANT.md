# AI Assistant Plan

Phased plan for adding an in-editor AI Assistant to MKEditor — a right-hand sidebar (mirroring the file tree) that hosts per-provider chat surfaces, connects to OpenAI / Anthropic / Ollama, and gives an agent first-class read/write access to the workspace and the active editor. The high-level entry in [ROADMAP.md](ROADMAP.md) links here.

Read first: [../CLAUDE.md](../CLAUDE.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Decisions

| Area                      | Decision                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider abstraction      | [Vercel AI SDK](https://sdk.vercel.ai) (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `ollama-ai-provider-v2`). One `streamText`/`generateText` surface, one tool-call shape, one message schema across all three providers. Adding a fourth provider later is one adapter and a settings row. The `-v2` suffix on the Ollama adapter is the package's actual name on npm — the original `ollama-ai-provider` package was abandoned at SDK spec v1 and a fresh package was published once the SDK moved to spec v3. |
| API call location         | **Desktop**: main-process proxy. Renderer sends `to:ai:chat` with the conversation + tools; main owns the SDK, the API keys, and the upstream stream; chunks flow back as `from:ai:chunk`. **Web**: renderer calls the providers directly through the same SDK (no main process exists). The renderer-side `AssistantManager` hides the split.     |
| API key storage           | **Desktop**: Electron `safeStorage`-encrypted, stored in `~/.mkeditor/assistant.json` (sibling of `settings.json` and `session.json`). Keys never enter the renderer process. **Web**: plaintext `localStorage` (`mkeditor-assistant-keys`) with a visible "stored in your browser" warning in the settings UI.                                    |
| Conversation organisation | Right sidebar has a tab strip across the top — one tab per **enabled** provider (Anthropic / OpenAI / Ollama). Each tab owns a list of past conversations + a "new chat" button. Switching tabs preserves draft input per provider. Conversations persist to `~/.mkeditor/assistant.json` (desktop) / `mkeditor-assistant` localStorage (web).     |
| Tool catalog (v1)         | Full toolset: `read_file`, `write_file`, `edit_file`, `create_file`, `list_files`, `get_active_file`, `get_selection`, `replace_selection`, `insert_at_cursor`, `open_tab`. Defined once in `src/browser/core/AssistantTools.ts`; description + Zod schema shared between desktop (sent over IPC) and web (used directly).                         |
| Tool execution policy     | Read-class tools auto-execute. Write-class tools (`write_file`, `edit_file`, `create_file`, `replace_selection`, `insert_at_cursor`) open a confirm prompt via the existing `openPromptExternal` seam before running. Each chat has an "auto-accept writes for this conversation" toggle, defaulting **off**. No global auto-accept setting in v1. |
| Streaming                 | Chunks ferried by call id. Renderer holds an in-flight call map; main holds the upstream stream + cancel handle. `to:ai:cancel` with the call id aborts. Concurrent calls (one per provider tab) are supported; the SDK's `AbortController` plus per-call ids keep them isolated.                                                                  |
| Tool-call UX              | Each tool call renders as a collapsible card in the message stream (`▸ read_file workspace/README.md`). Expanded view shows arguments + result. Failures show inline error + a retry button. Pending confirmations float a `<ConfirmToolCall>` dialog (uses the existing `AlertDialog` primitive).                                                 |
| Context controls          | Active file + current selection are included automatically as a tagged system message; user can toggle "share active file" per chat. `@` in the input opens a file picker built from `FileTreeManager.snapshot()` for explicit cross-file context. No silent workspace scanning.                                                                   |
| Models                    | Per-provider model picker in settings, persisted as the chat default. The chat header has a quick-switch dropdown to override the model for the next message. Ollama models populate from a one-shot `to:ai:ollama:list` (main calls `localhost:11434/api/tags`).                                                                                  |
| Cost / token telemetry    | Out of scope for v1. The SDK reports `usage` on stream end; we log it via `window.logger.info` (desktop) but don't surface it in the UI. Revisit in a polish phase.                                                                                                                                                                                |
| Concurrent providers      | Each provider tab has at most one in-flight call. A second send while a call is in flight either cancels-and-replaces (with explicit "Stop" affordance) or queues — pick during P4 once the UX is concrete.                                                                                                                                        |
| Ollama on web             | Ollama on web works only if the user runs the daemon with `OLLAMA_ORIGINS=*` (or a matching origin). The settings UI shows a notice; we don't try to detect.                                                                                                                                                                                       |
| State ownership           | `AssistantManager` (renderer) owns chat state, in-flight calls, conversation history. `AppAssistant` (main) owns the SDK, key storage, upstream streams. `AssistantTools` (renderer) owns tool dispatch into the existing managers (no new IPC surface for tool execution — it just calls `FileManager` / `FileTreeManager` / `EditorManager`).    |

### State ownership rule

> **Managers own provider plumbing, IPC, and chat data. React owns chat layout, message rendering, tool-card UX, and confirmation dialogs.**

[AssistantManager](../src/browser/core/AssistantManager.ts) is the renderer-side data owner — it tracks tabs, conversations, in-flight calls, streaming buffers, settings snapshots, and the active provider. It exposes the standard `subscribe(listener)` / `getSnapshot()` pair so React reads through `useSyncExternalStore`. It does **not** import React. Tool calls dispatch through [AssistantTools](../src/browser/core/AssistantTools.ts), which calls into [FileManager](../src/browser/core/FileManager.ts), [FileTreeManager](../src/browser/core/FileTreeManager.ts), [EditorManager](../src/browser/core/EditorManager.ts), and [BridgeManager](../src/browser/core/BridgeManager.ts) — no React imports there either. Confirmation prompts cross the manager → React boundary through the existing `confirmExternal` seam.

[AppAssistant](../src/app/lib/AppAssistant.ts) (main) owns the Vercel AI SDK instance and `safeStorage`-encrypted key file. Web mode replaces the IPC hop with a direct in-renderer SDK call via a small adapter so `AssistantManager`'s public surface stays identical.

## Target Architecture

```
src/app/
├── lib/
│   ├── AppAssistant.ts                NEW — Vercel AI SDK wrapper; streamText/cancel; provider registry
│   ├── AssistantKeyStore.ts           NEW — safeStorage-encrypted ~/.mkeditor/assistant.json key section
│   └── AssistantConfig.ts             NEW — non-secret config (selected models, enabled providers); plain JSON
├── AppBridge.ts                       MODIFIED — wire to:ai:* handlers; relay from:ai:chunk/done/error/tool-call
└── preload.ts                         MODIFIED — whitelist to:ai:* and from:ai:* channels

src/browser/
├── core/
│   ├── AssistantManager.ts            NEW — chat state, tabs, in-flight calls, observable surface
│   ├── AssistantTools.ts              NEW — tool catalog + dispatcher into File/Tree/Editor managers
│   ├── AssistantTransport.ts          NEW — abstracts IPC vs direct SDK call (desktop vs web)
│   └── BridgeListeners.ts             MODIFIED — route from:ai:* events into AssistantManager
├── react/
│   ├── contexts/
│   │   ├── AssistantContext.tsx       NEW — useAssistant hook; reads AssistantManager snapshot
│   │   └── UIStateContext.tsx         MODIFIED — add rightSidebarOpen + setter
│   ├── components/
│   │   ├── AssistantSidebar.tsx       NEW — right-hand collapsible/resizable shell; provider tab strip
│   │   ├── assistant/
│   │   │   ├── ProviderTab.tsx        NEW — per-provider conversation list + active chat
│   │   │   ├── ConversationList.tsx   NEW — sidebar within sidebar; new-chat button; rename/delete
│   │   │   ├── ChatPane.tsx           NEW — message list + input + model picker + stop button
│   │   │   ├── ChatMessage.tsx        NEW — user/assistant bubble; markdown render via Markdown manager
│   │   │   ├── ToolCallCard.tsx       NEW — collapsible tool invocation row (args + result + status)
│   │   │   ├── ConfirmToolCall.tsx    NEW — AlertDialog for write-class tools when auto-accept is off
│   │   │   ├── ContextChip.tsx        NEW — "active file: X.md (143 lines)" + remove
│   │   │   ├── MentionPicker.tsx      NEW — @-autocomplete fed by FileTreeManager
│   │   │   └── AssistantSettings.tsx  NEW — per-provider enable/key/model section (mounted in SettingsModal)
│   │   └── Navbar.tsx                 MODIFIED — assistant toggle button (mirror of sidebar toggle)
│   └── App.tsx                        MODIFIED — Shell wraps Workspace + AssistantSidebar in outer Group

locale/<lng>/assistant.json            NEW — chat UI strings, provider names, error messages (en first)

docs/
├── AI_ASSISTANT.md                    this doc
├── ROADMAP.md                         MODIFIED — link plan, add milestone row
└── ARCHITECTURE.md                    MODIFIED at end of P7 — new §4.14 covering AI Assistant surface + IPC

tests/
├── AppAssistant.test.ts               NEW — provider registry, streaming round-trip, cancel, error mapping
├── AssistantKeyStore.test.ts          NEW — encrypt/decrypt round-trip, malformed file recovery
├── AssistantManager.test.ts           NEW — tab + conversation CRUD, streaming append, cancel, persist
├── AssistantTools.test.ts             NEW — every tool dispatches to the right manager; confirm path
└── react/
    ├── AssistantSidebar.test.tsx      NEW — collapse/expand, resize persists, tab switch preserves draft
    ├── ChatPane.test.tsx              NEW — send message, stream render, stop, model override
    └── ToolCallCard.test.tsx          NEW — pending/confirm/accept/reject/error states
```

## Persistence Schema

```ts
/** ~/.mkeditor/assistant.json (desktop) / mkeditor-assistant (web). */
interface AssistantPayload {
  version: 1;
  providers: ProviderConfigMap;
  /** Conversations grouped by provider id. Insertion order = recency-descending. */
  conversations: Record<ProviderId, ConversationRecord[]>;
  /** Last selected provider tab. */
  activeProvider: ProviderId | null;
  /** Per-provider last-open conversation id. */
  activeConversation: Record<ProviderId, string | null>;
}

type ProviderId = 'anthropic' | 'openai' | 'ollama';

interface ProviderConfigMap {
  anthropic: { enabled: boolean; defaultModel: string /* key in keystore */ };
  openai: { enabled: boolean; defaultModel: string /* key in keystore */ };
  ollama: {
    enabled: boolean;
    baseUrl: string;
    defaultModel: string; /* no key */
  };
}

interface ConversationRecord {
  id: string; // uuid
  title: string; // first-message-derived; user-renamable
  createdAt: number; // epoch ms
  updatedAt: number;
  model: string; // captured at send time
  messages: ChatMessage[];
  autoAcceptWrites: boolean; // per-chat write-confirmation override
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string; // markdown for user/assistant; JSON for tool
  toolCalls?: ToolCallRecord[];
  createdAt: number;
}

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: unknown;
  status: 'pending' | 'confirmed' | 'rejected' | 'succeeded' | 'failed';
  result?: unknown;
  error?: string;
}
```

API keys live in a separate, encrypted-at-rest section managed by [AssistantKeyStore](../src/app/lib/AssistantKeyStore.ts); they never appear in `AssistantPayload`. On web, keys live in their own localStorage entry (`mkeditor-assistant-keys`) so the conversation payload can be exported/imported without leaking secrets.

## Cross-cutting Concerns

- **No `?.` provider chains in React.** `<AssistantSidebar>` and its children consume `useAssistant()` — `AssistantManager` is constructed in `onEditorReady` (alongside `BridgeManager`) and threaded through the same `setReactManagers` setter, so components see a non-null instance.
- **IPC discipline.** New channels (`to:ai:chat`, `to:ai:cancel`, `to:ai:tool-result`, `to:ai:config:get`, `to:ai:config:set`, `to:ai:key:set`, `to:ai:key:clear`, `to:ai:ollama:list`, `from:ai:chunk`, `from:ai:tool-call`, `from:ai:done`, `from:ai:error`, `from:ai:config`) are whitelisted in [preload.ts](../src/app/preload.ts). React components never touch `window.executionBridge` directly — they go through `AssistantManager` like every other feature.
- **API keys never enter the renderer.** `to:ai:key:set` is the only channel that carries a key, and only renderer → main. `to:ai:config:get` returns a sanitized config (each provider has a boolean `hasKey`, never the value). Web mode is exempt by necessity; the settings UI is explicit about this.
- **Single SDK instance per provider.** `AppAssistant` lazy-constructs each `@ai-sdk/*` model client on first call and caches it. Re-keying invalidates the cache.
- **Streaming back-pressure.** Chunks are sent with `webContents.send` as fast as the SDK yields. The renderer batches DOM appends inside `requestAnimationFrame`; chunk events themselves stay 1:1 with SDK deltas so cancellation precision survives.
- **Cancel semantics.** `to:ai:cancel { callId }` aborts the upstream stream via the SDK's `AbortController`. Mid-flight tool calls are abandoned on the renderer side; tool-result acks for cancelled calls are ignored by main.
- **Tool confirmation reuses `confirmExternal`.** Same dialog seam as `FileManager.closeTab`. The dialog body uses `<ConfirmToolCall>` which renders a diff preview for `edit_file` / `write_file`.
- **Bundle weight (renderer).** Desktop renderer doesn't pay for the SDK — it lives in `src/app/`. Web bundle picks up `ai` + the provider adapters when the user enables a provider; the assistant code path is itself lazy-loaded (`React.lazy`) the first time the sidebar opens. Markdown rendering reuses the existing `Markdown` manager — no second markdown-it instance.
- **i18n.** New `locale/<lng>/assistant.json` namespace covering provider names, UI strings, error messages, tool-call labels. English added in P3; mirrored to the other 12 locales in P8.
- **No localStorage outside `WebFileBridge` / `AssistantTransport`.** Web mode persistence goes through `AssistantTransport` (which owns the `mkeditor-assistant*` keys). The existing rule from the session-restore architecture audit (no scattered localStorage access) carries over.
- **Restore ordering.** `AppAssistant.loadConfig()` runs on `did-finish-load` _after_ `from:session:restore` but _before_ the splash fades — the right sidebar hydrates with conversations on first paint. A missing/corrupt config file falls back to "no providers enabled" without breaking boot.
- **Session-restore handshake.** Right-sidebar open state and the last active provider tab live in the existing session payload (we extend `SessionPayload` with an optional `assistant` block rather than creating a third persistence file for view state). Conversation content stays in `assistant.json`.
- **Tray + menu.** A `Help → AI Assistant` / `View → Toggle Assistant` menu entry is added in P8 through the existing `menuModel.ts`. No new IPC channel for the toggle — same `from:command:run` plumbing the title bar already uses.
- **Manager / React separation.** Same architectural rule as React migration, session restore, and title bar: nothing under `src/browser/core/` imports React; nothing under `src/browser/react/` imports `ipcRenderer` / `window.executionBridge` / writes localStorage directly.

## Phase Index

| #   | Phase                                                              | Status |
| --- | ------------------------------------------------------------------ | ------ |
| 1   | Main-process infrastructure (AppAssistant + keystore + IPC)        | 🟢 2026-05-18 |
| 2   | Right-sidebar shell (collapsible/resizable, empty tab strip)       | 🔵     |
| 3   | Provider settings UI (per-provider enable + key + model picker)    | 🔵     |
| 4   | Chat surface + streaming (send, stream, cancel, model switch)      | 🔵     |
| 5   | Agent tools (read/write/edit/list + confirm flow)                  | 🔵     |
| 6   | Context controls (@-mentions, active-file chip, selection sharing) | 🔵     |
| 7   | Persistence + web parity (assistant.json + localStorage mirror)    | 🔵     |
| 8   | Polish (i18n mirror, menu entries, docs, smoke)                    | 🔵     |

A phase is **complete** only when its exit criteria are met _and_ `npm test`, `npm run lint`, and a manual smoke (desktop + web for P7) pass. **Each phase ends with a focused commit (or small commit series) on a `feature/assistant-phase-N-<slug>` branch.**

---

## Phase 1 — Main-process infrastructure

**Goal:** build the provider-talking surface end-to-end on the main side. By the end of P1, a hardcoded test message sent from a throwaway renderer button streams tokens back via IPC. No assistant UI yet.

### Tasks

1. **Install deps**: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `ollama-ai-provider-v2`, `zod` (zod 4.x is required by the v2 Ollama adapter; the rest of the SDK accepts both 3.25.76+ and 4.1.8+). SDK only used in `src/app/` for now; webpack `externals` becomes relevant from P4 onward when renderer code starts referencing assistant types.
2. **`src/app/lib/AssistantKeyStore.ts`** — `safeStorage`-encrypted load/save of a `{ [providerId]: encryptedKey }` map at `~/.mkeditor/assistant.json` under a `keys` key. `getKey(provider) → string | null`, `setKey(provider, value)`, `clearKey(provider)`. Recovers gracefully from `safeStorage.isEncryptionAvailable() === false` (logs + disables remote providers).
3. **`src/app/lib/AssistantConfig.ts`** — non-secret config (enabled providers, default models, ollama base URL) in the same `assistant.json` under a `config` key. `load(): AssistantConfig`, `save(config)` — atomic write via tmp+rename (same pattern as `AppSession`).
4. **`src/app/lib/AppAssistant.ts`** — owns the Vercel AI SDK clients. Public surface (methods take an object that carries `callId` so the IPC payload can be passed through verbatim):
   - `chat(request: ChatRequest)` — starts a `streamText` for the given provider/model/messages/tools. Forwards text deltas as `from:ai:chunk { callId, text }`, tool-call deltas as `from:ai:tool-call { callId, ... }`, completion as `from:ai:done { callId, usage }`, errors as `from:ai:error { callId, code, message }`.
   - `cancel(req: CancelRequest | string)` — abort the in-flight `AbortController` for the given `callId`.
   - `submitToolResult(req: ToolResultRequest)` — feeds an external tool result back into the loop; the next `streamText` turn fires automatically when every pending tool for the prior turn has been answered.
   - `listOllamaModels(req: OllamaListRequest)` — `GET {baseUrl}/api/tags` → array of model names; replies via `from:ai:ollama:models`.
   - `buildSanitizedConfig()` — returns `{ config: SanitizedProviderConfig, encryptionAvailable: boolean }` for the `from:ai:config` push; folds in `hasKey: boolean` per provider via `AssistantKeyStore.hasKey`, never the key value.
5. **`src/app/lib/AppBridge.ts`** — register `ipcMain.on('to:ai:chat' | 'to:ai:cancel' | 'to:ai:tool-result' | 'to:ai:config:get' | 'to:ai:config:set' | 'to:ai:key:set' | 'to:ai:key:clear' | 'to:ai:ollama:list')`. `to:ai:config:get` and every config/key mutation respond via a `from:ai:config` push (sanitized — `hasKey: boolean`, never the key value). Expose a `pushAssistantConfig()` method `main.ts` calls from `did-finish-load` to hydrate the renderer with the initial config. The inbound channel for the Ollama model list response is `from:ai:ollama:models` (added so the round-trip doesn't overload `from:ai:config`).
6. **`src/app/preload.ts`** — whitelist all the new `to:ai:*` and `from:ai:*` channels.
7. **`tests/AppAssistant.test.ts`** — mocks the SDK (`vi.mock` style via jest module mock); covers: streaming chunks fan out by callId; cancel flips the abort signal; error paths emit `from:ai:error`; tool-call → tool-result loop drives a second streamText call.
8. **`tests/AssistantKeyStore.test.ts`** — encrypt/decrypt round-trip with a mock `safeStorage`; malformed file returns empty map without throwing; clear removes the entry.
9. **Run end-of-phase reviewers** in parallel (architecture-auditor, phase-reviewer, test-auditor — to be added once this plan ships).
10. **Report and request commit approval.**

### Out of scope

- Any renderer-side assistant UI (P2+).
- Conversation persistence (P7).
- Tool execution dispatch in the renderer (P5).
- Web mode adapter (P7).

### Exit criteria

- ✅ `~/.mkeditor/assistant.json` is created on first key set; keys are unreadable without `safeStorage.decryptString`.
- ✅ Sending a hardcoded `to:ai:chat` from a `console.log`-driven test stub streams text chunks back to the renderer and ends with `from:ai:done`.
- ✅ `to:ai:cancel` mid-stream stops the upstream call within ~50 ms.
- ✅ `to:ai:ollama:list` returns the local model list when Ollama is running, and a clear error otherwise.
- ✅ `npm test` green, `npm run lint` green, `npm run build-app` succeeds.

---

## Phase 2 — Right-sidebar shell

**Goal:** add the collapsible/resizable right sidebar to the layout, with an empty provider tab strip. No provider settings, no chat. The toggle button works, the panel resizes, the size persists.

### Tasks

1. **`src/browser/react/contexts/UIStateContext.tsx`** — add `rightSidebarOpen` + `setRightSidebarOpen`. Default `false`. Initial value read from session payload (extend `SessionPayload` with `assistant?: { sidebarOpen: boolean; size: number }`).
2. **Extend `SessionPayload`** in [src/app/lib/AppSession.ts](../src/app/lib/AppSession.ts) and [FileManager](../src/browser/core/FileManager.ts) `serializeSession` / `restoreSession` to round-trip the new `assistant` block. Bump `version` to `2`; v1 payloads load unchanged with `assistant: undefined`.
3. **`src/browser/react/components/AssistantSidebar.tsx`** — top-level component. Renders the provider tab strip (hardcoded to `['Anthropic', 'OpenAI', 'Ollama']` for now), with empty panels below. Uses the same theme tokens and visual weight as `<Sidebar>`.
4. **Modify `src/browser/react/App.tsx`** `Shell` — wrap `Workspace` and `AssistantSidebar` in an outer horizontal `Group`. New panel ordering:
   ```
   sidebar-pane | gutter | (workspace-pane: editor + preview) | gutter | assistant-pane
   ```
   `assistant-pane` is `collapsible`, `defaultSize="20%"`, `minSize="15%"`. Its `panelRef` follows the same effect pattern `sidebarPanelRef` uses.
5. **`src/browser/react/components/Navbar.tsx`** — add a right-side toggle button mirroring the left sidebar toggle (icon: chat / message). Reads + writes `rightSidebarOpen` via `useUIState`.
6. **Size persistence** — `Panel.onResize` on `assistant-pane` updates `UIStateContext`'s tracked size; the existing `scheduleSessionSave` already runs from `FileManager` events, so we add one more trigger from `UIStateContext` when the right-sidebar fields change (debounced 300 ms).
7. **Empty-state polish** — each tab body renders a centered "Connect your account in Settings" panel with a link that opens the Settings modal directly to the (future) assistant tab.
8. **`tests/react/AssistantSidebar.test.tsx`** — collapsed by default; toggle opens; resizing fires the session-save trigger; switching tabs preserves the empty-state placeholder.
9. **Reviewers + commit approval.**

### Out of scope

- Provider connection or settings (P3).
- Any chat UI (P4).
- Persistence of conversations (P7).
- Localisation (P8).

### Exit criteria

- ✅ Desktop + web: right sidebar collapsed on first launch. Toggle button in `<Navbar>` opens/closes; state persists across relaunch.
- ✅ Sidebar resizes; the chosen size is remembered.
- ✅ Tab strip renders with three tabs; switching tabs is instant and visually distinct.
- ✅ Layout doesn't regress on narrow viewports — `<Workspace>` still renders the editor/preview split.
- ✅ `npm test` green, `npm run lint` green, build green.

---

## Phase 3 — Provider settings UI

**Goal:** the user can enable each provider, paste an API key (or set Ollama base URL), pick a default model, and see "Connected" status. Settings round-trip to disk and survive relaunch.

### Tasks

1. **`src/browser/react/components/assistant/AssistantSettings.tsx`** — three accordions (Anthropic / OpenAI / Ollama). Each row: enable toggle · API key input (`<Input type="password">` with show/hide) · default model select · "Test connection" button. Ollama has a base URL field instead of an API key plus a "Refresh model list" button feeding off `to:ai:ollama:list`.
2. **Surface in `SettingsModal`** — add a new "Assistant" tab alongside the existing tabs. Mount `<AssistantSettings>` there. No new modal.
3. **`AssistantManager.subscribeConfig()`** — observable view of the sanitized config (`{ [providerId]: { enabled, hasKey, defaultModel } }`) backed by `from:ai:config`. Settings UI subscribes via `useAssistantConfig()` hook.
4. **Wire IPC**:
   - `to:ai:config:set { provider, enabled, defaultModel, baseUrl? }` — saves non-secret config.
   - `to:ai:key:set { provider, key }` — encrypted store via `AssistantKeyStore`.
   - `to:ai:key:clear { provider }` — wipes the encrypted entry.
   - Each write emits a `from:ai:config` refresh.
5. **Connection test** — `to:ai:chat` with a one-shot "ping" prompt and `maxTokens: 1`. Surface success/failure as a sonner toast plus a status pill on the provider row.
6. **Web warning** — when `mode === 'web'`, render a banner: "API keys are stored in your browser's localStorage and are visible to any script that runs on this page."
7. **Locale keys** — add minimal English strings to `locale/en/assistant.json` (settings labels, test connection messages); other locales fall back via `fallbackLng: 'en'`.
8. **`tests/react/AssistantSettings.test.tsx`** — enable round-trip, key write hits `to:ai:key:set`, sanitized config never carries the key value, Ollama model-list refresh fans out correctly.
9. **Reviewers + commit approval.**

### Out of scope

- Chat surface (P4).
- Per-conversation model override (P4).
- Translation to all 13 locales (P8).

### Exit criteria

- ✅ Enabling a provider with a valid key flips the matching tab body from "Connect your account" to a chat placeholder (still empty — P4 fills it).
- ✅ Settings round-trip survives relaunch. Keys remain encrypted on disk.
- ✅ "Test connection" reports a clear success or a clear, translatable error.
- ✅ Disabling a provider hides its sidebar tab without removing the persisted config.
- ✅ `npm test` green, `npm run lint` green, build green.

---

## Phase 4 — Chat surface + streaming

**Goal:** the user can hold a real conversation. Send a message, watch it stream, see markdown rendered, cancel mid-stream, switch the model for the next turn. No tools yet — pure text in and out.

### Tasks

1. **`AssistantManager.startCall(provider, conversationId, message)`** — generates a callId, appends the user message + a blank assistant message to the conversation, fires `to:ai:chat { callId, provider, model, messages }`, records the in-flight call.
2. **`AssistantManager.cancelCall(callId)`** — fires `to:ai:cancel`, marks the assistant message as `cancelled`.
3. **`BridgeListeners`** routes `from:ai:chunk` → `assistantManager.appendChunk(callId, text)`, `from:ai:done` → `finalizeCall(callId, usage)`, `from:ai:error` → `failCall(callId, message)`.
4. **`src/browser/react/components/assistant/ChatPane.tsx`** — message list (scrolled to bottom on append, auto-scroll suspends if the user scrolls up), input textarea (Enter sends, Shift+Enter newline), send/stop button (toggles based on in-flight state), per-message model picker that overrides `defaultModel` for the next send.
5. **`src/browser/react/components/assistant/ChatMessage.tsx`** — renders user/assistant bubbles. Assistant content is markdown — rendered through the existing `Markdown` instance (a thin `renderMarkdown(content)` helper added on `Markdown` returns sanitised HTML; React uses `dangerouslySetInnerHTML` on a div inside the bubble, mirroring `<PreviewPane>`).
6. **`src/browser/react/components/assistant/ConversationList.tsx`** — vertical list of conversations within a provider tab. Active row highlighted; new-chat button at the top. Rename via double-click; delete via context menu (uses `confirmExternal`).
7. **`src/browser/react/components/assistant/ProviderTab.tsx`** — composes `<ConversationList>` + `<ChatPane>`. Splits horizontally (smaller list left, chat right) using `react-resizable-panels`; widths stored in `UIStateContext`.
8. **Draft preservation** — each provider tab keeps its in-progress input in `AssistantManager.drafts[provider][conversationId]`; switching tabs or conversations preserves the text.
9. **`tests/react/ChatPane.test.tsx`** — send fires `to:ai:chat`, streamed chunks render incrementally, cancel button calls `to:ai:cancel` and disables itself, model override sends the chosen model, Shift+Enter inserts newline.
10. **`tests/AssistantManager.test.ts`** — chunk append concatenates into the same assistant message; cancel sets the right state; concurrent provider calls don't cross-pollinate.
11. **Reviewers + commit approval.**

### Out of scope

- Tool calls (P5).
- @-mention context (P6).
- Persistence (P7) — conversations live in memory only this phase.

### Exit criteria

- ✅ Typing a question, hitting Enter, watching the response stream in. Visible token-by-token output.
- ✅ Stop button halts the upstream call within ~50 ms.
- ✅ Markdown (lists, code blocks, headings, links) renders cleanly in assistant bubbles, with the same highlight.js + KaTeX support the preview pane has.
- ✅ Multiple provider tabs can hold parallel in-flight calls (start one in Anthropic, switch to OpenAI, start another, both stream independently).
- ✅ Switching tabs or conversations preserves the input draft.
- ✅ `npm test` green, `npm run lint` green, build green.

---

## Phase 5 — Agent tools

**Goal:** the agent can actually do things — read files, edit the active document, create new ones, list the workspace, work on selections. Write-class tools confirm by default.

### Tasks

1. **`src/browser/core/AssistantTools.ts`** — declares each tool with a Zod schema + description + `execute(args)` returning a JSON-serialisable result. Constructed with refs to `FileManager`, `FileTreeManager`, `EditorManager`, `BridgeManager`. Catalog:
   - `read_file({ path })` — opens the file via `BridgeManager` if not already in tabs; returns `{ path, content, lineCount }`.
   - `write_file({ path, content })` — confirms; writes via `to:file:save` (existing channel) after opening as the active tab.
   - `edit_file({ path, start, end, replacement })` — confirms with a diff preview; uses Monaco `executeEdits`.
   - `create_file({ path, content })` — confirms; uses `to:file:create`.
   - `list_files({ subpath? })` — pulls from `FileTreeManager.snapshot()`; flattens to a list capped at 500 entries.
   - `get_active_file()` — `FileManager.activePath` + the model's current text.
   - `get_selection()` — Monaco `getSelection()` + `getValueInRange`.
   - `replace_selection({ content })` — confirms; Monaco `executeEdits`.
   - `insert_at_cursor({ content })` — confirms; Monaco `executeEdits`.
   - `open_tab({ path })` — `BridgeManager.openPath(path)`.
2. **`AssistantManager.onToolCall(callId, tool)`** — receives `from:ai:tool-call`. For read-class: immediately executes via `AssistantTools.execute(...)` and replies with `to:ai:tool-result`. For write-class: enters `pending` state on the message; if the conversation's `autoAcceptWrites` is true, executes directly; otherwise pushes a confirmation request through `confirmExternal`.
3. **Tool-call payload to the SDK** — `AppAssistant.chat` ships the tool list to Vercel AI SDK's `tools` parameter, names + Zod schemas matching the renderer's catalog. The SDK's `experimental_continueSteps` (or v5 equivalent) loops automatically once tool results come back.
4. **`src/browser/react/components/assistant/ToolCallCard.tsx`** — collapsible row inside the assistant message stream. States: `pending-confirm` (confirm/reject buttons inline) · `executing` (spinner) · `succeeded` (collapsed by default; expandable to show args + result) · `failed` (red border + retry).
5. **`src/browser/react/components/assistant/ConfirmToolCall.tsx`** — `AlertDialog` for write-class tools. For `edit_file` / `write_file`, embeds a `<DiffView>` (Monaco's `diffEditor` reused with `readOnly: true` and `renderSideBySide: false`).
6. **Per-conversation auto-accept toggle** — gear icon in `<ChatPane>` header opens a popover with `autoAcceptWrites` switch + sharing toggles (P6 lands the sharing toggles).
7. **Error surfacing** — tool execution failures become a `tool` role message with the error text, fed back to the SDK so it can recover. The card shows the error inline.
8. **`tests/AssistantTools.test.ts`** — each tool dispatches to the right manager; write-class tools open a confirmation through a mock `confirmExternal`; auto-accept bypasses the confirm; failures surface cleanly.
9. **`tests/react/ToolCallCard.test.tsx`** — covers each visual state and the confirm/reject flow.
10. **Reviewers + commit approval.**

### Out of scope

- Multi-file batch edits (single-tool-call-per-step in v1; the SDK loops naturally).
- Cross-workspace tools (operate within the open workspace + open tabs only).
- Diff acceptance per-hunk (whole-edit accept or reject in v1).

### Exit criteria

- ✅ Asking "summarise the active file" works without confirmations and returns a paragraph referencing real content.
- ✅ Asking "add a paragraph to the introduction" prompts a confirmation showing the diff; accepting applies the edit; rejecting leaves the file untouched.
- ✅ Asking "create a new file called notes.md with a TODO list" prompts a confirmation; accepting creates the file and opens it as a new tab.
- ✅ Tool failures surface inline and the agent can recover (retry with corrected args).
- ✅ Per-conversation auto-accept toggle bypasses confirmations for the rest of that chat only.
- ✅ `npm test` green, `npm run lint` green, build green.

---

## Phase 6 — Context controls

**Goal:** the user controls what the agent sees. Active file is shared by default with a clear chip; `@` opens a picker for explicit cross-file context; current selection can be shared as a tagged snippet.

### Tasks

1. **`AssistantManager.contextFor(conversationId)`** — assembles the system context message at send time:
   - Active file (if "share active file" toggle on) — included as a `system` role with a tagged code block: ` ```md path="X.md" \n…\n``` `.
   - Current selection (if "share selection" toggle on and a selection exists) — included with line range.
   - Explicit `@`-mentioned files — each as its own tagged block.
2. **`<ContextChip>`** — row above the input listing currently included context: `[× X.md (active)] [× workspace/notes.md] [× selection L42-L67]`. Clicking × drops that item for the next send only.
3. **`<MentionPicker>`** — opens on `@` keystroke. Built from `FileTreeManager.snapshot()` flattened + fuzzy-filtered. Arrow keys + Enter to select; the chosen path becomes a chip in `<ContextChip>` and the `@` token is removed from the input.
4. **Context size indicator** — small text below the input: `~1,200 tokens` (estimated via `text.length / 4` — good enough; no tiktoken dependency in v1). Turns amber above the provider's published context window.
5. **Default toggles** — share-active-file: on; share-selection: off (selection sharing is fiddly and easy to over-share). Both are per-conversation and persist.
6. **`tests/AssistantManager.context.test.ts`** — context assembly with various toggle combinations; @-mention dedupes against the active file; size indicator updates as input grows.
7. **Reviewers + commit approval.**

### Out of scope

- Folder-level `@`-mention (file granularity only in v1).
- Auto-context from grep hits or "related files" inference.
- Token counting via tiktoken (estimated only in v1).

### Exit criteria

- ✅ Opening a chat with a file in the active tab shows the file chip with the option to remove it.
- ✅ Typing `@` shows a fuzzy file picker; selecting a file adds a chip.
- ✅ Selecting code in the editor and toggling "share selection" attaches the snippet to the next message.
- ✅ Removing a chip excludes that context from the next send but not subsequent sends (chips re-attach automatically unless the toggle is off).
- ✅ `npm test` green, `npm run lint` green, build green.

---

## Phase 7 — Persistence + web parity

**Goal:** conversations survive relaunch. Web mode reaches feature parity with desktop (minus what's physically impossible — Ollama is constrained, keys are plaintext localStorage).

### Tasks

1. **`AssistantManager.serialize() → AssistantPayload`** — captures conversations, drafts, active provider/conversation. Excludes in-flight calls (cancelled on quit).
2. **`AssistantManager.restore(payload)`** — replays into in-memory state. Idempotent.
3. **Desktop persistence** — `AppAssistant` writes/reads the `conversations` + `config` blocks of `~/.mkeditor/assistant.json` (atomic tmp+rename, same as `AppSession`). Save cadence: debounced 500 ms after `addMessage` / `addConversation` / `renameConversation` / `deleteConversation`. Quit flush via the existing `before-quit` machinery (extend the existing flush-request fanout to include AssistantManager).
4. **`src/browser/core/AssistantTransport.ts`** — adapter with two implementations:
   - `DesktopTransport` — routes everything through IPC (existing P1 channels).
   - `WebTransport` — instantiates the Vercel AI SDK clients directly in the renderer; persists keys to `mkeditor-assistant-keys` localStorage; persists conversations to `mkeditor-assistant`.
     `AssistantManager` is constructed with one or the other based on `mode`.
5. **Web mode key handling** — `AssistantSettings` shows the warning banner permanently on web; key field reads/writes localStorage directly through `WebTransport`.
6. **Web mode Ollama notice** — if user enables Ollama, settings shows: "Make sure Ollama runs with `OLLAMA_ORIGINS=*` (or your origin). If the test connection fails, set the env var and restart Ollama."
7. **Migration** — existing v1 `SessionPayload` files load with no `assistant` block; no migration needed for the assistant payload itself (first run with this feature writes a fresh `assistant.json`).
8. **`tests/AssistantManager.persistence.test.ts`** — round-trip serialise/restore; deleting a conversation persists; rename persists.
9. **`tests/WebTransport.test.ts`** — localStorage round-trip; missing keys mean disabled providers; direct SDK call wires `streamText` correctly.
10. **Reviewers + commit approval.**

### Out of scope

- Multi-device sync (single machine only).
- Encrypted export / import (out of v1; a later "export conversation" feature would need a wrapper format).
- Conversation search.

### Exit criteria

- ✅ Closing and relaunching the desktop app reopens the same provider tab and the same active conversation at the same scroll position.
- ✅ The same is true on web after a browser refresh, _provided_ the user has previously connected an account in this browser.
- ✅ Cancelled in-flight calls don't persist as broken messages.
- ✅ Quit during a streaming response either drops the partial assistant message or persists it as cancelled (deterministic, not crashing).
- ✅ `npm test` green, `npm run lint` green, desktop + web build green.

---

## Phase 8 — Polish, i18n, menu integration, docs

**Goal:** ship-quality polish. Every locale has assistant strings, the menu can open the sidebar, the architecture doc covers the new surface, smoke tests cover the headline flows.

### Tasks

1. **i18n mirror** — translate `locale/en/assistant.json` into the other 12 locales (de, es, fr, it, ja, ko, nl, pt, ru, tr, uk, zh). Strings cover provider names, settings UI, chat UI, tool-call cards, error messages, confirmation dialogs.
2. **Menu entries** — extend [src/app/lib/menuModel.ts](../src/app/lib/menuModel.ts) with `View → Toggle Assistant Sidebar` (accelerator: `CmdOrCtrl+Shift+A`) and `Help → Configure AI Providers...` (opens Settings → Assistant tab). Both go through the existing `command` action kind.
3. **Tray menu** — add "Toggle Assistant" entry to the tray's `Show Window` group on desktop.
4. **Keyboard shortcuts within the chat** — `Esc` cancels in-flight call · `Cmd/Ctrl+K` opens a new conversation · `Cmd/Ctrl+/` focuses the input from anywhere.
5. **Empty-state copy** — final, friendly copy for "no providers connected", "no conversations yet", "agent is thinking".
6. **Tool-card refinements** — diff preview uses the editor's current theme tokens; long results truncate with "Show more".
7. **Visible streaming indicator** — small pulsing dot in the provider tab while a call is in flight (useful when the tab isn't the active one).
8. **Error taxonomy** — map the SDK's common errors to user-friendly translatable messages: missing key, invalid key, rate limited, context window exceeded, network failure, Ollama unreachable.
9. **Smoke tests** — manual checklist covering: enable + connect each provider; chat with each; cancel mid-stream; ask the agent to edit the active file; confirm + apply; reject; ask the agent to create a new file; relaunch and verify history; do the same on web.
10. **Documentation** —
    - **[ARCHITECTURE.md](ARCHITECTURE.md)** — new §4.14 "AI Assistant" covering IPC channels, key storage, conversation persistence, tool dispatch, mode parity.
    - **[CLAUDE.md](../CLAUDE.md)** — add the AI Assistant managers + IPC channels to the relevant sections (Core Subsystems renderer, IPC Bridge Model).
    - **[ROADMAP.md](ROADMAP.md)** — move the milestone row into **Recently Landed** with the date.
11. **Reviewers + commit approval.**

### Exit criteria

- ✅ Every supported locale has a complete `assistant.json`.
- ✅ Menu items appear under View and Help and behave correctly.
- ✅ The Cmd/Ctrl+Shift+A toggle opens/closes the sidebar from anywhere.
- ✅ All error states render a translated, actionable message.
- ✅ `ARCHITECTURE.md`, `CLAUDE.md`, and `ROADMAP.md` reflect the shipped surface.
- ✅ `npm test`, `npm run lint`, `npm run build-editor`, `npm run build-app` all green.
- ✅ Smoke checklist passes on Windows desktop + Chromium web build.

---

## Future Considerations

- **Cost / token telemetry surface.** SDK already reports `usage`; expose per-conversation and per-day rollups in a small panel under the chat.
- **System prompts per provider tab.** Let the user save a default system message per conversation or per provider.
- **MCP-style tool extensibility.** Vercel AI SDK supports tool middleware; expose a `~/.mkeditor/assistant-tools/` drop-in folder so power users can add custom tools.
- **Prompt caching (Anthropic).** When the SDK's caching primitives stabilise across providers, opt into long-context conversation caching for the system block.
- **Inline assist.** Highlight a line, press a shortcut, get a single-turn suggestion that streams into the editor as a phantom edit. Out of v1 because it needs its own dedicated UX.
- **Multi-tool/parallel calls.** v1 lets the SDK loop tool calls sequentially; parallel-tool-call support depends on provider parity.
- **Workspace search tool.** A `search_workspace(query)` tool fed by a ripgrep child process (desktop) or a JS scan (web). Useful for "find all references to X in the docs".
- **Slash commands in the input.** `/summarise`, `/translate`, `/refactor` as templated prompts.
- **Conversation export.** Markdown / JSON export of a conversation (including tool calls) for sharing.

---

## How to Update This Doc

- When a phase ships, flip its row to 🟢 with today's date.
- If implementation reveals a planning gap, **stop, update this doc first, then resume**.
- New decisions go in the Decisions table — don't bury them in phase bodies.
- Don't add new phases retroactively; if scope grows, file a follow-up in ROADMAP and link back.
