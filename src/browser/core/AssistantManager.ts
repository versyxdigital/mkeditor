import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type {
  ApiProviderId,
  CancelRequest,
  ChatErrorEvent,
  ChatRequest,
  ConfigPushPayload,
  ConfigSetRequest,
  OllamaListRequest,
  OllamaModelsEvent,
  ProviderId,
  SanitizedProviderConfig,
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

/**
 * Renderer-side AI Assistant manager (introduced in P3).
 *
 * P3 surface: sanitized config snapshot, mutators for the three
 * `to:ai:*` config/key channels, Ollama model-list refresh, and a
 * one-shot connection test that piggy-backs `to:ai:chat` with
 * `maxOutputTokens: 1`. P4 will grow `startCall` / `cancelCall` /
 * streaming-chunk plumbing on the same class.
 *
 * Architectural responsibilities (CLAUDE.md): owns data + IPC; never
 * imports React. React reads via `subscribeConfig` + `getConfigSnapshot`
 * through the `AssistantContext` wrapper. The composition root injects
 * the bridge ref through the constructor.
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
   * never responds (rare but possible — e.g. the user closes Ollama
   * mid-request).
   */
  private pendingTests = new Map<string, PendingTest>();
  private pendingOllama = new Map<string, PendingOllama>();

  /** Test connections shouldn't hang forever — bound the wait. */
  private static readonly TEST_TIMEOUT_MS = 15_000;
  /** Ollama is local; if it doesn't respond in 6s something is wrong. */
  private static readonly OLLAMA_TIMEOUT_MS = 6_000;

  constructor(private bridge: ContextBridgeAPI) {}

  // ---------------------------------------------------------------------
  // Observable surface
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
   * Rebuilds the snapshot reference so `useSyncExternalStore`
   * consumers re-render only on real value changes.
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

  /**
   * Persist non-secret per-provider config. Main responds with a
   * fresh `from:ai:config` push, which `setConfigFromServer` applies.
   */
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

  /**
   * Fetch the available Ollama models. Resolves with the model id
   * list on success, rejects on failure. The settings UI calls this
   * to populate the model select.
   */
  public refreshOllamaModels(baseUrl: string): Promise<string[]> {
    const callId = AssistantManager.mintCallId('ollama');
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOllama.delete(callId);
        reject(new Error(`Ollama model list timed out after ${AssistantManager.OLLAMA_TIMEOUT_MS}ms`));
      }, AssistantManager.OLLAMA_TIMEOUT_MS);
      this.pendingOllama.set(callId, { resolve, reject, timer });
      const req: OllamaListRequest = { callId, baseUrl };
      this.bridge.send('to:ai:ollama:list', req);
    });
  }

  /**
   * Resolve the matching pending `refreshOllamaModels` call. Called by
   * `BridgeListeners` on `from:ai:ollama:models`. Late deliveries (for
   * a call that already timed out) are silently dropped.
   */
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

  /**
   * Validate that the configured key + model can reach the upstream
   * provider. Sends a single-token chat call and resolves with
   * `{ ok: true }` if `from:ai:done` arrives, or `{ ok: false, code,
   * message }` if `from:ai:error` arrives first.
   */
  public testConnection(provider: ProviderId, model: string): Promise<ConnectionTestResult> {
    const callId = AssistantManager.mintCallId('test');
    return new Promise<ConnectionTestResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTests.delete(callId);
        // Cancel the upstream so we don't waste tokens once the
        // user has stopped looking.
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

  /** Resolve the pending test by callId — invoked from `from:ai:done`. */
  public onChatDone(callId: string): void {
    const pending = this.pendingTests.get(callId);
    if (!pending) return;
    this.pendingTests.delete(callId);
    clearTimeout(pending.timer);
    pending.resolve({ ok: true });
  }

  /** Resolve the pending test by callId — invoked from `from:ai:error`. */
  public onChatError(payload: ChatErrorEvent): void {
    const pending = this.pendingTests.get(payload.callId);
    if (!pending) return;
    this.pendingTests.delete(payload.callId);
    clearTimeout(pending.timer);
    pending.resolve({
      ok: false,
      code: payload.code,
      message: payload.message,
    });
  }

  /**
   * Whether the given callId is one of this manager's pending requests.
   * `BridgeListeners` uses this to decide whether a `from:ai:done` /
   * `from:ai:error` / `from:ai:chunk` event belongs here (test
   * connection) or should fall through to the future `startCall`
   * machinery in P4.
   */
  public ownsCallId(callId: string): boolean {
    return (
      this.pendingTests.has(callId) || this.pendingOllama.has(callId)
    );
  }

  /** Send a cancel for any in-flight call (test or chat). */
  public cancelChat(callId: string): void {
    const req: CancelRequest = { callId };
    this.bridge.send('to:ai:cancel', req);
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * Mint a stable callId. Uses `crypto.randomUUID` when available
   * (electron renderer + jsdom 22+ both provide it); falls back to a
   * timestamp+random suffix otherwise.
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
