/**
 * AI Assistant — shared types for the main process and the wire payloads
 * exchanged with the renderer.
 *
 * No imports from the SDK or from electron — these types are referenced
 * by both `src/app/lib/AppAssistant.ts` (which owns the SDK clients) and,
 * indirectly via the `from:ai:*` event payloads, by the renderer's
 * `AssistantManager` (P4+). The renderer cannot import from `src/app/`,
 * so the same shapes are duplicated on the renderer side in P2/P4 when
 * they're needed there.
 */

/** The three providers the user can connect in v1. */
export type ProviderId = 'anthropic' | 'openai' | 'ollama';

/** Non-secret config shared by the API-key-bearing providers. */
export interface ApiProviderConfig {
  /** Whether the provider should appear as a tab in the assistant sidebar. */
  enabled: boolean;
  /** Model selected as the default for new conversations. */
  defaultModel: string;
}

/** Non-secret config for the local-only Ollama provider. */
export interface OllamaProviderConfig {
  enabled: boolean;
  /** Daemon base URL (default `http://localhost:11434`). */
  baseUrl: string;
  defaultModel: string;
}

export interface ProviderConfigMap {
  anthropic: ApiProviderConfig;
  openai: ApiProviderConfig;
  ollama: OllamaProviderConfig;
}

/**
 * Payload sent to the renderer over `from:ai:config`. Each provider gets
 * a `hasKey: boolean` flag instead of the actual key value — keys never
 * cross the IPC boundary in the renderer-bound direction.
 */
export interface SanitizedProviderConfig {
  anthropic: ApiProviderConfig & { hasKey: boolean };
  openai: ApiProviderConfig & { hasKey: boolean };
  /** Ollama has no API key — `hasKey` is always false. Carried for symmetry. */
  ollama: OllamaProviderConfig & { hasKey: false };
}

export interface ConfigPushPayload {
  config: SanitizedProviderConfig;
  /**
   * `safeStorage.isEncryptionAvailable()` result. When false, the
   * renderer disables remote providers (Anthropic / OpenAI) so the user
   * isn't prompted for a key we can't safely persist.
   */
  encryptionAvailable: boolean;
}

/**
 * Minimal message shape ferried in `to:ai:chat`. P4 may extend this with
 * attachments, images, etc. For P1 we only need text + the tool-result
 * variants needed to feed external tool execution back to the SDK loop.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set for role: 'tool' — identifies which call this result satisfies. */
  toolCallId?: string;
  toolName?: string;
}

/**
 * Tool descriptor as ferried over IPC. The renderer's `AssistantTools`
 * registry (P5) is the source of truth for tool implementations; main
 * treats the descriptors as opaque metadata it forwards to the SDK.
 *
 * `parameters` carries a JSON-schema-shaped object (the SDK accepts both
 * `jsonSchema()` wrappers and bare JSON-Schema). We do not validate it
 * in main — the renderer's zod schemas already round-trip through that
 * format.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: unknown;
}

/** Payload of `to:ai:chat`. */
export interface ChatRequest {
  /** Unique id minted by the renderer; chunks and completion events tag back to it. */
  callId: string;
  provider: ProviderId;
  /** Model id (overrides the provider's `defaultModel` for this call). */
  model: string;
  messages: ChatMessage[];
  /** Empty / omitted = plain text turn. */
  tools?: ToolDescriptor[];
}

/** Payload of `to:ai:cancel`. */
export interface CancelRequest {
  callId: string;
}

/** Payload of `to:ai:tool-result`. */
export interface ToolResultRequest {
  callId: string;
  toolCallId: string;
  /** Renderer-side execute() return value. Serialised as JSON over IPC. */
  result: unknown;
}

/** Payload of `to:ai:ollama:list`. */
export interface OllamaListRequest {
  callId: string;
  baseUrl: string;
}

/** Payload of `to:ai:config:set`. */
export type ConfigSetRequest =
  | { provider: 'anthropic'; config: Partial<ApiProviderConfig> }
  | { provider: 'openai'; config: Partial<ApiProviderConfig> }
  | { provider: 'ollama'; config: Partial<OllamaProviderConfig> };

/** Payload of `to:ai:key:set`. */
export interface KeySetRequest {
  provider: 'anthropic' | 'openai';
  /** Plaintext API key. Encrypted server-side; never echoed back. */
  key: string;
}

/** Payload of `to:ai:key:clear`. */
export interface KeyClearRequest {
  provider: 'anthropic' | 'openai';
}

/** Payload of `from:ai:chunk`. */
export interface ChatChunkEvent {
  callId: string;
  /** Incremental text delta — concatenate at the renderer to render. */
  text: string;
}

/** Payload of `from:ai:tool-call`. */
export interface ChatToolCallEvent {
  callId: string;
  toolCallId: string;
  toolName: string;
  /** Parsed JSON arguments emitted by the model. */
  arguments: unknown;
}

/** Payload of `from:ai:done`. */
export interface ChatDoneEvent {
  callId: string;
  /** Token usage if the provider reports it. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** SDK-reported finish reason: 'stop' | 'length' | 'tool-calls' | … */
  finishReason?: string;
}

/** Payload of `from:ai:error`. */
export interface ChatErrorEvent {
  callId: string;
  /** Stable code the renderer uses to pick a translated message. */
  code:
    | 'missing_key'
    | 'invalid_key'
    | 'rate_limited'
    | 'context_window_exceeded'
    | 'network_error'
    | 'ollama_unreachable'
    | 'cancelled'
    | 'unknown';
  /** Free-text detail for logging. The renderer should rely on `code` for UX strings. */
  message: string;
}

/** Payload of `from:ai:ollama:models`. */
export interface OllamaModelsEvent {
  callId: string;
  /** Set on success. */
  models?: string[];
  /** Set on failure. */
  error?: string;
}

/**
 * Disk shape of `~/.mkeditor/assistant.json`. Both `AssistantConfig` and
 * `AssistantKeyStore` read/write this same file. Each owns its own section
 * to keep the responsibilities clear; concurrent writes are safe because
 * the main process is single-threaded.
 *
 * `keys` carries the safeStorage-encrypted ciphertext as a base64 string
 * per provider. The actual decrypt happens lazily in `AssistantKeyStore`.
 *
 * `version` exists so a future re-shape (e.g. adding `conversations` in
 * P7) can be migrated rather than dropped.
 */
export interface AssistantStoreFile {
  version: 1;
  /**
   * Per-provider non-secret config. Named `providers` to match the
   * doc's Persistence Schema field so P7's `AssistantPayload`
   * extension (which adds `conversations`, `activeProvider`,
   * `activeConversation`) can layer on without renaming this field.
   */
  providers: ProviderConfigMap;
  keys: Partial<Record<'anthropic' | 'openai', string>>;
}

/** Defaults applied when no config file exists. User overrides in P3. */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfigMap = {
  anthropic: {
    enabled: false,
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    enabled: false,
    defaultModel: 'gpt-4o',
  },
  ollama: {
    enabled: false,
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
  },
};

/** The provider ids that carry an API key. */
export type ApiProviderId = 'anthropic' | 'openai';
