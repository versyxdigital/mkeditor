import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type {
  ApiProviderId,
  AssistantChatSnapshot,
  CancelRequest,
  ChatConversation,
  ChatErrorEvent,
  ChatMessage,
  ChatRequest,
  ChatToolCallEvent,
  ConfigPushPayload,
  ConfigSetRequest,
  InflightChatCall,
  OllamaListRequest,
  OllamaModelsEvent,
  ProviderId,
  SanitizedProviderConfig,
  PersistedChatMessage,
  PersistedConversations,
  ToolInvocation,
  ToolResultRequest,
  UiChatMessage,
  UiMessageSegment,
} from '../../app/interfaces/Assistant';
import type { ToolExecutor } from './AssistantTools';
import { confirmToolCallExternal } from '../react/contexts/ToolConfirmContext';

/**
 * P6 — surface AssistantManager uses to gather context at send time
 * (active file content, selection, mention file content). Implemented
 * by `AssistantContextSource` in `BridgeManager` and injected via
 * `setContextProvider`. Kept narrow so the manager doesn't grow a
 * direct dependency on FileManager / EditorManager / `window.mked`.
 */
export interface AssistantContextProvider {
  /** Active file path + content snapshot, or null when no real file is active. */
  getActiveFile(): { path: string; content: string } | null;
  /** Current editor selection + line range, or null when empty / no model. */
  getSelection(): {
    path: string | null;
    text: string;
    startLine: number;
    endLine: number;
  } | null;
  /**
   * Read a file by absolute path. Open Monaco models win over disk
   * so unsaved edits are captured. Throws when the file can't be read.
   */
  readFile(path: string): Promise<{ content: string }>;
}

/**
 * P6 — synchronous chip descriptor surfaced through the chat snapshot
 * so the chip row + the token indicator can render without awaiting
 * disk reads. Mention chips carry an optional cached `byteCount` so
 * the indicator can include them in its estimate even though the
 * content itself isn't loaded into the snapshot.
 */
export interface AssistantContextChip {
  kind: 'active' | 'selection' | 'mention';
  /** Absolute path for active/mention; null for selection in untitled buffers. */
  path: string | null;
  /** Human-readable label rendered in the chip ("README.md", "selection L42–L67"). */
  label: string;
  /**
   * Optional content-size estimate (in characters) — present for
   * sources we can size cheaply (active file content length,
   * selection text length, cached mention byte count).
   */
  byteCount?: number;
}

/**
 * Stable snapshot the React side reads through `useSyncExternalStore`.
 *
 * `config` is null until the first `from:ai:config` push lands; consumers
 * (the settings UI in P3, the sidebar tab filter, the future chat
 * surface in P4) should treat null as "loading" rather than rendering
 * provider-specific affordances.
 *
 * `encryptionAvailable` mirrors main's `safeStorage.isEncryptionAvailable()`
 * (see `AssistantKeyStore.isEncryptionAvailable`). When false the
 * remote providers are effectively disabled — settings UI surfaces a
 * warning and the test-connection / key-set buttons short-circuit.
 */
export interface AssistantConfigSnapshot {
  config: SanitizedProviderConfig | null;
  encryptionAvailable: boolean;
}

/**
 * Resolution shape of `testConnection()`. `ok: true` means the upstream
 * provider replied; `ok: false` means the SDK or the network failed —
 * `code` is the renderer-translatable error code from `from:ai:error`,
 * `message` is the free-text detail for logs.
 */
export interface ConnectionTestResult {
  ok: boolean;
  code?: ChatErrorEvent['code'];
  message?: string;
}

const PROVIDER_IDS: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'ollama',
] as const;

/** Fallback model used when the user starts a conversation before config has hydrated. */
const FALLBACK_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5',
  ollama: 'llama3.2',
};

const EMPTY_CHAT_SNAPSHOT: AssistantChatSnapshot = {
  conversations: { anthropic: [], openai: [], ollama: [] },
  activeConversation: { anthropic: null, openai: null, ollama: null },
  activeProvider: null,
  drafts: {},
  inflight: {},
};

/**
 * Renderer-side AI Assistant manager.
 *
 * P3 surface: sanitized config snapshot, mutators for the three
 * `to:ai:*` config/key channels, Ollama model-list refresh, and a
 * one-shot connection test that piggy-backs `to:ai:chat` with
 * `maxOutputTokens: 1`.
 *
 * P4 surface (this file): chat state — conversations grouped by
 * provider, drafts, in-flight chat calls. `startCall` initiates a
 * streaming turn; chunks land via `appendChunk`; completion routes
 * through `finalizeCall` / `failCall`. Cancel via `cancelCall`. Tests
 * and chat share the same `from:ai:done` / `from:ai:error` channels —
 * the manager distinguishes by inspecting its own bookkeeping (tests
 * first, then in-flight chats).
 *
 * Two separate observable surfaces:
 *   - `subscribeConfig` / `getConfigSnapshot` (the P3 settings UI)
 *   - `subscribeChat` / `getChatSnapshot`   (the P4 chat UI)
 * Splitting them means config-only consumers don't re-render on chat
 * churn (chunks arrive multiple times per second during streaming).
 *
 * Architectural responsibilities (CLAUDE.md): owns data + IPC; never
 * imports React. The composition root injects the bridge ref through
 * the constructor.
 */
/**
 * Construction-time tunables. Production passes nothing — defaults
 * give the smoothed-streaming behaviour the UI expects. Tests opt out
 * of paced reveal so synchronous `appendChunk → expect(content)`
 * assertions still hold without driving a fake clock.
 */
export interface AssistantManagerOptions {
  disablePacedReveal?: boolean;
  requestFrame?: (cb: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}

export class AssistantManager {
  private snapshot: AssistantConfigSnapshot = {
    config: null,
    encryptionAvailable: false,
  };
  private listeners = new Set<() => void>();

  /**
   * Pending one-shot responses keyed by callId. Each entry resolves
   * exactly once when the matching `from:ai:done` / `from:ai:error` /
   * `from:ai:ollama:models` event lands, after which the entry is
   * dropped. A safety timeout cleans the entry up if the upstream
   * never responds.
   */
  private pendingTests = new Map<string, PendingTest>();
  private pendingOllama = new Map<string, PendingOllama>();

  /** Test connections shouldn't hang forever — bound the wait. */
  private static readonly TEST_TIMEOUT_MS = 15_000;
  /** Ollama is local; if it doesn't respond in 6s something is wrong. */
  private static readonly OLLAMA_TIMEOUT_MS = 6_000;

  // ---- P4 chat state ------------------------------------------------

  private chatSnapshot: AssistantChatSnapshot = EMPTY_CHAT_SNAPSHOT;
  private chatListeners = new Set<() => void>();
  /** Per-provider map of convId → conversation. Mutated in place; the snapshot rebuilds from this. */
  private conversations: Record<ProviderId, Map<string, ChatConversation>> = {
    anthropic: new Map(),
    openai: new Map(),
    ollama: new Map(),
  };
  private activeConv: Record<ProviderId, string | null> = {
    anthropic: null,
    openai: null,
    ollama: null,
  };
  /**
   * Last provider tab the user selected. Persisted (P7) so reopening
   * the app lands on the same tab. Mutated by `setActiveProvider`
   * (called by the sidebar's tab strip) and `restore()`.
   */
  private activeProviderTab: ProviderId | null = null;
  /** Key shape: `${provider}:${conversationId}`. */
  private drafts = new Map<string, string>();
  private inflightChats = new Map<string, InflightChatCall>();

  /**
   * Optional tool executor (P5). Null until `setToolExecutor` is
   * called by `BridgeManager` after construction. When null,
   * `startCall` ships an empty `tools` array (the model behaves as if
   * no tools exist).
   */
  private toolExecutor: ToolExecutor | null = null;

  /**
   * P6 context provider — gives the manager access to the active file,
   * current selection, and arbitrary file content for `@`-mentions.
   * Injected by `BridgeManager` after construction (same pattern as
   * `setToolExecutor`). Null until set; when null, `contextFor`
   * returns null and chip/indicator surfaces collapse.
   */
  private contextProvider: AssistantContextProvider | null = null;

  /**
   * P7 — debounced save trigger. `rebuildChatSnapshot` schedules a
   * persist on every state change; the trailing-edge debounce means a
   * burst of mutations (e.g. quick chunk arrivals) collapses into a
   * single `to:ai:conversations:save` write. `flushPersist` cancels
   * the pending timer and fires the save synchronously — used by the
   * `from:ai:conversations:flush-request` handler before quit.
   */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PERSIST_DEBOUNCE_MS = 500;

  /**
   * Disabled during `restore()` so the replay itself doesn't trigger
   * a write. The main side already has the data on disk.
   */
  private persistEnabled = true;

  /**
   * Cached content snapshots for `@`-mentioned files. Keyed by
   * absolute path. Populated when a mention is added; consulted by
   * both the chip row (for byte-count display) and `contextFor()`
   * (for system-message assembly). Refreshed when a mention is
   * re-added; dropped when no conversation references the path.
   */
  private mentionContents = new Map<string, string>();

  // ---- P8 polish — smoothed streaming reveal --------------------------
  //
  // Upstream `from:ai:chunk` events arrive in lumps that match
  // whatever boundary the SDK happens to emit on — sometimes a few
  // characters, sometimes a full sentence. Painting each lump at
  // arrival makes the bubble visibly "block in". To mimic the
  // typing-like cadence that Claude Code uses, we buffer incoming
  // deltas per call and drain them across `requestAnimationFrame`
  // ticks, revealing `ceil(buffer.length / REVEAL_DRAIN_FRAMES)`
  // characters per frame. Bursts get smoothed; small chunks reveal
  // cleanly without piling up.
  //
  // Tests pass `disablePacedReveal: true` so 30+ synchronous
  // assertions like `appendChunk(); expect(content).toBe('…')` keep
  // working — the production path is the only one that paces.
  private pendingChunkBuffers = new Map<string, string>();
  private revealFrameHandle: number | null = null;
  /** Roughly 120 ms at 60 fps — slow enough to be visibly smooth, fast enough not to lag the model. */
  private static readonly REVEAL_DRAIN_FRAMES = 7;
  private readonly pacedRevealEnabled: boolean;
  private readonly requestFrame: (cb: FrameRequestCallback) => number;
  private readonly cancelFrame: (id: number) => void;

  constructor(
    private bridge: ContextBridgeAPI,
    opts: AssistantManagerOptions = {},
  ) {
    this.pacedRevealEnabled = opts.disablePacedReveal !== true;
    // Default to the browser's rAF; opts.requestFrame is the fake-
    // clock injection point for tests that need to drive the paced
    // reveal deterministically.
    this.requestFrame =
      opts.requestFrame ??
      (typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : ((cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number));
    this.cancelFrame =
      opts.cancelFrame ??
      (typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : ((id: number) => clearTimeout(id as unknown as NodeJS.Timeout)));
  }

  // ---------------------------------------------------------------------
  // Config-snapshot surface (P3)
  // ---------------------------------------------------------------------

  /** Subscribe to config-snapshot changes. Returns an unsubscribe. */
  public subscribeConfig(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stable snapshot reference; updated on every `setConfigFromServer`. */
  public getConfigSnapshot(): AssistantConfigSnapshot {
    return this.snapshot;
  }

  /**
   * Apply a `from:ai:config` push. Called by `BridgeListeners` after
   * any config / key mutation on the main side (and once on boot).
   */
  public setConfigFromServer(payload: ConfigPushPayload): void {
    this.snapshot = {
      config: payload.config,
      encryptionAvailable: payload.encryptionAvailable,
    };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Outbound mutators (renderer → main IPC)
  // ---------------------------------------------------------------------

  /** Request an immediate `from:ai:config` push (called at bridge boot). */
  public requestConfigRefresh(): void {
    this.bridge.send('to:ai:config:get', null);
  }

  /** Persist non-secret per-provider config. */
  public setProviderConfig(request: ConfigSetRequest): void {
    this.bridge.send('to:ai:config:set', request);
  }

  /**
   * Encrypt + persist an API key for an API-key-bearing provider. The
   * plaintext key crosses the bridge once and is never echoed back
   * (`from:ai:config` carries `hasKey: boolean` only).
   */
  public setKey(provider: ApiProviderId, key: string): void {
    this.bridge.send('to:ai:key:set', { provider, key });
  }

  /** Remove the encrypted key for a provider. */
  public clearKey(provider: ApiProviderId): void {
    this.bridge.send('to:ai:key:clear', { provider });
  }

  // ---------------------------------------------------------------------
  // One-shot Ollama model list (resolved by from:ai:ollama:models)
  // ---------------------------------------------------------------------

  public refreshOllamaModels(baseUrl: string): Promise<string[]> {
    const callId = AssistantManager.mintCallId('ollama');
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOllama.delete(callId);
        reject(
          new Error(
            `Ollama model list timed out after ${AssistantManager.OLLAMA_TIMEOUT_MS}ms`,
          ),
        );
      }, AssistantManager.OLLAMA_TIMEOUT_MS);
      this.pendingOllama.set(callId, { resolve, reject, timer });
      const req: OllamaListRequest = { callId, baseUrl };
      this.bridge.send('to:ai:ollama:list', req);
    });
  }

  public onOllamaModels(payload: OllamaModelsEvent): void {
    const pending = this.pendingOllama.get(payload.callId);
    if (!pending) return;
    this.pendingOllama.delete(payload.callId);
    clearTimeout(pending.timer);
    if (payload.error) {
      pending.reject(new Error(payload.error));
      return;
    }
    pending.resolve(payload.models ?? []);
  }

  // ---------------------------------------------------------------------
  // One-shot connection test (piggy-backs to:ai:chat)
  // ---------------------------------------------------------------------

  public testConnection(
    provider: ProviderId,
    model: string,
  ): Promise<ConnectionTestResult> {
    const callId = AssistantManager.mintCallId('test');
    return new Promise<ConnectionTestResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTests.delete(callId);
        this.cancelChat(callId);
        resolve({
          ok: false,
          code: 'network_error',
          message: `Connection test timed out after ${AssistantManager.TEST_TIMEOUT_MS}ms`,
        });
      }, AssistantManager.TEST_TIMEOUT_MS);
      this.pendingTests.set(callId, { resolve, timer });
      const req: ChatRequest = {
        callId,
        provider,
        model,
        messages: [{ role: 'user', content: 'ping' }],
        maxOutputTokens: 1,
      };
      this.bridge.send('to:ai:chat', req);
    });
  }

  /**
   * Whether the given callId is one of this manager's pending requests.
   * P3 BridgeListeners used this to partition done/error events; P4
   * drops the partition (everything goes through this manager) but the
   * method stays exposed as a small introspection surface used by tests.
   */
  public ownsCallId(callId: string): boolean {
    return (
      this.pendingTests.has(callId) ||
      this.pendingOllama.has(callId) ||
      this.inflightChats.has(callId)
    );
  }

  /** Send a cancel for any in-flight call (test or chat). */
  public cancelChat(callId: string): void {
    const req: CancelRequest = { callId };
    this.bridge.send('to:ai:cancel', req);
  }

  // ---------------------------------------------------------------------
  // P4 — Chat snapshot surface
  // ---------------------------------------------------------------------

  /** Subscribe to chat-state changes (conversations, drafts, inflight). */
  public subscribeChat(listener: () => void): () => void {
    this.chatListeners.add(listener);
    return () => {
      this.chatListeners.delete(listener);
    };
  }

  /** Stable snapshot reference; rebuilt on every chat-state mutation. */
  public getChatSnapshot(): AssistantChatSnapshot {
    return this.chatSnapshot;
  }

  /**
   * Read a draft input value for a (provider, conversation) pair.
   * Returns empty string when none — ChatPane uses this to initialise
   * its local input state on mount.
   */
  public getDraft(provider: ProviderId, conversationId: string): string {
    return this.drafts.get(this.draftKey(provider, conversationId)) ?? '';
  }

  /**
   * Persist an in-progress input draft. ChatPane calls this on
   * blur / unmount / before send — not on every keystroke — to keep
   * per-keystroke snapshot churn out of the chat re-render path.
   */
  public setDraft(
    provider: ProviderId,
    conversationId: string,
    text: string,
  ): void {
    const key = this.draftKey(provider, conversationId);
    if (text.length === 0) {
      if (!this.drafts.has(key)) return;
      this.drafts.delete(key);
    } else {
      if (this.drafts.get(key) === text) return;
      this.drafts.set(key, text);
    }
    this.rebuildChatSnapshot();
  }

  // ---- Conversation CRUD --------------------------------------------

  /**
   * Create a fresh conversation under the given provider tab. Returns
   * the new conversation id. The new conversation becomes the active
   * one for that provider.
   *
   * The initial model is taken from the sanitized config when
   * available; otherwise falls back to a per-provider sane default
   * (the user can edit it inline via the chat header).
   */
  public createConversation(provider: ProviderId, title?: string): string {
    const id = AssistantManager.mintCallId('conv');
    const now = Date.now();
    const conv: ChatConversation = {
      id,
      providerId: provider,
      title: title ?? 'New chat',
      model: this.defaultModelFor(provider),
      messages: [],
      autoAcceptWrites: false,
      // P6 defaults: active file ON, selection OFF (selection
      // sharing is fiddly and easy to over-share). Mentions start
      // empty; user picks via the `<MentionPicker>`.
      shareActiveFile: true,
      shareSelection: false,
      mentions: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations[provider].set(id, conv);
    this.activeConv[provider] = id;
    this.rebuildChatSnapshot();
    return id;
  }

  /**
   * Remove a conversation. Cancels any in-flight chat against it,
   * drops its draft, and falls back the active conversation pointer
   * to the next most-recent (or null when none remain).
   */
  public deleteConversation(provider: ProviderId, conversationId: string): void {
    const map = this.conversations[provider];
    if (!map.has(conversationId)) return;
    // Cancel any in-flight chat against this conversation.
    for (const [callId, inflight] of this.inflightChats) {
      if (
        inflight.provider === provider &&
        inflight.conversationId === conversationId
      ) {
        this.cancelChat(callId);
        this.inflightChats.delete(callId);
      }
    }
    map.delete(conversationId);
    this.drafts.delete(this.draftKey(provider, conversationId));
    if (this.activeConv[provider] === conversationId) {
      const next = this.firstByRecency(provider);
      this.activeConv[provider] = next ? next.id : null;
    }
    this.rebuildChatSnapshot();
  }

  public renameConversation(
    provider: ProviderId,
    conversationId: string,
    title: string,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === conv.title) return;
    conv.title = trimmed;
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  /** Set the model used for the next send in this conversation. */
  public setConversationModel(
    provider: ProviderId,
    conversationId: string,
    model: string,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv) return;
    const trimmed = model.trim();
    if (!trimmed || trimmed === conv.model) return;
    conv.model = trimmed;
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  public setActiveConversation(
    provider: ProviderId,
    conversationId: string | null,
  ): void {
    if (this.activeConv[provider] === conversationId) return;
    this.activeConv[provider] = conversationId;
    this.rebuildChatSnapshot();
  }

  /**
   * Set the currently-selected provider tab (P7 persistence). Called
   * by `<AssistantSidebar>`'s tab strip on user click. Persisted so
   * reopening the app lands on the same tab the user left on.
   */
  public setActiveProvider(provider: ProviderId | null): void {
    if (this.activeProviderTab === provider) return;
    this.activeProviderTab = provider;
    this.rebuildChatSnapshot();
  }

  public getActiveProvider(): ProviderId | null {
    return this.activeProviderTab;
  }

  // ---- Chat send + lifecycle ----------------------------------------

  /**
   * Send a user message and start an assistant turn. Appends both
   * messages to the conversation, clears the draft, records the
   * in-flight call, and ships `to:ai:chat`. Returns the callId so
   * the caller (ChatPane) can wire a cancel button to it.
   */
  public startCall(
    provider: ProviderId,
    conversationId: string,
    userText: string,
    /**
     * Optional pre-assembled system context message (P6). Caller is
     * expected to `await manager.contextFor(...)` first and pass the
     * result here; we keep `startCall` synchronous so the IPC ship,
     * snapshot rebuild, and inflight bookkeeping all happen in one
     * tick — concurrent send/cancel logic in tests + the chat UI
     * relied on that timing. Pass `null` (or omit) to send without
     * any leading system turn.
     */
    systemContext?: ChatMessage | null,
  ): string | null {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv) return null;
    const trimmed = userText.trim();
    if (!trimmed) return null;

    const callId = AssistantManager.mintCallId('chat');
    const userMsg: UiChatMessage = {
      id: AssistantManager.mintCallId('msg'),
      role: 'user',
      content: trimmed,
      status: 'complete',
      createdAt: Date.now(),
    };
    const assistantMsg: UiChatMessage = {
      id: AssistantManager.mintCallId('msg'),
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
    };
    conv.messages.push(userMsg, assistantMsg);
    conv.updatedAt = Date.now();
    // If this is the first user message, derive a short title from it.
    if (conv.title === 'New chat') {
      conv.title = trimmed.slice(0, 40);
    }
    this.drafts.delete(this.draftKey(provider, conversationId));

    this.inflightChats.set(callId, {
      callId,
      provider,
      conversationId,
      assistantMessageId: assistantMsg.id,
      startedAt: Date.now(),
    });

    // Build the wire message list — pull every completed user/
    // assistant message in the conversation, skip the streaming
    // placeholder we just inserted, drop cancelled/failed messages
    // (they confuse the model — `cancelled` carries no content,
    // `failed` is similarly noisy).
    const history: ChatMessage[] = conv.messages
      .filter(
        (m) => m.id !== assistantMsg.id && m.status === 'complete' && m.content,
      )
      .map((m) => ({ role: m.role, content: m.content }));

    const wireMessages: ChatMessage[] = systemContext
      ? [systemContext, ...history]
      : history;

    const req: ChatRequest = {
      callId,
      provider,
      model: conv.model,
      messages: wireMessages,
      tools: this.toolExecutor?.describe() ?? undefined,
    };
    this.bridge.send('to:ai:chat', req);
    this.rebuildChatSnapshot();
    return callId;
  }

  /**
   * Abort an in-flight chat call. Marks the corresponding assistant
   * placeholder as cancelled (whatever content it had streamed in
   * stays visible — the user can still see what came through). Returns
   * true if a chat was actually cancelled.
   */
  public cancelCall(callId: string): boolean {
    const inflight = this.inflightChats.get(callId);
    if (!inflight) return false;
    // Drain any buffered (un-revealed) text first so the cancelled
    // bubble shows everything that actually arrived from upstream —
    // the user already paid for those tokens.
    this.drainPendingForCall(callId);
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (conv) {
      this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) =>
        msg.status === 'streaming' ? { ...msg, status: 'cancelled' } : msg,
      );
    }
    this.inflightChats.delete(callId);
    this.cancelChat(callId);
    this.rebuildChatSnapshot();
    return true;
  }

  /**
   * Append a text chunk to the assistant message of an in-flight chat.
   *
   * Replaces (not mutates) the message object at its index in the
   * conversation's `messages` array. The new reference is what
   * `<AssistantBody>`'s React.memo wrapper detects — mutating
   * `msg.content += text` in place would leave the prop ref unchanged
   * and the bubble would never re-render mid-stream.
   */
  public appendChunk(callId: string, text: string): void {
    const inflight = this.inflightChats.get(callId);
    if (!inflight) return; // not a chat call (likely a test ping); silently drop
    if (!text) return;
    if (!this.pacedRevealEnabled) {
      this.flushChunkText(inflight, text);
      return;
    }
    const existing = this.pendingChunkBuffers.get(callId) ?? '';
    this.pendingChunkBuffers.set(callId, existing + text);
    if (this.revealFrameHandle === null) {
      this.revealFrameHandle = this.requestFrame(this.revealTick);
    }
  }

  /**
   * rAF tick — drains a fraction of every active call's pending
   * buffer onto its assistant message, then re-arms itself if any
   * buffer is still non-empty. One snapshot rebuild per tick covers
   * however many concurrent streams are running.
   */
  private revealTick = (): void => {
    this.revealFrameHandle = null;
    let anyRemaining = false;
    let anyEmitted = false;
    for (const [callId, buffer] of this.pendingChunkBuffers) {
      if (!buffer) continue;
      const inflight = this.inflightChats.get(callId);
      if (!inflight) {
        // Call vanished mid-stream (cancel / done already cleared
        // it). Drop the buffer; nothing to flush onto.
        this.pendingChunkBuffers.delete(callId);
        continue;
      }
      const reveal = Math.max(
        1,
        Math.ceil(buffer.length / AssistantManager.REVEAL_DRAIN_FRAMES),
      );
      const chunk = buffer.slice(0, reveal);
      const remaining = buffer.slice(reveal);
      this.pendingChunkBuffers.set(callId, remaining);
      this.flushChunkText(inflight, chunk, /* skipRebuild */ true);
      anyEmitted = true;
      if (remaining.length > 0) anyRemaining = true;
    }
    if (anyEmitted) this.rebuildChatSnapshot();
    if (anyRemaining) {
      this.revealFrameHandle = this.requestFrame(this.revealTick);
    }
  };

  /**
   * Force any buffered text for `callId` onto the assistant message
   * immediately. Used by `cancelCall` and `onChatDone` so the
   * persisted / final-visible content matches everything received
   * upstream — paced reveal must never silently drop the tail.
   */
  private drainPendingForCall(callId: string): void {
    const buffer = this.pendingChunkBuffers.get(callId);
    if (!buffer) return;
    this.pendingChunkBuffers.delete(callId);
    const inflight = this.inflightChats.get(callId);
    if (inflight) {
      this.flushChunkText(inflight, buffer);
    }
    // If no buffers remain, cancel the pending frame so we don't
    // spin idly.
    if (this.pendingChunkBuffers.size === 0 && this.revealFrameHandle !== null) {
      this.cancelFrame(this.revealFrameHandle);
      this.revealFrameHandle = null;
    }
  }

  /**
   * The "real" append. Mutates the trailing text segment in place (or
   * starts a new one when the prior segment is a tool-call), then
   * triggers a snapshot rebuild unless the caller is batching.
   */
  private flushChunkText(
    inflight: InflightChatCall,
    text: string,
    skipRebuild = false,
  ): void {
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (!conv) return;
    this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) => {
      if (msg.status !== 'streaming') return msg;
      const segments = msg.segments ?? [];
      const last = segments[segments.length - 1];
      const nextSegments: UiMessageSegment[] =
        last && last.type === 'text'
          ? [
            ...segments.slice(0, -1),
            { type: 'text', text: last.text + text },
          ]
          : [...segments, { type: 'text', text }];
      return {
        ...msg,
        content: msg.content + text,
        segments: nextSegments,
      };
    });
    if (!skipRebuild) this.rebuildChatSnapshot();
  }

  // ---- P5 — Tool calls -----------------------------------------------

  /**
   * Inject the tool executor (P5). Called once by `BridgeManager`
   * after `AssistantTools` is constructed. `startCall` reads from
   * this on each send so tools are available as soon as it's set;
   * before that, chat works fine without tools.
   */
  public setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /** Set per-conversation auto-accept (skips confirm dialogs for writes). */
  public setAutoAcceptWrites(
    provider: ProviderId,
    conversationId: string,
    value: boolean,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv || conv.autoAcceptWrites === value) return;
    conv.autoAcceptWrites = value;
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  /**
   * Handle a `from:ai:tool-call` event. Routes by tool class:
   *   - read-class: execute immediately, ship tool-result
   *   - write-class: pending-confirm (open dialog unless auto-accept)
   *
   * Errors and rejections still ship a tool-result back to main —
   * the SDK needs every tool-call to have a matching tool-result so
   * it can resume the stream. The result shape carries `ok: false +
   * error` so the model can recover and try a different approach.
   */
  public onToolCall(payload: ChatToolCallEvent): void {
    const inflight = this.inflightChats.get(payload.callId);
    if (!inflight) return; // foreign callId (e.g. test ping) — silently drop
    const executor = this.toolExecutor;
    if (!executor || !executor.hasTool(payload.toolName)) {
      this.recordToolCall(inflight, {
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        arguments: payload.arguments,
        status: 'failed',
        errorCode: 'unknown_tool',
        errorMessage: `Unknown tool: ${payload.toolName}`,
      });
      this.shipToolResult(payload.callId, payload.toolCallId, {
        ok: false,
        error: 'unknown_tool',
      });
      return;
    }
    const toolClass = executor.classify(payload.toolName);
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    const autoAccept = conv?.autoAcceptWrites ?? false;

    const initialStatus: ToolInvocation['status'] =
      toolClass === 'write' && !autoAccept ? 'pending-confirm' : 'executing';
    this.recordToolCall(inflight, {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      arguments: payload.arguments,
      status: initialStatus,
    });

    if (toolClass === 'write' && !autoAccept) {
      void this.runWithConfirmation(payload, executor);
    } else {
      void this.runImmediate(payload, executor);
    }
  }

  /** Execute a tool now and ship the result. */
  private async runImmediate(
    payload: ChatToolCallEvent,
    executor: ToolExecutor,
  ): Promise<void> {
    const inflight = this.inflightChats.get(payload.callId);
    if (!inflight) return;
    try {
      const result = await executor.execute(payload.toolName, payload.arguments);
      this.updateToolCall(inflight, payload.toolCallId, (tc) => ({
        ...tc,
        status: 'succeeded',
        result,
      }));
      this.shipToolResult(payload.callId, payload.toolCallId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateToolCall(inflight, payload.toolCallId, (tc) => ({
        ...tc,
        status: 'failed',
        errorCode: 'execution_failed',
        errorMessage: message,
      }));
      this.shipToolResult(payload.callId, payload.toolCallId, {
        ok: false,
        error: message,
      });
    }
  }

  /** Open the confirm dialog, then execute or reject. */
  private async runWithConfirmation(
    payload: ChatToolCallEvent,
    executor: ToolExecutor,
  ): Promise<void> {
    const preview = executor.buildPreview(payload.toolName, payload.arguments);
    const ok = await confirmToolCallExternal({
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      arguments: payload.arguments,
      preview,
    });
    const inflight = this.inflightChats.get(payload.callId);
    if (!inflight) return; // chat was cancelled while we awaited the user
    if (!ok) {
      this.updateToolCall(inflight, payload.toolCallId, (tc) => ({
        ...tc,
        status: 'failed',
        errorCode: 'rejected',
        errorMessage: 'User declined the tool call.',
      }));
      this.shipToolResult(payload.callId, payload.toolCallId, {
        ok: false,
        error: 'rejected',
      });
      return;
    }
    this.updateToolCall(inflight, payload.toolCallId, (tc) => ({
      ...tc,
      status: 'executing',
    }));
    await this.runImmediate(payload, executor);
  }

  private shipToolResult(
    callId: string,
    toolCallId: string,
    result: unknown,
  ): void {
    const req: ToolResultRequest = { callId, toolCallId, result };
    this.bridge.send('to:ai:tool-result', req);
  }

  /** Append a new toolCall record to the assistant message (immutable). */
  private recordToolCall(
    inflight: InflightChatCall,
    invocation: ToolInvocation,
  ): void {
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (!conv) return;
    this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) => {
      const existing = msg.segments ?? [];
      // Don't push a tool-call segment if this tool already has one —
      // `recordToolCall` runs on every state transition (pending →
      // executing → succeeded/failed) and we want the same slot to
      // render the updated card, not a fresh row.
      const alreadyInSegments = existing.some(
        (s) => s.type === 'tool-call' && s.toolCallId === invocation.toolCallId,
      );
      const nextSegments: UiMessageSegment[] = alreadyInSegments
        ? existing
        : [...existing, { type: 'tool-call', toolCallId: invocation.toolCallId }];
      return {
        ...msg,
        toolCalls: [...(msg.toolCalls ?? []), invocation],
        segments: nextSegments,
      };
    });
    this.rebuildChatSnapshot();
  }

  /** Update an existing toolCall record via the mapper (immutable). */
  private updateToolCall(
    inflight: InflightChatCall,
    toolCallId: string,
    mapper: (tc: ToolInvocation) => ToolInvocation,
  ): void {
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (!conv) return;
    this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) => {
      const list = msg.toolCalls;
      if (!list) return msg;
      const idx = list.findIndex((tc) => tc.toolCallId === toolCallId);
      if (idx < 0) return msg;
      const next = [...list];
      next[idx] = mapper(list[idx]);
      return { ...msg, toolCalls: next };
    });
    this.rebuildChatSnapshot();
  }

  // ---- P6 — Context controls ----------------------------------------

  /**
   * Inject the context provider (P6). Called once by `BridgeManager`
   * after the other managers exist. Before this, `contextFor()`
   * returns null and the chip/indicator surfaces collapse to empty —
   * non-fatal, just means no system context until injection lands.
   */
  public setContextProvider(provider: AssistantContextProvider): void {
    this.contextProvider = provider;
  }

  /** Set per-conversation share-active-file toggle. */
  public setShareActiveFile(
    provider: ProviderId,
    conversationId: string,
    value: boolean,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv || conv.shareActiveFile === value) return;
    conv.shareActiveFile = value;
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  /** Set per-conversation share-selection toggle. */
  public setShareSelection(
    provider: ProviderId,
    conversationId: string,
    value: boolean,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv || conv.shareSelection === value) return;
    conv.shareSelection = value;
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  /**
   * Add an explicit `@`-mention to a conversation. Reads the file
   * content immediately so the chip row + token indicator can size
   * it without a second async hop, and stashes the content for
   * `contextFor()` to consume at send time. Idempotent on the path
   * (re-add refreshes the cached content).
   */
  public async addMention(
    provider: ProviderId,
    conversationId: string,
    path: string,
  ): Promise<void> {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv) return;
    if (!this.contextProvider) return;
    // Read first — if it throws, we don't poison the chip row with a
    // path we can't actually include.
    const { content } = await this.contextProvider.readFile(path);
    this.mentionContents.set(path, content);
    if (conv.mentions.includes(path)) {
      // Re-add: chip stays put, content gets refreshed (above), but
      // we still emit so any consumer keying on `updatedAt` re-renders.
      conv.updatedAt = Date.now();
      this.rebuildChatSnapshot();
      return;
    }
    conv.mentions = [...conv.mentions, path];
    conv.updatedAt = Date.now();
    this.rebuildChatSnapshot();
  }

  /**
   * Remove an `@`-mention. Drops the cached content when no remaining
   * conversation references the path (chats might share mentions; we
   * keep the cache live until the last reference goes).
   */
  public removeMention(
    provider: ProviderId,
    conversationId: string,
    path: string,
  ): void {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv) return;
    if (!conv.mentions.includes(path)) return;
    conv.mentions = conv.mentions.filter((m) => m !== path);
    conv.updatedAt = Date.now();
    const stillUsed = PROVIDER_IDS.some((p) => {
      for (const c of this.conversations[p].values()) {
        if (c.mentions.includes(path)) return true;
      }
      return false;
    });
    if (!stillUsed) this.mentionContents.delete(path);
    this.rebuildChatSnapshot();
  }

  /**
   * Synchronous descriptor list for the chip row. Built from the
   * conversation's toggles + cached mention metadata; no disk I/O.
   * Returns an empty array when the context provider hasn't been
   * injected yet (early boot).
   *
   * Order: active file → selection → mentions (insertion order). The
   * active file is omitted when it doesn't exist or the buffer is
   * untitled; the selection chip is omitted when the toggle is off
   * or there's no live selection. Mentions whose path equals the
   * active file path are de-duped so the user doesn't see two chips
   * for the same content.
   */
  public contextChips(
    provider: ProviderId,
    conversationId: string,
  ): AssistantContextChip[] {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv || !this.contextProvider) return [];
    const chips: AssistantContextChip[] = [];
    const active = conv.shareActiveFile
      ? this.contextProvider.getActiveFile()
      : null;
    if (active) {
      chips.push({
        kind: 'active',
        path: active.path,
        label: `${baseName(active.path)} (active)`,
        byteCount: active.content.length,
      });
    }
    if (conv.shareSelection) {
      const sel = this.contextProvider.getSelection();
      if (sel) {
        chips.push({
          kind: 'selection',
          path: sel.path,
          label: `selection L${sel.startLine}–L${sel.endLine}`,
          byteCount: sel.text.length,
        });
      }
    }
    for (const path of conv.mentions) {
      if (active && active.path === path) continue; // dedupe vs active
      const content = this.mentionContents.get(path);
      chips.push({
        kind: 'mention',
        path,
        label: baseName(path),
        ...(content !== undefined ? { byteCount: content.length } : {}),
      });
    }
    return chips;
  }

  /**
   * Estimated token count for the next send: draft input + every chip's
   * byte-count contribution + tag overhead, divided by 4. Cheap
   * heuristic, intentionally rough — surfaced to the user purely to
   * flag "you're about to ship a huge prompt." No tiktoken dependency
   * in v1 (see Decisions).
   */
  public contextTokenEstimate(
    provider: ProviderId,
    conversationId: string,
    draftText: string,
  ): number {
    const chips = this.contextChips(provider, conversationId);
    let chars = draftText.length;
    for (const chip of chips) {
      if (chip.byteCount !== undefined) {
        // Add a small constant for the fence/path tag wrapper we add
        // when assembling the system message — keeps the estimate
        // honest for many small mentions.
        chars += chip.byteCount + 64;
      }
    }
    return Math.ceil(chars / 4);
  }

  /**
   * Assemble the system context message that gets prepended to the
   * next send. Reads the active-file / selection synchronously off
   * the context provider and the mention contents from the cache
   * (`addMention` populates it eagerly). Returns null when there's
   * nothing to share — caller (`startCall`) just ships the message
   * history without a leading system turn.
   */
  public async contextFor(
    provider: ProviderId,
    conversationId: string,
  ): Promise<ChatMessage | null> {
    const conv = this.conversations[provider].get(conversationId);
    if (!conv || !this.contextProvider) return null;
    const blocks: string[] = [];
    const seenPaths = new Set<string>();
    const active = conv.shareActiveFile
      ? this.contextProvider.getActiveFile()
      : null;
    if (active) {
      blocks.push(formatFileBlock(active.path, active.content));
      seenPaths.add(active.path);
    }
    if (conv.shareSelection) {
      const sel = this.contextProvider.getSelection();
      if (sel && sel.text) {
        blocks.push(formatSelectionBlock(sel));
      }
    }
    for (const path of conv.mentions) {
      if (seenPaths.has(path)) continue; // already included via active-file
      const content = this.mentionContents.get(path);
      if (content === undefined) continue; // not yet loaded — skip silently
      blocks.push(formatFileBlock(path, content));
      seenPaths.add(path);
    }
    if (blocks.length === 0) return null;
    return {
      role: 'system',
      content: blocks.join('\n\n'),
    };
  }

  // ---- P7 — Persistence (serialize / restore) -----------------------

  /**
   * Capture a snapshot of the chat state suitable for writing to disk.
   *
   * Runtime-only state is filtered out:
   *   - `inflightChats` (cancelled on quit; not persisted)
   *   - assistant messages with `status: 'streaming'` (quit mid-stream
   *     drops the partial bubble — the user sees a clean reload, not
   *     a half-written sentence)
   *   - tool invocations in `pending-confirm` / `executing` (they
   *     can't resume across a restart; dropping them keeps the
   *     persisted record honest about what actually happened)
   *
   * Returns null when there's nothing worth persisting (no conversations
   * across any provider). Callers can short-circuit the IPC write in
   * that case.
   */
  public serialize(): PersistedConversations | null {
    const conversations: PersistedConversations['conversations'] = {
      anthropic: [],
      openai: [],
      ollama: [],
    };
    let anyConversation = false;
    for (const provider of PROVIDER_IDS) {
      const map = this.conversations[provider];
      // Order by recency-descending to match the snapshot ordering
      // and the doc's persistence schema.
      const ordered = Array.from(map.values()).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      for (const conv of ordered) {
        anyConversation = true;
        const messages: PersistedChatMessage[] = [];
        for (const m of conv.messages) {
          if (m.role !== 'user' && m.role !== 'assistant') continue;
          // Streaming messages are mid-flight; the corresponding
          // in-flight call is cancelled on quit, so the message body
          // can't be recovered. Drop it.
          if (m.status === 'streaming') continue;
          const persistedStatus =
            m.status === 'complete' ||
            m.status === 'cancelled' ||
            m.status === 'failed'
              ? m.status
              : 'complete';
          // Keep only fully-resolved tool invocations. Pending /
          // executing entries can't pick back up across a restart.
          const persistedToolCalls = m.toolCalls?.filter(
            (tc) => tc.status === 'succeeded' || tc.status === 'failed',
          );
          messages.push({
            id: m.id,
            role: m.role,
            content: m.content,
            status: persistedStatus,
            ...(m.errorCode ? { errorCode: m.errorCode } : {}),
            ...(m.errorMessage ? { errorMessage: m.errorMessage } : {}),
            ...(persistedToolCalls && persistedToolCalls.length > 0
              ? { toolCalls: persistedToolCalls }
              : {}),
            createdAt: m.createdAt,
          });
        }
        conversations[provider].push({
          id: conv.id,
          providerId: conv.providerId,
          title: conv.title,
          model: conv.model,
          messages,
          autoAcceptWrites: conv.autoAcceptWrites,
          shareActiveFile: conv.shareActiveFile,
          shareSelection: conv.shareSelection,
          mentions: [...conv.mentions],
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      }
    }
    if (!anyConversation) return null;
    const drafts: Record<string, string> = {};
    for (const [k, v] of this.drafts) drafts[k] = v;
    return {
      activeProvider: this.activeProviderTab,
      activeConversation: { ...this.activeConv },
      conversations,
      drafts,
    };
  }

  /**
   * Replay a serialized snapshot back into in-memory state. Idempotent
   * (replays clear any existing state first). Re-emits a single chat
   * snapshot at the end so React subscribers re-render once instead
   * of once-per-conversation.
   *
   * Treats `null` / a malformed snapshot as "no history" — the manager
   * is left empty rather than throwing.
   */
  public restore(snapshot: PersistedConversations | null): void {
    // Disable the persist hook for the duration of the replay so the
    // many rebuildChatSnapshot calls below don't ricochet back to
    // main as a write of the data we just read.
    const wasEnabled = this.persistEnabled;
    this.persistEnabled = false;
    try {
      // Clear any in-memory state first so restore is idempotent.
      this.conversations = {
        anthropic: new Map(),
        openai: new Map(),
        ollama: new Map(),
      };
      this.activeConv = { anthropic: null, openai: null, ollama: null };
      this.drafts.clear();
      this.activeProviderTab = null;
      if (!snapshot) {
        this.rebuildChatSnapshot();
        return;
      }
      this.applyRestoreSnapshot(snapshot);
    } finally {
      this.persistEnabled = wasEnabled;
    }
  }

  private applyRestoreSnapshot(snapshot: PersistedConversations): void {
    for (const provider of PROVIDER_IDS) {
      const persistedList = snapshot.conversations?.[provider] ?? [];
      for (const persisted of persistedList) {
        // Re-hydrate as a runtime ChatConversation. Messages get
        // their runtime status mapped 1:1 (persisted statuses are
        // already in the runtime vocabulary minus 'streaming').
        const messages: UiChatMessage[] = persisted.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          status: m.status,
          ...(m.errorCode ? { errorCode: m.errorCode } : {}),
          ...(m.errorMessage ? { errorMessage: m.errorMessage } : {}),
          ...(m.toolCalls && m.toolCalls.length > 0
            ? { toolCalls: m.toolCalls }
            : {}),
          createdAt: m.createdAt,
        }));
        const conv: ChatConversation = {
          id: persisted.id,
          providerId: persisted.providerId,
          title: persisted.title,
          model: persisted.model,
          messages,
          autoAcceptWrites: persisted.autoAcceptWrites,
          shareActiveFile: persisted.shareActiveFile,
          shareSelection: persisted.shareSelection,
          mentions: [...persisted.mentions],
          createdAt: persisted.createdAt,
          updatedAt: persisted.updatedAt,
        };
        this.conversations[provider].set(conv.id, conv);
      }
      this.activeConv[provider] =
        snapshot.activeConversation?.[provider] ?? null;
    }
    this.activeProviderTab = snapshot.activeProvider ?? null;
    if (snapshot.drafts) {
      for (const [k, v] of Object.entries(snapshot.drafts)) {
        if (typeof v === 'string' && v.length > 0) this.drafts.set(k, v);
      }
    }
    this.rebuildChatSnapshot();
  }

  // ---- Done / error routing (shared with the P3 test path) -----------

  /**
   * Resolve a `from:ai:done` event. Checks the pending-test set first
   * (the P3 connection-test path), then falls through to the in-flight
   * chat set (P4). Foreign callIds are silently ignored.
   */
  public onChatDone(callId: string): void {
    const pendingTest = this.pendingTests.get(callId);
    if (pendingTest) {
      this.pendingTests.delete(callId);
      clearTimeout(pendingTest.timer);
      pendingTest.resolve({ ok: true });
      return;
    }
    const inflight = this.inflightChats.get(callId);
    if (!inflight) return;
    // Flush any buffered (un-revealed) text before flipping status so
    // the persisted / final-visible content matches everything the
    // model emitted upstream.
    this.drainPendingForCall(callId);
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (conv) {
      // Replace (not mutate) so React.memo on AssistantBody picks up
      // the status change and the streaming-dot disappears. If the
      // model said nothing and finished, mark complete anyway —
      // honest about the outcome.
      this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) =>
        msg.status === 'streaming' ? { ...msg, status: 'complete' } : msg,
      );
    }
    this.inflightChats.delete(callId);
    this.rebuildChatSnapshot();
  }

  /**
   * Resolve a `from:ai:error` event. Same routing as `onChatDone`:
   * test first, then in-flight chat. Foreign callIds are silently
   * ignored.
   */
  public onChatError(payload: ChatErrorEvent): void {
    const pendingTest = this.pendingTests.get(payload.callId);
    if (pendingTest) {
      this.pendingTests.delete(payload.callId);
      clearTimeout(pendingTest.timer);
      pendingTest.resolve({
        ok: false,
        code: payload.code,
        message: payload.message,
      });
      return;
    }
    const inflight = this.inflightChats.get(payload.callId);
    if (!inflight) return;
    // Flush any buffered text first — if the model emitted "Sure! Let
    // me…" then errored, we still want the partial body visible.
    this.drainPendingForCall(payload.callId);
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (conv) {
      this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) =>
        msg.status === 'streaming'
          ? {
            ...msg,
            status: 'failed',
            errorCode: payload.code,
            errorMessage: payload.message,
          }
          : msg,
      );
    }
    this.inflightChats.delete(payload.callId);
    this.rebuildChatSnapshot();
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private draftKey(provider: ProviderId, conversationId: string): string {
    return `${provider}:${conversationId}`;
  }

  /**
   * Replace the assistant message with the given id inside a
   * conversation, in-place at its index, using the provided mapper.
   * The mapper receives the current message and returns either the
   * updated message (new object — required so React.memo on
   * `<AssistantBody>` sees the change) or the same object to skip
   * the update.
   *
   * Also bumps `conv.updatedAt`. Caller is responsible for calling
   * `rebuildChatSnapshot()` after the mutation chain completes.
   */
  private replaceAssistantMessage(
    conv: ChatConversation,
    messageId: string,
    mapper: (msg: UiChatMessage) => UiChatMessage,
  ): void {
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const old = conv.messages[idx];
    const next = mapper(old);
    if (next === old) return;
    conv.messages[idx] = next;
    conv.updatedAt = Date.now();
  }

  private defaultModelFor(provider: ProviderId): string {
    const fromConfig = this.snapshot.config?.[provider]?.defaultModel;
    return fromConfig || FALLBACK_MODEL_BY_PROVIDER[provider];
  }

  private firstByRecency(provider: ProviderId): ChatConversation | undefined {
    let best: ChatConversation | undefined;
    for (const conv of this.conversations[provider].values()) {
      if (!best || conv.updatedAt > best.updatedAt) best = conv;
    }
    return best;
  }

  /**
   * Rebuild the chat snapshot from the source-of-truth maps and emit
   * to subscribers. Conversations are sorted by `updatedAt` descending
   * so the React list keeps newest-first ordering without callers
   * having to know the underlying Map's insertion order.
   *
   * The snapshot's outer object reference always changes — that's the
   * signal `useSyncExternalStore` watches. Inner per-provider arrays
   * are fresh too, but individual conversation objects are mutated in
   * place (no defensive cloning); React consumers should read fields
   * off the snapshot and not hold references across emits if they
   * need long-term immutability.
   */
  private rebuildChatSnapshot(): void {
    const conversations: AssistantChatSnapshot['conversations'] = {
      anthropic: [],
      openai: [],
      ollama: [],
    };
    for (const provider of PROVIDER_IDS) {
      conversations[provider] = Array.from(
        this.conversations[provider].values(),
      ).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    const activeConversation: AssistantChatSnapshot['activeConversation'] = {
      anthropic: this.activeConv.anthropic,
      openai: this.activeConv.openai,
      ollama: this.activeConv.ollama,
    };
    const drafts: AssistantChatSnapshot['drafts'] = {};
    for (const [k, v] of this.drafts) drafts[k] = v;
    const inflight: AssistantChatSnapshot['inflight'] = {};
    for (const [k, v] of this.inflightChats) inflight[k] = v;
    this.chatSnapshot = {
      conversations,
      activeConversation,
      activeProvider: this.activeProviderTab,
      drafts,
      inflight,
    };
    this.chatListeners.forEach((l) => l());
    // P7 — every snapshot rebuild is a state change worth eventually
    // persisting. The debounce coalesces a streaming burst (many
    // appendChunk → rebuildChatSnapshot calls in a single second)
    // into one write.
    this.schedulePersist();
  }

  /**
   * P7 — kick off (or reset) the debounced persist timer. Skips
   * scheduling while `persistEnabled` is false (during `restore`).
   */
  private schedulePersist(): void {
    if (!this.persistEnabled) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writePersistNow();
    }, AssistantManager.PERSIST_DEBOUNCE_MS);
  }

  /**
   * P7 — synchronously flush whatever's pending in the debounce
   * window. Called by `BridgeListeners.from:ai:conversations:flush-request`
   * before quit. Idempotent — if nothing's pending, ships the
   * current serialized snapshot anyway so the renderer's reply
   * unblocks main's quit timer.
   */
  public flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writePersistNow('to:ai:conversations:flush');
  }

  private writePersistNow(
    channel: 'to:ai:conversations:save' | 'to:ai:conversations:flush' = 'to:ai:conversations:save',
  ): void {
    if (!this.persistEnabled) return;
    const snapshot = this.serialize();
    this.bridge.send(channel, snapshot);
  }

  /**
   * Mint a stable id with the given prefix. Uses `crypto.randomUUID`
   * when available (electron renderer + jsdom 22+ both provide it);
   * falls back to a timestamp+random suffix otherwise.
   */
  private static mintCallId(prefix: string): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    const uuid =
      typeof g.crypto?.randomUUID === 'function'
        ? g.crypto.randomUUID!()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${uuid}`;
  }
}

interface PendingTest {
  resolve: (value: ConnectionTestResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingOllama {
  resolve: (value: string[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/* -------------------------------------------------------------------- */
/*  P6 — context-message formatting helpers                              */
/* -------------------------------------------------------------------- */

/**
 * Cross-platform basename — strips both `/` and `\` separators so chip
 * labels read naturally on every OS. We deliberately don't import
 * `path.basename` (Node-only) since this code runs in the renderer.
 */
function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Fence content with `\`\`\`md path="X.md"\n…\n\`\`\`` — the format
 * the doc's "Context controls" section calls out. Markdown fences
 * inside the content are escaped by widening the outer fence to four
 * backticks when the content itself contains a triple-backtick run,
 * so models don't see a prematurely-closed code block.
 */
function formatFileBlock(path: string, content: string): string {
  const fence = content.includes('```') ? '````' : '```';
  return `${fence}md path="${path}"\n${content}\n${fence}`;
}

/**
 * Selection block — same fenced shape as `formatFileBlock` but adds
 * `lines="L42-L67"` so the model knows where the snippet came from.
 */
function formatSelectionBlock(sel: {
  path: string | null;
  text: string;
  startLine: number;
  endLine: number;
}): string {
  const fence = sel.text.includes('```') ? '````' : '```';
  const pathAttr = sel.path ? ` path="${sel.path}"` : '';
  return `${fence}md${pathAttr} lines="L${sel.startLine}-L${sel.endLine}"\n${sel.text}\n${fence}`;
}
