import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type {
  ApiProviderId,
  AssistantChatSnapshot,
  CancelRequest,
  ChatConversation,
  ChatErrorEvent,
  ChatMessage,
  ChatRequest,
  ConfigPushPayload,
  ConfigSetRequest,
  InflightChatCall,
  OllamaListRequest,
  OllamaModelsEvent,
  ProviderId,
  SanitizedProviderConfig,
  UiChatMessage,
} from '../../app/interfaces/Assistant';

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
  openai: 'gpt-4o',
  ollama: 'llama3.2',
};

const EMPTY_CHAT_SNAPSHOT: AssistantChatSnapshot = {
  conversations: { anthropic: [], openai: [], ollama: [] },
  activeConversation: { anthropic: null, openai: null, ollama: null },
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
  /** Key shape: `${provider}:${conversationId}`. */
  private drafts = new Map<string, string>();
  private inflightChats = new Map<string, InflightChatCall>();

  constructor(private bridge: ContextBridgeAPI) {}

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
    const wireMessages: ChatMessage[] = conv.messages
      .filter(
        (m) => m.id !== assistantMsg.id && m.status === 'complete' && m.content,
      )
      .map((m) => ({ role: m.role, content: m.content }));

    const req: ChatRequest = {
      callId,
      provider,
      model: conv.model,
      messages: wireMessages,
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
    const conv = this.conversations[inflight.provider].get(
      inflight.conversationId,
    );
    if (!conv) return;
    this.replaceAssistantMessage(conv, inflight.assistantMessageId, (msg) =>
      msg.status === 'streaming'
        ? { ...msg, content: msg.content + text }
        : msg,
    );
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
      drafts,
      inflight,
    };
    this.chatListeners.forEach((l) => l());
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
