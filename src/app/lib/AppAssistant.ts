import { streamText, tool, jsonSchema, stepCountIs } from 'ai';
import type {
  LanguageModel,
  ModelMessage,
  Tool,
  ToolSet,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider-v2';
import type { BrowserWindow } from 'electron';
import type {
  ApiProviderId,
  CancelRequest,
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatRequest,
  ChatToolCallEvent,
  OllamaListRequest,
  OllamaModelsEvent,
  ProviderId,
  ToolDescriptor,
  ToolResultRequest,
} from '../interfaces/Assistant';
import { AssistantKeyStore } from './AssistantKeyStore';
import { AssistantConfig } from './AssistantConfig';

/**
 * Factory hooks for the SDK's per-provider model constructors. Exposed
 * so tests can inject mock builders without monkey-patching the SDK
 * modules at the global level. Production callers (just `main.ts`) use
 * the defaults.
 */
export interface ProviderModelFactories {
  openai: (apiKey: string, modelId: string) => LanguageModel;
  anthropic: (apiKey: string, modelId: string) => LanguageModel;
  ollama: (baseURL: string, modelId: string) => LanguageModel;
}

const DEFAULT_FACTORIES: ProviderModelFactories = {
  openai: (apiKey, modelId) => createOpenAI({ apiKey })(modelId),
  anthropic: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  ollama: (baseURL, modelId) => createOllama({ baseURL })(modelId),
};

/** Per-callId in-flight state retained between turns of a tool loop. */
interface CallState {
  request: ChatRequest;
  /** Conversation history we've accumulated, including assistant + tool messages from previous turns. */
  messages: ModelMessage[];
  /** Tool calls emitted in the most recent assistant turn that are still awaiting external results. */
  pending: Map<string, { toolName: string }>;
  /** Buffered tool results keyed by toolCallId for re-dispatch once all pending are resolved. */
  toolResults: Map<string, unknown>;
  /** Abort hook for the currently-running streamText (re-assigned per turn). */
  abortController: AbortController;
  /** Sticky flag flipped by `cancel()` so racing iterations bail out. */
  cancelled: boolean;
  /**
   * Resolver awaited by `runTurn` after the stream ends if tool calls are
   * still outstanding. `submitToolResult` calls this once every pending
   * call has a result. Set inside `runTurn`, consumed by `submitToolResult`.
   * Critically: the next streamText turn only fires after `runTurn` has
   * pushed the assistant message AND all tool results have landed —
   * without this gate, a fast IPC round-trip could fire the next turn
   * before we pushed the assistant message, leaving the model with a
   * tool_result block that has no matching tool_use in the prior message.
   */
  toolWaiter: (() => void) | null;
}

/**
 * AppAssistant
 *
 * Wraps the Vercel AI SDK with the public surface the renderer talks to
 * over IPC. Owns the per-callId stream state, drives the external
 * tool-execution loop (renderer-side `AssistantTools` runs the tools
 * and sends results back), and maps SDK errors to stable codes for the
 * renderer to translate.
 *
 * Single instance per BrowserWindow, constructed in `main.ts`. All
 * `from:ai:*` events flow through `this.context.webContents.send` —
 * no other class talks directly to the renderer about AI traffic.
 */
export class AppAssistant {
  private context: BrowserWindow;
  private factories: ProviderModelFactories;
  private calls = new Map<string, CallState>();

  constructor(
    context: BrowserWindow,
    factories: ProviderModelFactories = DEFAULT_FACTORIES,
  ) {
    this.context = context;
    this.factories = factories;
  }

  /**
   * Start a chat call. The `callId` ties together chunk/tool-call/done/
   * error events; the renderer's `AssistantManager` looks up the target
   * conversation by callId, never by "active" state, so concurrent
   * calls on different provider tabs remain isolated.
   *
   * Errors thrown synchronously (model factory failures, missing keys)
   * are mapped to `from:ai:error` and never propagated. The renderer
   * never sees a synchronous exception from this method.
   */
  chat(request: ChatRequest): void {
    const existing = this.calls.get(request.callId);
    if (existing) {
      // A stray re-send for the same callId — cancel the prior run, start
      // fresh. The plan allows one in-flight call per callId.
      this.cancel(request.callId);
    }

    const state: CallState = {
      request,
      messages: AppAssistant.toModelMessages(request.messages),
      pending: new Map(),
      toolResults: new Map(),
      abortController: new AbortController(),
      cancelled: false,
      toolWaiter: null,
    };
    this.calls.set(request.callId, state);
    void this.runTurn(state);
  }

  /**
   * Abort an in-flight call. Returns true if a call existed and was
   * aborted, false otherwise. The renderer sees a `from:ai:done` with
   * `finishReason: 'cancelled'` follow-up only if a turn was actively
   * streaming; once cancelled, no further `from:ai:*` events fire for
   * that callId.
   */
  cancel(req: CancelRequest | string): boolean {
    const callId = typeof req === 'string' ? req : req.callId;
    const state = this.calls.get(callId);
    if (!state) return false;
    state.cancelled = true;
    try {
      state.abortController.abort();
    } catch {
      // best-effort
    }
    // If runTurn is parked awaiting tool results, wake it so the
    // cancelled guard at the top of the post-stream branch can fire
    // and the awaiting Promise resolves instead of leaking.
    const waiter = state.toolWaiter;
    if (waiter) {
      state.toolWaiter = null;
      waiter();
    }
    this.calls.delete(callId);
    return true;
  }

  /**
   * Buffer a tool result. When every pending tool from the prior
   * assistant turn has been satisfied, the awaiting `runTurn` resumes
   * and starts the next streamText turn.
   *
   * Buffer-only is critical: firing the next turn from here used to
   * race the current turn's stream consumer — the assistant message
   * (carrying the tool_use blocks) hadn't been pushed yet when the
   * tool result for a fast read-class tool round-tripped from the
   * renderer. That meant the next request looked like `[user, tool]`
   * to Anthropic, which collapses adjacent user+tool blocks and rejects
   * with a `tool_use_id has no matching tool_use` 400 error.
   */
  submitToolResult(req: ToolResultRequest): void {
    const state = this.calls.get(req.callId);
    if (!state) return; // late delivery for a cancelled / finished call
    if (!state.pending.has(req.toolCallId)) return;

    state.toolResults.set(req.toolCallId, req.result);
    if (state.toolResults.size !== state.pending.size) return; // still waiting

    // All pending tool calls have results. If `runTurn` is awaiting,
    // wake it; otherwise the results sit in the buffer for the next
    // post-stream check in `runTurn`.
    const waiter = state.toolWaiter;
    if (waiter) {
      state.toolWaiter = null;
      waiter();
    }
  }

  /**
   * List models the local Ollama daemon advertises. Replies with
   * `from:ai:ollama:models { callId, models?, error? }`. Used by the
   * settings UI (P3) to populate the model picker. Pure GET — no key,
   * no caching at this layer (the renderer can debounce as needed).
   */
  async listOllamaModels(req: OllamaListRequest): Promise<void> {
    try {
      const url = new URL('/api/tags', req.baseUrl).toString();
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.sendOllamaModels({
          callId: req.callId,
          error: `Ollama returned HTTP ${res.status}`,
        });
        return;
      }
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      const models = (body.models ?? []).map((m) => m.name);
      this.sendOllamaModels({ callId: req.callId, models });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendOllamaModels({ callId: req.callId, error: message });
    }
  }

  /**
   * Build the sanitized config payload the renderer reads via
   * `from:ai:config`. Folds key-presence flags in from `AssistantKeyStore`.
   * Never includes a key value.
   */
  buildSanitizedConfig() {
    const config = AssistantConfig.load();
    return {
      config: {
        anthropic: {
          ...config.anthropic,
          hasKey: AssistantKeyStore.hasKey('anthropic'),
        },
        openai: {
          ...config.openai,
          hasKey: AssistantKeyStore.hasKey('openai'),
        },
        // Ollama doesn't carry a key; carried as `hasKey: false` for symmetry.
        ollama: { ...config.ollama, hasKey: false as const },
      },
      encryptionAvailable: AssistantKeyStore.isEncryptionAvailable(),
    };
  }

  /**
   * Drive the streamText loop for a single call. Runs the assistant
   * step, then — if tool calls were emitted — awaits external results
   * and recurses for the next assistant step. All ordering invariants
   * (push assistant message before tool message; only fire next turn
   * after both have landed) live here so `submitToolResult` can stay a
   * pure result-collector and the IPC handler can't trigger a race.
   */
  private async runTurn(state: CallState): Promise<void> {
    const { request } = state;
    let model: LanguageModel;
    try {
      model = this.buildModel(request.provider, request.model);
    } catch (err) {
      this.sendError(request.callId, AppAssistant.mapError(err));
      this.calls.delete(request.callId);
      return;
    }

    const tools = AppAssistant.buildToolSet(request.tools ?? []);

    let result;
    try {
      result = streamText({
        model,
        messages: state.messages,
        tools,
        abortSignal: state.abortController.signal,
        // We drive the loop externally; stop the SDK after the first model call.
        stopWhen: stepCountIs(1),
        // Honoured by both real providers; ignored by mock SDKs in tests.
        ...(request.maxOutputTokens !== undefined
          ? { maxOutputTokens: request.maxOutputTokens }
          : {}),
      });
    } catch (err) {
      this.sendError(request.callId, AppAssistant.mapError(err));
      this.calls.delete(request.callId);
      return;
    }

    let aborted = false;
    try {
      for await (const part of result.fullStream) {
        if (state.cancelled) {
          aborted = true;
          break;
        }
        switch (part.type) {
          case 'text-delta':
            this.sendChunk({ callId: request.callId, text: part.text });
            break;
          case 'tool-call': {
            state.pending.set(part.toolCallId, { toolName: part.toolName });
            this.sendToolCall({
              callId: request.callId,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              arguments: part.input,
            });
            break;
          }
          case 'abort':
            aborted = true;
            break;
          case 'error':
            this.sendError(request.callId, AppAssistant.mapError(part.error));
            this.calls.delete(request.callId);
            return;
          default:
            // text-start/end, reasoning-*, source, file, raw, start-step,
            // finish-step, start, finish, tool-input-* — ignored at this layer.
            break;
        }
      }

      if (aborted || state.cancelled) {
        // Cancellation is silent — the renderer knows it cancelled.
        this.calls.delete(request.callId);
        return;
      }

      // Append the assistant message (with any tool calls) to the
      // running history so the next turn has full context. This MUST
      // happen before we push the tool message — Anthropic rejects a
      // tool_result block that has no preceding tool_use.
      const responseMessages = (await result.response).messages;
      for (const m of responseMessages) {
        state.messages.push(m as ModelMessage);
      }

      if (state.pending.size > 0) {
        // Wait for every pending tool to have a result. If the renderer
        // was fast and they all arrived during the stream, this resolves
        // synchronously; otherwise we park here until `submitToolResult`
        // wakes us.
        if (state.toolResults.size < state.pending.size) {
          await new Promise<void>((resolve) => {
            state.toolWaiter = resolve;
          });
        }
        // The chat may have been cancelled while we awaited the user.
        if (state.cancelled) {
          this.calls.delete(request.callId);
          return;
        }
        // Append a tool message containing every result.
        const toolMessage: ModelMessage = {
          role: 'tool',
          content: Array.from(state.pending.entries()).map(
            ([toolCallId, p]) => ({
              type: 'tool-result',
              toolCallId,
              toolName: p.toolName,
              output: {
                type: 'json',
                value: state.toolResults.get(toolCallId) as never,
              },
            }),
          ),
        };
        state.messages.push(toolMessage);
        state.pending.clear();
        state.toolResults.clear();
        state.abortController = new AbortController();
        await this.runTurn(state);
        return;
      }

      const usage = await result.usage;
      const finishReason = await result.finishReason;
      this.sendDone({
        callId: request.callId,
        usage: {
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
        finishReason,
      });
      this.calls.delete(request.callId);
    } catch (err) {
      if (state.cancelled) {
        this.calls.delete(request.callId);
        return;
      }
      this.sendError(request.callId, AppAssistant.mapError(err));
      this.calls.delete(request.callId);
    }
  }

  /** Construct (or rebuild on-demand) the SDK client for a provider. */
  private buildModel(provider: ProviderId, modelId: string): LanguageModel {
    if (provider === 'ollama') {
      const cfg = AssistantConfig.load().ollama;
      return this.factories.ollama(cfg.baseUrl, modelId);
    }
    const apiProvider = provider as ApiProviderId;
    const key = AssistantKeyStore.getKey(apiProvider);
    if (!key) {
      throw new MissingKeyError(apiProvider);
    }
    return this.factories[apiProvider](key, modelId);
  }

  // ---- IPC senders --------------------------------------------------

  private sendChunk(payload: ChatChunkEvent): void {
    this.safeSend('from:ai:chunk', payload);
  }

  private sendToolCall(payload: ChatToolCallEvent): void {
    this.safeSend('from:ai:tool-call', payload);
  }

  private sendDone(payload: ChatDoneEvent): void {
    this.safeSend('from:ai:done', payload);
  }

  private sendError(callId: string, payload: Omit<ChatErrorEvent, 'callId'>): void {
    this.safeSend('from:ai:error', { callId, ...payload });
  }

  private sendOllamaModels(payload: OllamaModelsEvent): void {
    this.safeSend('from:ai:ollama:models', payload);
  }

  private safeSend(channel: string, payload: unknown): void {
    try {
      if (!this.context.isDestroyed()) {
        this.context.webContents.send(channel, payload);
      }
    } catch {
      // Window closed between checks; nothing to do.
    }
  }

  // ---- Conversions --------------------------------------------------

  /** Wire-message → SDK ModelMessage. v6's role taxonomy aligns 1:1. */
  private static toModelMessages(messages: ChatMessage[]): ModelMessage[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: m.toolCallId ?? '',
              toolName: m.toolName ?? '',
              output: { type: 'text', value: m.content },
            },
          ],
        } as ModelMessage;
      }
      return { role: m.role, content: m.content } as ModelMessage;
    });
  }

  /** ToolDescriptor[] → SDK ToolSet, with no execute (external loop). */
  private static buildToolSet(descriptors: ToolDescriptor[]): ToolSet {
    const set: Record<string, Tool> = {};
    for (const d of descriptors) {
      set[d.name] = tool({
        description: d.description,
        inputSchema: jsonSchema(d.parameters as Parameters<typeof jsonSchema>[0]),
        // No `execute` — the renderer drives execution externally.
      });
    }
    return set as ToolSet;
  }

  /** Coarse error → stable ChatErrorEvent. Refined in P4 with provider specifics. */
  private static mapError(err: unknown): Omit<ChatErrorEvent, 'callId'> {
    if (err instanceof MissingKeyError) {
      return { code: 'missing_key', message: `No key set for ${err.provider}` };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
      return { code: 'cancelled', message };
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
      return { code: 'network_error', message };
    }
    return { code: 'unknown', message };
  }
}

/** Thrown when a provider needs a key and none is stored. */
class MissingKeyError extends Error {
  constructor(public provider: ApiProviderId) {
    super(`No key set for ${provider}`);
    this.name = 'MissingKeyError';
  }
}
