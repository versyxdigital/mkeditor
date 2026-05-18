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
  /**
   * Optional cap on the model's output. Forwarded to streamText's
   * `maxOutputTokens`. P3 uses `1` for the connection-test ping so the
   * round-trip stays cheap; chat calls (P4) leave it unset.
   */
  maxOutputTokens?: number;
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

/* -------------------------------------------------------------------- */
/*  Chat state shapes (P4 — renderer-side only, no IPC wire role)        */
/* -------------------------------------------------------------------- */

/**
 * The lifecycle state of a single assistant turn. P4 only deals with
 * pure text turns; tool-call states arrive in P5 (extended via the
 * `ToolCallRecord` shape in the doc's Persistence Schema).
 */
export type ChatMessageStatus =
  | 'streaming'
  | 'complete'
  | 'cancelled'
  | 'failed';

/**
 * Renderer-side view of a single message in a chat conversation.
 *
 * Deliberately distinct from the doc's persistence `ChatMessage`
 * (the P7 wire shape): `UiChatMessage` adds `status` / `errorCode` /
 * `errorMessage` for the streaming + error visuals and narrows
 * `role` to the two values P4 actually emits. When P7 lands, it will
 * introduce a `ConversationRecord`-shaped persistence type and a
 * `toUiMessage` / `fromUiMessage` translation pair — `UiChatMessage`
 * is intentionally not written to disk verbatim.
 *
 * P5: added `toolCalls` — invocations the model emitted during this
 * assistant turn (rendered as cards below the text body by
 * `<ChatMessage>` / `<ToolCallCard>`).
 */
export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: ChatMessageStatus;
  /** Stable error code (matches `ChatErrorEvent.code`) when status === 'failed'. */
  errorCode?: ChatErrorEvent['code'];
  /** Human-readable error detail when status === 'failed' (for logs / debugging). */
  errorMessage?: string;
  /**
   * Tool invocations the model emitted during this assistant turn.
   * Each card carries its own lifecycle (pending-confirm / executing
   * / succeeded / failed) independent of the message's `status`.
   */
  toolCalls?: ToolInvocation[];
  createdAt: number;
}

/* -------------------------------------------------------------------- */
/*  Tool invocation (P5 — renderer-side, no IPC wire role)               */
/* -------------------------------------------------------------------- */

/**
 * Lifecycle of a single tool invocation inside an assistant message.
 *
 * - `pending-confirm`: write-class tool waiting for the user's OK.
 * - `executing`: read-class auto-execute (or post-confirm) running.
 * - `succeeded`: the tool returned a result; assistant turn continues.
 * - `failed`: the tool threw or the user rejected; an error-shaped
 *   tool-result is sent back to the SDK so the model can recover.
 */
export type ToolInvocationStatus =
  | 'pending-confirm'
  | 'executing'
  | 'succeeded'
  | 'failed';

/** A single tool call rendered as a card inside the assistant bubble. */
export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  status: ToolInvocationStatus;
  /** Serialised result returned by the tool's `execute()` (succeeded). */
  result?: unknown;
  /** Translatable error short-code + human-readable detail (failed). */
  errorCode?: 'rejected' | 'execution_failed' | 'unknown_tool';
  errorMessage?: string;
}

/** A single conversation tracked under one provider tab. */
export interface ChatConversation {
  id: string;
  providerId: ProviderId;
  title: string;
  /**
   * The model used for the next send. Initialised to the provider's
   * `defaultModel` at creation time; user can edit per-conversation
   * through the chat header.
   */
  model: string;
  messages: UiChatMessage[];
  /**
   * Per-conversation override for write-class tool confirmations (P5).
   * Carried through P4 so the schema matches the doc's persistence
   * shape without breaking forward-compat when P7 lands.
   */
  autoAcceptWrites: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Snapshot the React side reads via `useSyncExternalStore`. Stable
 * reference between emits — `AssistantManager` rebuilds it on any
 * structural or per-message change. Drafts live alongside
 * conversations so input state survives tab/conversation switches.
 */
export interface AssistantChatSnapshot {
  /** Conversations grouped by provider, in recency-descending order. */
  conversations: Record<ProviderId, ChatConversation[]>;
  /** Currently-selected conversation per provider tab (null if none yet). */
  activeConversation: Record<ProviderId, string | null>;
  /**
   * In-progress input drafts. Key shape: `${provider}:${conversationId}`.
   * Empty string when no draft.
   */
  drafts: Record<string, string>;
  /**
   * CallIds with chat streams currently in flight. Empty between
   * turns. The chat UI uses this to toggle the send/stop button.
   */
  inflight: Record<string, InflightChatCall>;
}

/** Per-call bookkeeping kept while a chat turn streams. */
export interface InflightChatCall {
  callId: string;
  provider: ProviderId;
  conversationId: string;
  /** Id of the placeholder assistant message that chunks append to. */
  assistantMessageId: string;
  startedAt: number;
}
