/**
 * AppAssistant unit tests.
 *
 * We mock `ai`'s `streamText` so each test can hand-craft the chunk
 * stream the SDK would emit. The provider model factories are injected
 * through the AppAssistant constructor, so we never construct real
 * `@ai-sdk/*` clients here.
 *
 * The `electron` mock (with `safeStorage` and `BrowserWindow.send`)
 * comes from `tests/__mocks__/electron.js`.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChatRequest } from '../src/app/interfaces/Assistant';
import { buildChatHistory } from '../src/app/shared/assistantHistory';

// Mock `ai` before importing AppAssistant so the import sees the mock.
// `tool` and `jsonSchema` are pass-through identities (we never need
// the real schema validation in these unit tests). `isStepCount` is
// a no-op factory returning a marker.
jest.mock('ai', () => ({
  streamText: jest.fn(),
  tool: (spec: unknown) => spec,
  jsonSchema: (schema: unknown) => schema,
  isStepCount: (n: number) => ({ kind: 'isStepCount', n }),
}));

// Mock the per-provider SDK adapters so importing them doesn't pull in
// real network code paths. We never actually call these in tests; they
// exist so AppAssistant's imports resolve.
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => () => ({ specificationVersion: 'v3' })),
}));
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => () => ({ specificationVersion: 'v3' })),
}));
jest.mock('ollama-ai-provider-v2', () => ({
  createOllama: jest.fn(() => () => ({ specificationVersion: 'v3' })),
}));

// Per-test handle to the active streamText mock. `jest.resetModules()`
// in beforeEach gives each test a fresh `ai` module — and therefore a
// fresh `streamText` jest.fn — so we re-grab it via `buildAssistant`.
let mockStreamText: jest.Mock;

type Chunk =
  | { type: 'text-delta'; id?: string; text: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | { type: 'error'; error: unknown }
  | { type: 'abort' }
  | { type: 'finish'; finishReason: string };

/**
 * Build a fake StreamTextResult that yields the given chunks in order
 * and exposes the responseMessages/usage/finishReason promises.
 */
function makeStreamResult(
  chunks: Chunk[],
  opts: {
    responseMessages?: Array<{ role: string; content: unknown }>;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    finishReason?: string;
  } = {},
) {
  return {
    stream: (async function* (): AsyncGenerator<Chunk> {
      for (const c of chunks) {
        await Promise.resolve();
        yield c;
      }
    })(),
    responseMessages: Promise.resolve(opts.responseMessages ?? []),
    usage: Promise.resolve(opts.usage ?? {}),
    finishReason: Promise.resolve(opts.finishReason ?? 'stop'),
  };
}

interface MockContext {
  webContents: { send: jest.Mock };
  isDestroyed: jest.Mock<boolean, []>;
}

function makeContext(): MockContext {
  return {
    webContents: { send: jest.fn() },
    isDestroyed: jest.fn<boolean, []>(() => false),
  };
}

/** Pluck the payload from the first webContents.send call matching the channel. */
function findSend<T = unknown>(
  ctx: MockContext,
  channel: string,
  nth = 0,
): T | undefined {
  const matches = ctx.webContents.send.mock.calls.filter(
    ([c]) => c === channel,
  );
  return matches[nth]?.[1] as T | undefined;
}

function countSends(ctx: MockContext, channel: string): number {
  return ctx.webContents.send.mock.calls.filter(([c]) => c === channel).length;
}

/**
 * Drain the async generator + the post-iteration response/usage awaits.
 * jsdom doesn't expose `setImmediate`, so we iterate microtasks
 * enough times to drain the longest plausible chain in these tests.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-appassistant-'));
  jest.resetModules();
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => tmpHome,
  }));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

function loadAppAssistant() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/app/lib/AppAssistant');
  return mod.AppAssistant as typeof import('../src/app/lib/AppAssistant').AppAssistant;
}

function buildAssistant(ctx: MockContext) {
  const AppAssistant = loadAppAssistant();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ai = require('ai') as { streamText: jest.Mock };
  mockStreamText = ai.streamText;
  const factories = {
    openai: jest.fn(() => ({ specificationVersion: 'v3' }) as never),
    anthropic: jest.fn(() => ({ specificationVersion: 'v3' }) as never),
    ollama: jest.fn(() => ({ specificationVersion: 'v3' }) as never),
  };
  const assistant = new AppAssistant(ctx as never, factories as never);
  return { assistant, factories };
}

async function seedKey(provider: 'anthropic' | 'openai', key: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AssistantKeyStore } = require('../src/app/lib/AssistantKeyStore');
  AssistantKeyStore._resetEncryptionCacheForTests();
  await AssistantKeyStore.setKey(provider, key);
}

const baseRequest = (
  callId: string,
  text = 'hello',
  provider: 'anthropic' | 'openai' | 'ollama' = 'anthropic',
): ChatRequest => ({
  callId,
  provider,
  model: provider === 'ollama' ? 'llama3.2' : 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: text }],
});

describe('AppAssistant.chat — streaming + callId fan-out', () => {
  it.each(['anthropic', 'openai', 'ollama'] as const)(
    'replays historical tool requests and outcomes as native SDK messages for %s',
    async (provider) => {
      const ctx = makeContext();
      const { assistant } = buildAssistant(ctx);
      if (provider !== 'ollama') await seedKey(provider, 'sk-test-history');
      mockStreamText.mockReturnValueOnce(
        makeStreamResult([], { finishReason: 'stop' }),
      );
      const messages = buildChatHistory([
        {
          id: 'u1',
          role: 'user',
          content: 'Create two poems',
          status: 'complete',
          createdAt: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'One file was created; the other was declined.',
          status: 'complete',
          createdAt: 2,
          toolCalls: [
            {
              toolCallId: 'created',
              toolName: 'create_file',
              arguments: { path: '/poems/one.md' },
              status: 'succeeded',
              result: { ok: true, path: '/poems/one.md' },
            },
            {
              toolCallId: 'declined',
              toolName: 'create_file',
              arguments: { path: '/poems/two.md' },
              status: 'failed',
              errorCode: 'rejected',
            },
          ],
        },
        {
          id: 'u2',
          role: 'user',
          content: 'What did you create?',
          status: 'complete',
          createdAt: 3,
        },
      ]);
      assistant.chat({
        ...baseRequest('recall', 'unused', provider),
        messages,
      });
      await flush();
      expect(mockStreamText.mock.calls[0][0].messages).toEqual([
        { role: 'user', content: 'Create two poems' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'created',
              toolName: 'create_file',
              input: { path: '/poems/one.md' },
            },
            {
              type: 'tool-call',
              toolCallId: 'declined',
              toolName: 'create_file',
              input: { path: '/poems/two.md' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'created',
              toolName: 'create_file',
              output: {
                type: 'text',
                value: '{"ok":true,"path":"/poems/one.md"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'declined',
              toolName: 'create_file',
              output: {
                type: 'text',
                value: '{"ok":false,"error":"rejected"}',
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: 'One file was created; the other was declined.',
        },
        { role: 'user', content: 'What did you create?' },
      ]);
      expect(countSends(ctx, 'from:ai:tool-call')).toBe(0);
    },
  );

  it.each([
    [
      'anthropic',
      'claude-sonnet-5-5',
      'high',
      { anthropic: { thinking: { type: 'adaptive' }, effort: 'high' } },
    ],
    ['openai', 'gpt-6.2-sol', 'max', { openai: { reasoningEffort: 'max' } }],
    ['openai', 'gpt-5', 'minimal', { openai: { reasoningEffort: 'minimal' } }],
    ['openai', 'gpt-5.5', 'none', { openai: { reasoningEffort: 'none' } }],
    ['openai', 'gpt-6.2-astra', 'none', undefined],
    ['openai', 'gpt-4.1', 'high', undefined],
    ['anthropic', 'custom-model', 'high', undefined],
    ['anthropic', 'claude-sonnet-5-5', 'auto', undefined],
    ['anthropic', 'claude-sonnet-5-5', 'invalid', undefined],
  ] as const)(
    'applies compatible thinking options for %s / %s / %s',
    async (provider, model, thinkingLevel, expected) => {
      const ctx = makeContext();
      const { assistant } = buildAssistant(ctx);
      await seedKey(provider, 'sk-test');
      mockStreamText.mockReturnValueOnce(makeStreamResult([]));
      assistant.chat({
        ...baseRequest('thinking', 'hello', provider),
        model,
        thinkingLevel: thinkingLevel as ChatRequest['thinkingLevel'],
      });
      await flush();
      expect(mockStreamText.mock.calls[0][0].providerOptions).toEqual(expected);
    },
  );

  it('aborts every upstream call when its owning window is disposed', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockStreamText.mockImplementation(() => ({
      ...makeStreamResult([]),
      stream: (async function* () {
        await gate;
      })(),
    }));
    assistant.chat(baseRequest('one'));
    assistant.chat(baseRequest('two'));
    await flush();
    const signals = mockStreamText.mock.calls.map(
      ([options]) => options.abortSignal,
    );
    assistant.dispose();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(assistant.cancel('one')).toBe(false);
    expect(assistant.cancel('two')).toBe(false);
    release();
    await flush();
  });
  it('forwards text-delta chunks as from:ai:chunk tagged with the callId', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'world' },
      ]),
    );

    assistant.chat(baseRequest('call-1'));
    // Flush the async generator + the post-iteration response/usage awaits.
    await flush();

    expect(countSends(ctx, 'from:ai:chunk')).toBe(2);
    expect(findSend(ctx, 'from:ai:chunk', 0)).toEqual({
      callId: 'call-1',
      text: 'Hello ',
    });
    expect(findSend(ctx, 'from:ai:chunk', 1)).toEqual({
      callId: 'call-1',
      text: 'world',
    });
    expect(findSend(ctx, 'from:ai:done')).toEqual(
      expect.objectContaining({ callId: 'call-1' }),
    );
  });

  it('keeps concurrent calls isolated by callId', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-a');
    await seedKey('openai', 'sk-b');

    mockStreamText
      .mockReturnValueOnce(
        makeStreamResult([{ type: 'text-delta', text: 'A-1' }]),
      )
      .mockReturnValueOnce(
        makeStreamResult([{ type: 'text-delta', text: 'B-1' }]),
      );

    assistant.chat(baseRequest('call-A', 'hi', 'anthropic'));
    assistant.chat(baseRequest('call-B', 'hi', 'openai'));
    await flush();

    const chunks = ctx.webContents.send.mock.calls
      .filter(([c]) => c === 'from:ai:chunk')
      .map(([, p]) => p as { callId: string; text: string });

    // Each call's chunk is tagged with its own id; no crossover.
    expect(chunks.find((p) => p.callId === 'call-A')?.text).toBe('A-1');
    expect(chunks.find((p) => p.callId === 'call-B')?.text).toBe('B-1');
    expect(chunks.filter((p) => p.callId === 'call-A')).toHaveLength(1);
    expect(chunks.filter((p) => p.callId === 'call-B')).toHaveLength(1);
  });

  it('emits from:ai:done with usage + finishReason on natural completion', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'ok' }], {
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        finishReason: 'stop',
      }),
    );

    assistant.chat(baseRequest('call-done'));
    await flush();

    expect(findSend(ctx, 'from:ai:done')).toEqual({
      callId: 'call-done',
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
      finishReason: 'stop',
    });
  });

  it('forwards maxOutputTokens to streamText when the request sets it (AI Assistant P3 connection-test path)', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'pong' }]),
    );

    assistant.chat({ ...baseRequest('call-ping'), maxOutputTokens: 1 });
    await flush();

    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const args = mockStreamText.mock.calls[0][0] as {
      maxOutputTokens?: number;
    };
    expect(args.maxOutputTokens).toBe(1);
  });

  it('omits maxOutputTokens from streamText when the request leaves it unset (chat path)', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'ok' }]),
    );

    assistant.chat(baseRequest('call-no-cap'));
    await flush();

    const args = mockStreamText.mock.calls[0][0] as {
      maxOutputTokens?: number;
    };
    expect(args.maxOutputTokens).toBeUndefined();
  });

  it('sends system turns as instructions rather than inside messages', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'ok' }]),
    );

    assistant.chat({
      ...baseRequest('call-ctx'),
      messages: [
        { role: 'system', content: 'context here' },
        { role: 'user', content: 'hello' },
      ],
    });
    await flush();

    const args = mockStreamText.mock.calls[0][0] as {
      instructions?: unknown;
      messages: Array<{ role: string }>;
    };
    expect(args.instructions).toEqual([
      { role: 'system', content: 'context here' },
    ]);
    expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('omits instructions when the request has no system turn', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'ok' }]),
    );

    assistant.chat(baseRequest('call-no-ctx'));
    await flush();

    const args = mockStreamText.mock.calls[0][0] as { instructions?: unknown };
    expect(args).not.toHaveProperty('instructions');
  });
});

describe('AppAssistant.cancel', () => {
  it('aborts the AbortController and stops further chunks for that callId', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    let capturedAbort: AbortSignal | undefined;
    mockStreamText.mockImplementationOnce(
      ({ abortSignal }: { abortSignal: AbortSignal }) => {
        capturedAbort = abortSignal;
        // A stream that pauses indefinitely after the first chunk until aborted.
        return {
          stream: (async function* () {
            yield { type: 'text-delta', text: 'first' };
            // Wait for abort. The for-await loop in AppAssistant breaks on
            // `state.cancelled`, but this also exercises that we don't keep
            // sending chunks after cancel.
            await new Promise<void>((resolve) => {
              abortSignal.addEventListener('abort', () => resolve());
            });
          })(),
          responseMessages: Promise.resolve([]),
          usage: Promise.resolve({}),
          finishReason: Promise.resolve('stop'),
        };
      },
    );

    assistant.chat(baseRequest('call-cancel'));
    await flush();

    expect(countSends(ctx, 'from:ai:chunk')).toBe(1);

    const cancelled = assistant.cancel('call-cancel');
    expect(cancelled).toBe(true);
    expect(capturedAbort?.aborted).toBe(true);

    await flush();

    // No further chunks fired after cancel; no done event either
    // (cancellation is silent per the plan).
    expect(countSends(ctx, 'from:ai:chunk')).toBe(1);
    expect(countSends(ctx, 'from:ai:done')).toBe(0);
    expect(countSends(ctx, 'from:ai:error')).toBe(0);
  });

  it('returns false when cancelling a callId that does not exist', () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    expect(assistant.cancel('nope')).toBe(false);
  });
});

describe('AppAssistant.chat — error mapping', () => {
  it('emits from:ai:error with code "missing_key" when no key is set', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    assistant.chat(baseRequest('call-no-key'));
    await flush();

    const err = findSend(ctx, 'from:ai:error') as
      { callId: string; code: string; message: string } | undefined;
    expect(err?.code).toBe('missing_key');
    expect(err?.callId).toBe('call-no-key');
    // No chunks before the error.
    expect(countSends(ctx, 'from:ai:chunk')).toBe(0);
  });

  it('emits from:ai:error when streamText emits a {type:"error"} chunk', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([
        { type: 'text-delta', text: 'before' },
        { type: 'error', error: new Error('upstream blew up') },
      ]),
    );

    assistant.chat(baseRequest('call-err'));
    await flush();

    const err = findSend(ctx, 'from:ai:error') as
      { callId: string; code: string; message: string } | undefined;
    expect(err?.callId).toBe('call-err');
    expect(err?.code).toBe('unknown');
    expect(err?.message).toContain('upstream blew up');
  });

  it('maps network-flavoured errors to "network_error"', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    mockStreamText.mockImplementationOnce(() => {
      throw new Error('ECONNREFUSED 127.0.0.1:443');
    });

    assistant.chat(baseRequest('call-net'));
    await flush();

    expect(findSend(ctx, 'from:ai:error')).toEqual(
      expect.objectContaining({ callId: 'call-net', code: 'network_error' }),
    );
  });

  // P8 — mapError extension. Each new code gets one representative
  // pattern; the regexes inside `mapError` cover the rest.
  it.each<[string, string, string]>([
    ['invalid_key', 'invalid-key-1', 'HTTP 401 Unauthorized: invalid api key'],
    ['rate_limited', 'rate-1', 'HTTP 429: Too Many Requests'],
    [
      'context_window_exceeded',
      'ctx-1',
      'Error: context length exceeded — too many tokens for this model',
    ],
    [
      'context_window_exceeded',
      'ctx-ollama',
      'the prompt is longer than the context length currently available to the model; shorten the prompt, adjust the context length in settings, or use a model with a longer context length',
    ],
    [
      'ollama_unreachable',
      'ollama-1',
      'ollama request to http://localhost:11434/api/chat failed: ECONNREFUSED',
    ],
  ])(
    'maps %s when streamText throws with a matching message',
    async (code, callId, message) => {
      const ctx = makeContext();
      const { assistant } = buildAssistant(ctx);
      // For ollama_unreachable, the request needs to target ollama.
      await seedKey('anthropic', 'sk-x');
      await seedKey('openai', 'sk-x');

      mockStreamText.mockImplementationOnce(() => {
        throw new Error(message);
      });

      const req =
        code === 'ollama_unreachable'
          ? baseRequest(callId, 'hello', 'ollama')
          : baseRequest(callId);
      assistant.chat(req);
      await flush();

      expect(findSend(ctx, 'from:ai:error')).toEqual(
        expect.objectContaining({ callId, code }),
      );
    },
  );

  it('maps an Ollama 400 "does not support tools" APICallError to model_unsupported_tools', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    // Shape mirrors what `ollama-ai-provider-v2` throws — a Vercel
    // AI SDK `APICallError` with `name === 'AI_APICallError'`,
    // statusCode, and a JSON responseBody that wraps the upstream
    // error string under `{ error: "…" }`.
    const apiErr = Object.assign(new Error('Bad Request'), {
      name: 'AI_APICallError',
      statusCode: 400,
      responseBody: JSON.stringify({
        error: 'registry.ollama.ai/library/gemma3:4b does not support tools',
      }),
    });
    mockStreamText.mockImplementationOnce(() => {
      throw apiErr;
    });

    assistant.chat(baseRequest('oll-no-tools', 'hi', 'ollama'));
    await flush();

    expect(findSend(ctx, 'from:ai:error')).toEqual(
      expect.objectContaining({
        callId: 'oll-no-tools',
        code: 'model_unsupported_tools',
        // The inner Ollama message is preferred over the SDK's
        // top-level "Bad Request" so the renderer's `errorMessage`
        // field carries debuggable detail.
        message: expect.stringContaining('does not support tools'),
      }),
    );
  });

  it('surfaces upstream `{ error: "…" }` from APICallError.responseBody on a generic failure', async () => {
    // Even when the code falls through to `unknown`, the parsed
    // upstream message should replace the bare "Bad Request" so
    // the failed-bubble detail in the chat tells the user what
    // actually went wrong.
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    const apiErr = Object.assign(new Error('Bad Request'), {
      name: 'AI_APICallError',
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { message: 'unhandled provider quirk' },
      }),
    });
    mockStreamText.mockImplementationOnce(() => {
      throw apiErr;
    });

    assistant.chat(baseRequest('call-unwrap'));
    await flush();

    expect(findSend(ctx, 'from:ai:error')).toEqual(
      expect.objectContaining({
        callId: 'call-unwrap',
        code: 'unknown',
        message: 'unhandled provider quirk',
      }),
    );
  });
});

describe('AppAssistant — tool-call → tool-result loop', () => {
  it('keeps the configured Ollama context allocation through tool-result continuation', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AssistantConfig } = require('../src/app/lib/AssistantConfig');
    AssistantConfig.update({
      provider: 'ollama',
      config: { contextLength: 32768 },
    });
    mockStreamText.mockReturnValueOnce(
      makeStreamResult(
        [
          {
            type: 'tool-call',
            toolCallId: 'read-ctx',
            toolName: 'get_active_file',
            input: {},
          },
        ],
        {
          responseMessages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'read-ctx',
                  toolName: 'get_active_file',
                  input: {},
                },
              ],
            },
          ],
        },
      ),
    );
    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'Read successfully.' }]),
    );
    assistant.chat(baseRequest('ctx-loop', 'Read the active file', 'ollama'));
    await flush();
    AssistantConfig.update({
      provider: 'ollama',
      config: { contextLength: 8192 },
    });
    assistant.submitToolResult({
      callId: 'ctx-loop',
      toolCallId: 'read-ctx',
      result: { content: 'x'.repeat(8000) },
    });
    await flush();
    expect(mockStreamText).toHaveBeenCalledTimes(2);
    for (const [options] of mockStreamText.mock.calls) {
      expect(options.providerOptions).toEqual({
        ollama: { options: { num_ctx: 32768 } },
      });
    }
    expect(findSend(ctx, 'from:ai:done')).toBeDefined();
  });

  it.each([undefined, 0])(
    'leaves the Ollama allocation to the daemon for context size %s',
    async (contextLength) => {
      const ctx = makeContext();
      const { assistant } = buildAssistant(ctx);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AssistantConfig } = require('../src/app/lib/AssistantConfig');
      AssistantConfig.update({ provider: 'ollama', config: { contextLength } });
      mockStreamText.mockReturnValueOnce(makeStreamResult([]));
      assistant.chat(baseRequest('ctx-default', 'hello', 'ollama'));
      await flush();
      expect(mockStreamText.mock.calls[0][0].providerOptions).toBeUndefined();
    },
  );

  it('forwards tool calls, accepts a tool result, and re-invokes streamText', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    // Turn 1: model emits a tool-call then ends.
    mockStreamText.mockReturnValueOnce(
      makeStreamResult(
        [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            input: { path: 'README.md' },
          },
        ],
        {
          responseMessages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'tc-1',
                  toolName: 'read_file',
                  input: { path: 'README.md' },
                },
              ],
            },
          ],
          finishReason: 'tool-calls',
        },
      ),
    );

    // Turn 2: after tool-result is fed, the model emits a final answer.
    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'Got it!' }]),
    );

    assistant.chat({
      ...baseRequest('call-tool'),
      tools: [
        {
          name: 'read_file',
          description: 'Reads a file',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    await flush();

    const toolCall = findSend(ctx, 'from:ai:tool-call') as
      | {
          callId: string;
          toolCallId: string;
          toolName: string;
          arguments: unknown;
        }
      | undefined;
    expect(toolCall).toEqual({
      callId: 'call-tool',
      toolCallId: 'tc-1',
      toolName: 'read_file',
      arguments: { path: 'README.md' },
    });

    // No done event yet — we're waiting for the tool result.
    expect(countSends(ctx, 'from:ai:done')).toBe(0);
    expect(mockStreamText).toHaveBeenCalledTimes(1);

    assistant.submitToolResult({
      callId: 'call-tool',
      toolCallId: 'tc-1',
      result: { content: 'README body', lineCount: 42 },
    });
    await flush();

    expect(mockStreamText).toHaveBeenCalledTimes(2);
    // The second streamText call's messages include the tool result.
    const secondCallArgs = mockStreamText.mock.calls[1][0] as {
      messages: Array<{ role: string }>;
    };
    expect(secondCallArgs.messages.some((m) => m.role === 'tool')).toBe(true);

    expect(findSend(ctx, 'from:ai:chunk')).toEqual({
      callId: 'call-tool',
      text: 'Got it!',
    });
    expect(findSend(ctx, 'from:ai:done')).toEqual(
      expect.objectContaining({ callId: 'call-tool' }),
    );
  });

  it('next turn carries assistant + tool messages in order, even when the tool result arrives mid-stream (regression)', async () => {
    // Race regression: previously `submitToolResult` fired the next
    // streamText turn synchronously, which could happen BEFORE the
    // current turn's `for await` loop finished consuming the stream
    // and pushed the assistant message. Anthropic then saw
    // `[user, tool]`, collapsed them into one user message with a
    // stray tool_result block, and rejected with a 400 ("tool_use_id
    // has no matching tool_use").
    //
    // Repro: yield the tool-call event from the stream and call
    // `submitToolResult` BEFORE flushing the rest of the stream.
    // The fix gates the next turn on (a) the assistant message being
    // pushed AND (b) all tool results landing — so the second
    // streamText call's `messages` must contain the assistant message.
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    // Turn 1: tool-call. We yield via a hand-rolled async iterator
    // so the test can wedge `submitToolResult` between the tool-call
    // yield and the stream's completion.
    let resolveResponse!: (v: unknown[]) => void;
    const responsePromise = new Promise<unknown[]>((res) => {
      resolveResponse = res;
    });
    let releaseStream!: () => void;
    const streamRelease = new Promise<void>((res) => {
      releaseStream = res;
    });

    const turn1Stream = {
      stream: (async function* () {
        // Emit the tool-call immediately.
        yield {
          type: 'tool-call' as const,
          toolCallId: 'tc-race',
          toolName: 'get_active_file',
          input: {},
        };
        // ...then hold the stream open until the test releases it.
        await streamRelease;
      })(),
      responseMessages: responsePromise,
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('tool-calls'),
    };
    mockStreamText.mockReturnValueOnce(turn1Stream);

    // Turn 2: model emits a final answer.
    mockStreamText.mockReturnValueOnce(
      makeStreamResult([{ type: 'text-delta', text: 'Edits applied.' }]),
    );

    assistant.chat({
      ...baseRequest('call-race'),
      thinkingLevel: 'high',
      tools: [
        {
          name: 'get_active_file',
          description: 'Returns the active file',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    // Drain the iterator far enough to deliver the tool-call event
    // (but not the stream's natural end — that needs `releaseStream`).
    await flush();
    // Tool-call event delivered to the renderer.
    expect(findSend(ctx, 'from:ai:tool-call')).toEqual(
      expect.objectContaining({ toolCallId: 'tc-race' }),
    );

    // RACE: submit the tool result BEFORE the stream finishes / the
    // response.messages resolves. Under the old bug this would
    // immediately fire turn 2 with `[user, tool]`. Under the fix it
    // buffers the result and waits for runTurn to wake it.
    assistant.submitToolResult({
      callId: 'call-race',
      toolCallId: 'tc-race',
      result: { path: 'README.md', content: 'body', lineCount: 1 },
    });
    await flush();

    // Turn 2 should NOT have fired yet — the stream is still parked.
    expect(mockStreamText).toHaveBeenCalledTimes(1);

    // Now release the stream and resolve the response.
    releaseStream();
    resolveResponse([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-race',
            toolName: 'get_active_file',
            input: {},
          },
        ],
      },
    ]);
    await flush();

    // Turn 2 fired exactly once, and its messages include the
    // assistant message (with tool_use) BEFORE the tool message.
    expect(mockStreamText).toHaveBeenCalledTimes(2);
    expect(mockStreamText.mock.calls[1][0].providerOptions).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'high' },
    });
    const turn2Args = mockStreamText.mock.calls[1][0] as {
      messages: Array<{ role: string }>;
    };
    const roles = turn2Args.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool']);
  });

  it('cancel() during a parked tool wait wakes the runTurn promise and does not leak', async () => {
    // Companion to the race fix above: if the user cancels while
    // runTurn is parked waiting for tool results, the awaiting
    // Promise must resolve (not leak forever) and the call should
    // be cleaned out of `calls`.
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');

    // A stream that emits a tool-call then ends.
    mockStreamText.mockReturnValueOnce(
      makeStreamResult(
        [
          {
            type: 'tool-call',
            toolCallId: 'tc-cancel',
            toolName: 'get_active_file',
            input: {},
          },
        ],
        {
          responseMessages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'tc-cancel',
                  toolName: 'get_active_file',
                  input: {},
                },
              ],
            },
          ],
          finishReason: 'tool-calls',
        },
      ),
    );

    assistant.chat({
      ...baseRequest('call-cancel'),
      tools: [
        {
          name: 'get_active_file',
          description: 'Returns the active file',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    await flush();

    // runTurn is now parked awaiting the (never-arriving) tool result.
    // Cancel; the awaiting promise should resolve, the call entry
    // should be deleted, and no second streamText should fire.
    expect(assistant.cancel('call-cancel')).toBe(true);
    await flush();
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('ignores submitToolResult for unknown callIds', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    expect(() =>
      assistant.submitToolResult({
        callId: 'nope',
        toolCallId: 'x',
        result: null,
      }),
    ).not.toThrow();
    expect(mockStreamText).not.toHaveBeenCalled();
  });
});

describe('AppAssistant.buildSanitizedConfig', () => {
  it('reports hasKey:true for stored providers and never includes the key value', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-anthropic-secret');

    const payload = await assistant.buildSanitizedConfig();
    expect(payload.config.anthropic.hasKey).toBe(true);
    expect(payload.config.openai.hasKey).toBe(false);
    expect(payload.config.ollama.hasKey).toBe(false);
    expect(payload.encryptionAvailable).toBe(true);

    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('sk-anthropic-secret');
    // Defense in depth: the sanitized type carries no field literally
    // named `key` / `apiKey` / `secret`, so even if a future refactor
    // accidentally added one, this regex would catch it before a key
    // value leaked to the renderer.
    expect(serialised).not.toMatch(/"(api)?[Kk]ey"\s*:\s*"/);
    expect(serialised).not.toMatch(/"secret"\s*:/);
  });

  it('reports hasKey:false on every provider when encryption is unavailable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      safeStorage: { isAsyncEncryptionAvailable: jest.Mock };
    };
    electron.safeStorage.isAsyncEncryptionAvailable.mockReturnValue(false);

    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    const payload = await assistant.buildSanitizedConfig();
    expect(payload.encryptionAvailable).toBe(false);
    expect(payload.config.anthropic.hasKey).toBe(false);
    expect(payload.config.openai.hasKey).toBe(false);
  });
});

describe('AppAssistant.chat — Ollama baseURL normalisation', () => {
  // Regression: `ollama-ai-provider-v2` builds chat URLs as
  // `${baseURL}/chat`, so the baseURL must end at `/api`. The Daemon
  // URL the user pastes into Settings is the host root
  // (`http://localhost:11434`) — `buildModel` must canonicalise to
  // `http://localhost:11434/api` or chat 404s with "Not Found".
  it.each<[string, string]>([
    ['http://localhost:11434', 'http://localhost:11434/api'],
    ['http://localhost:11434/', 'http://localhost:11434/api'],
    ['http://localhost:11434/api', 'http://localhost:11434/api'],
    ['http://localhost:11434/api/', 'http://localhost:11434/api'],
  ])(
    'normalises Daemon URL %s → %s before handing to ollama-ai-provider-v2',
    async (input, expected) => {
      const ctx = makeContext();
      const { assistant, factories } = buildAssistant(ctx);
      // Seed the on-disk config with the user-supplied Daemon URL.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AssistantConfig } = require('../src/app/lib/AssistantConfig');
      AssistantConfig.update({
        provider: 'ollama',
        config: { enabled: true, model: 'llama3.2', baseUrl: input },
      });

      mockStreamText.mockReturnValueOnce(makeStreamResult([]));
      assistant.chat(baseRequest('oll-norm', 'hello', 'ollama'));
      await flush();

      expect(factories.ollama).toHaveBeenCalledWith(expected, 'llama3.2');
    },
  );
});

describe('AppAssistant.listOllamaModels', () => {
  it('sends from:ai:ollama:models with the model list on success', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    const origFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2' }, { name: 'qwen2.5' }],
      }),
    } as never);

    await assistant.listOllamaModels({
      callId: 'oll-1',
      baseUrl: 'http://localhost:11434',
    });

    expect(findSend(ctx, 'from:ai:ollama:models')).toEqual({
      callId: 'oll-1',
      models: ['llama3.2', 'qwen2.5'],
    });
    (globalThis as unknown as { fetch: typeof origFetch }).fetch = origFetch;
  });

  it('sends from:ai:ollama:models with an error on non-OK response', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    const origFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 } as never);

    await assistant.listOllamaModels({
      callId: 'oll-2',
      baseUrl: 'http://localhost:11434',
    });

    const payload = findSend(ctx, 'from:ai:ollama:models') as
      { callId: string; error?: string; models?: string[] } | undefined;
    expect(payload?.callId).toBe('oll-2');
    expect(payload?.error).toContain('502');
    expect(payload?.models).toBeUndefined();
    (globalThis as unknown as { fetch: typeof origFetch }).fetch = origFetch;
  });

  it('sends from:ai:ollama:models with an error when the network throws', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);

    const origFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await assistant.listOllamaModels({
      callId: 'oll-3',
      baseUrl: 'http://localhost:11434',
    });

    expect(findSend(ctx, 'from:ai:ollama:models')).toEqual({
      callId: 'oll-3',
      error: 'ECONNREFUSED',
    });
    (globalThis as unknown as { fetch: typeof origFetch }).fetch = origFetch;
  });
});

describe('AppAssistant cancellation race regressions', () => {
  it('never starts a stream after cancellation while OS decryption is pending', async () => {
    const context = makeContext();
    const { assistant } = buildAssistant(context);
    await seedKey('anthropic', 'sk-test');
    const { safeStorage } = jest.requireActual('electron');
    let release!: (value: { result: string; shouldReEncrypt: boolean }) => void;
    let started!: () => void;
    const entering = new Promise<void>((resolve) => {
      started = resolve;
    });
    safeStorage.decryptStringAsync.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    assistant.chat(baseRequest('decrypt-pending'));
    await entering;
    expect(assistant.cancel('decrypt-pending')).toBe(true);
    release({ result: 'sk-test', shouldReEncrypt: false });
    await flush();
    expect(mockStreamText).not.toHaveBeenCalled();
    expect(countSends(context, 'from:ai:error')).toBe(0);
    expect(countSends(context, 'from:ai:chunk')).toBe(0);
  });
  it('does not send completion after cancellation during response-message resolution', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');
    let finish!: (messages: unknown[]) => void;
    mockStreamText.mockReturnValueOnce({
      ...makeStreamResult([]),
      responseMessages: new Promise((resolve) => {
        finish = resolve;
      }),
    });
    assistant.chat(baseRequest('await-response'));
    await flush();
    expect(assistant.cancel('await-response')).toBe(true);
    finish([]);
    await flush();
    expect(countSends(ctx, 'from:ai:done')).toBe(0);
    expect(countSends(ctx, 'from:ai:error')).toBe(0);
  });

  it('does not send completion after cancellation while usage is resolving', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');
    let finish!: (usage: unknown) => void;
    mockStreamText.mockReturnValueOnce({
      ...makeStreamResult([]),
      usage: new Promise((resolve) => {
        finish = resolve;
      }),
    });
    assistant.chat(baseRequest('await-usage'));
    await flush();
    expect(assistant.cancel('await-usage')).toBe(true);
    finish({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    await flush();
    expect(countSends(ctx, 'from:ai:done')).toBe(0);
  });

  it('keeps a replacement call registered when the cancelled stream finishes late', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const newGate = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    mockStreamText
      .mockReturnValueOnce({
        ...makeStreamResult([]),
        stream: (async function* () {
          await oldGate;
          yield { type: 'text-delta', text: 'stale' };
        })(),
      })
      .mockReturnValueOnce({
        ...makeStreamResult([]),
        stream: (async function* () {
          await newGate;
          yield { type: 'text-delta', text: 'new' };
        })(),
      });
    assistant.chat(baseRequest('reused-id'));
    await flush();
    assistant.chat(baseRequest('reused-id', 'replacement'));
    releaseOld();
    await flush();
    expect(countSends(ctx, 'from:ai:chunk')).toBe(0);
    expect(assistant.cancel('reused-id')).toBe(true);
    releaseNew();
    await flush();
    expect(countSends(ctx, 'from:ai:chunk')).toBe(0);
    expect(countSends(ctx, 'from:ai:done')).toBe(0);
  });

  it('maps malformed tool metadata to an error instead of leaking an unhandled rejection', async () => {
    const ctx = makeContext();
    const { assistant } = buildAssistant(ctx);
    await seedKey('anthropic', 'sk-x');
    assistant.chat({ ...baseRequest('bad-tools'), tools: [null as never] });
    await flush();
    expect(countSends(ctx, 'from:ai:error')).toBe(1);
    expect(assistant.cancel('bad-tools')).toBe(false);
  });
});
