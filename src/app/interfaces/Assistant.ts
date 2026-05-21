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
 * registry is the source of truth for tool implementations; main
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
   * `maxOutputTokens`. The connection-test ping uses `1` so the
   * round-trip stays cheap; ordinary chat calls leave it unset.
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
  /**
   * RSA-OAEP (SHA-256) ciphertext of the UTF-8 plaintext API key,
   * base64-encoded. Encrypted in the renderer with the per-session
   * public key fetched via `mked:secure:public-key`; decrypted in
   * main by `SecureChannel.decryptString`. The plaintext key never
   * crosses IPC.
   */
  ciphertext: string;
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
    | 'model_unsupported_tools'
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
  /**
   * Persisted chat history. Absent on v1 files written before this
   * block was added; loaders treat undefined as "no history" (the
   * first post-upgrade save writes the new block). Conversation
   * records carry the doc's `ConversationRecord` shape minus
   * runtime-only fields (no `status`, no `toolCalls` mid-stream —
   * `serialize()` strips those before write).
   */
  conversations?: PersistedConversations;
}

/**
 * Persisted chat history shape — what `AssistantManager.serialize()`
 * produces and `AssistantManager.restore(...)` consumes. Lives next
 * to `providers` + `keys` inside `~/.mkeditor/assistant.json`.
 */
export interface PersistedConversations {
  /** Last selected provider tab. */
  activeProvider: ProviderId | null;
  /** Per-provider last-open conversation id. */
  activeConversation: Record<ProviderId, string | null>;
  /** Conversations grouped by provider id; insertion order = recency-descending. */
  conversations: Record<ProviderId, PersistedConversation[]>;
  /** Per-`${provider}:${conversationId}` draft input that survived shutdown. */
  drafts: Record<string, string>;
}

/**
 * On-disk conversation record — narrower than the runtime
 * `ChatConversation` (no streaming placeholder messages, no in-flight
 * tool-call cards). `serialize()` filters runtime-only state out.
 */
export interface PersistedConversation {
  id: string;
  providerId: ProviderId;
  title: string;
  model: string;
  messages: PersistedChatMessage[];
  autoAcceptWrites: boolean;
  shareActiveFile: boolean;
  shareSelection: boolean;
  mentions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Persisted lifecycle. Streaming messages are dropped at serialize time. */
  status: 'complete' | 'cancelled' | 'failed';
  errorCode?: ChatErrorEvent['code'];
  errorMessage?: string;
  /**
   * Resolved tool invocations (succeeded / failed). Pending / executing
   * cards are filtered out at serialize time — they wouldn't make
   * sense after restart.
   */
  toolCalls?: ToolInvocation[];
  createdAt: number;
}

/** Defaults applied when no config file exists. User overrides in P3. */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfigMap = {
  anthropic: {
    enabled: false,
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    enabled: false,
    defaultModel: 'gpt-5',
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
/*  Chat state shapes (renderer-side only, no IPC wire role)             */
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
 * `toolCalls` carries the invocations the model emitted during this
 * assistant turn (rendered as cards below the text body by
 * `<ChatMessage>` / `<ToolCallCard>`).
 */
/**
 * Ordered renderer-side segment. The model emits text and tool calls
 * interleaved across one or more steps within a single assistant
 * turn; `segments` preserves that order so `<ChatMessage>` can render
 * text → tool card → more text → more tool cards in the right
 * positions. `content` is still maintained as the concatenated text
 * (for the wire shape we ship to the model and the eventual P7
 * persistence payload).
 */
export type UiMessageSegment =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string };

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
  /**
   * Ordered text + tool-call slots for the renderer. Lets
   * `<ChatMessage>` interleave tool-call cards with the surrounding
   * text instead of dumping all cards under the message. Populated
   * by `AssistantManager.appendChunk` + `recordToolCall`; the
   * `content` field above stays in sync (joined text segments) so
   * the wire shape sent to the model is unchanged.
   */
  segments?: UiMessageSegment[];
  createdAt: number;
}

/* -------------------------------------------------------------------- */
/*  Tool invocation (renderer-side, no IPC wire role)                    */
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

/**
 * Preview payload built by the executor when a write-class tool fires.
 * Shown in both the legacy `<ConfirmToolCall>` modal and (inline tool
 * confirmation work) the in-chat diff card. Lives in the shared
 * interfaces file so the renderer snapshot can carry it without
 * pulling browser-side modules through `AssistantChatSnapshot`.
 *
 * `before`/`after` are pre-truncated to 4000 chars by the manager —
 * the inline diff card offers a "show full" expander that fetches the
 * untruncated content via `mked:fs:readfile` on demand.
 */
export interface ToolConfirmPreview {
  kind: 'edit' | 'write' | 'create' | 'replace' | 'insert';
  path?: string;
  /** Text being replaced (undefined for `create` and `insert`). */
  before?: string;
  /** Text the tool will write. */
  after: string;
  /** Optional descriptive line (e.g. line range for `edit`). */
  detail?: string;
}

/**
 * A tool-call awaiting user confirmation, surfaced through the chat
 * snapshot so the renderer can render the inline diff card. Keyed by
 * `toolCallId` in `AssistantChatSnapshot.pendingConfirms`. Does NOT
 * carry the resolver function — that lives only inside AssistantManager
 * and is invoked through `respondToConfirm(toolCallId, ok)`.
 */
export interface PendingConfirm {
  toolCallId: string;
  toolName: string;
  /** In-flight chat the confirmation belongs to. */
  callId: string;
  /** Same shape AssistantTools.buildPreview returns; null when the tool didn't supply one. */
  preview: ToolConfirmPreview | null;
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
   * Per-conversation override for write-class tool confirmations.
   * When true, write tools auto-execute without surfacing the
   * confirm dialog. Persisted alongside the rest of the
   * conversation record.
   */
  autoAcceptWrites: boolean;
  /**
   * Context controls. Defaults: `shareActiveFile: true`,
   * `shareSelection: false`. Per-conversation; persist alongside
   * `autoAcceptWrites`. Drive the chip row, the gear popover
   * switches, and the system message `AssistantManager.contextFor()`
   * assembles at send time.
   */
  shareActiveFile: boolean;
  shareSelection: boolean;
  /**
   * Sticky explicit `@`-mention chips. Absolute paths picked from
   * the file tree via `<MentionPicker>`. Persist across sends
   * within the conversation until the user × removes them.
   */
  mentions: string[];
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
   * Currently-selected provider tab. Persisted so reopening the app
   * lands the sidebar on the same tab. Null when no tab has been
   * picked yet (boot before restore, or every provider disabled).
   */
  activeProvider: ProviderId | null;
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
  /**
   * Write-class tool calls awaiting user confirmation, keyed by
   * `toolCallId`. Surfaced through the snapshot so `<ToolCallCard>`
   * can render the inline diff + Accept/Reject row alongside the
   * existing `<ConfirmToolCall>` modal (which still fires as the
   * primary UI today and as the fallback after the inline UI lands).
   * Empty when no tool is awaiting confirmation.
   */
  pendingConfirms: Record<string, PendingConfirm>;
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
