import type { ChatRequest } from '../src/app/interfaces/Assistant';

const mockToken = jest.fn();
const mockGetKey = jest.fn(async () => 'separate-api-key');
let mockUsePlan = true;
let mockChangedAuth: () => void;
jest.mock('../src/app/lib/ChatGptAuth', () => ({
  ChatGptAuth: jest.fn().mockImplementation((_changed, stop) => {
    mockChangedAuth = stop;
    return {
      usesPlan: () => mockUsePlan,
      accessToken: mockToken,
      snapshot: () => ({}),
      loadModels: jest.fn(),
      dispose: jest.fn(),
    };
  }),
}));
jest.mock('../src/app/lib/AssistantConfig', () => ({
  AssistantConfig: {
    load: () => ({
      openai: {},
      anthropic: {},
      ollama: { baseUrl: 'http://localhost:11434' },
    }),
  },
}));
jest.mock('../src/app/lib/AssistantKeyStore', () => ({
  AssistantKeyStore: {
    getKey: mockGetKey,
    hasKey: async () => true,
    isEncryptionAvailable: async () => true,
  },
}));
jest.mock('ai', () => ({
  streamText: jest.fn(),
  tool: (value: unknown) => value,
  jsonSchema: (value: unknown) => value,
  isStepCount: () => ({}),
}));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));
jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: jest.fn() }));
jest.mock('ollama-ai-provider-v2', () => ({ createOllama: jest.fn() }));

import { streamText } from 'ai';
import { AppAssistant } from '../src/app/lib/AppAssistant';
import { ChatGptAuthError } from '../src/app/lib/ChatGptOAuth';

let assistant: AppAssistant;
let send: jest.Mock;
let plan: jest.Mock;
let api: jest.Mock;
const request = (): ChatRequest => ({
  callId: 'plan-call',
  provider: 'openai',
  model: 'gpt-plan',
  messages: [
    { role: 'system', content: 'Only shared context' },
    { role: 'user', content: 'Edit my document' },
  ],
  maxOutputTokens: 32,
  tools: [
    {
      name: 'edit_file',
      description: 'Edit',
      parameters: { type: 'object', properties: {} },
    },
  ],
});
const stream = (chunks: unknown[] = [], reason = 'stop') => ({
  stream: (async function* () {
    yield* chunks;
    if (reason === 'stop' || reason === 'tool-calls')
      yield { type: 'raw', rawValue: { type: 'response.completed' } };
  })(),
  responseMessages: Promise.resolve([]),
  usage: Promise.resolve({}),
  finishReason: Promise.resolve(reason),
});
async function drain() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePlan = true;
  mockToken.mockResolvedValue('subscription-token');
  send = jest.fn();
  plan = jest.fn(() => ({ id: 'subscription-model' }));
  api = jest.fn(() => ({ id: 'api-model' }));
  assistant = new AppAssistant(
    { isDestroyed: () => false, webContents: { send } } as never,
    { chatgpt: plan, openai: api, anthropic: api, ollama: api } as never,
  );
  jest.mocked(streamText).mockReturnValue(stream() as never);
});
afterEach(() => assistant.dispose());

test('uses the subscription token, developer context, stateless Responses options and namespaced tools', async () => {
  assistant.chat(request());
  await drain();
  expect(plan).toHaveBeenCalledWith('subscription-token', 'gpt-plan');
  expect(mockGetKey).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalled();
  const options = jest.mocked(streamText).mock.calls[0][0];
  expect(options).not.toHaveProperty('maxOutputTokens');
  expect(options.providerOptions).toEqual({
    openai: { store: false, systemMessageMode: 'developer' },
  });
  expect(options.instructions).toEqual([
    { role: 'system', content: 'Only shared context' },
  ]);
  expect(options.tools?.edit_file).toMatchObject({
    providerOptions: { openai: { namespace: { name: 'mkeditor' } } },
  });
  expect(send).toHaveBeenCalledWith(
    'from:ai:done',
    expect.objectContaining({ callId: 'plan-call' }),
  );
});

test('subscription authentication failure never falls back to an API key', async () => {
  mockToken.mockRejectedValue(new ChatGptAuthError('sign_in_required'));
  assistant.chat(request());
  await drain();
  expect(mockGetKey).not.toHaveBeenCalled();
  expect(api).not.toHaveBeenCalled();
  expect(streamText).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(
    'from:ai:error',
    expect.objectContaining({ code: 'chatgpt_auth' }),
  );
});

test('API-key mode continues to use the existing model factory and output cap', async () => {
  mockUsePlan = false;
  assistant.chat(request());
  await drain();
  expect(api).toHaveBeenCalledWith('separate-api-key', 'gpt-plan');
  expect(plan).not.toHaveBeenCalled();
  expect(jest.mocked(streamText).mock.calls[0][0].maxOutputTokens).toBe(32);
});

test('a usage-limit error after text starts is reported without successful completion', async () => {
  jest.mocked(streamText).mockReturnValue(
    stream([
      { type: 'text-delta', text: 'Partial' },
      {
        type: 'error',
        error: Object.assign(new Error('This app reached its usage limit'), {
          code: 'subscription_sharing_usage_limit_exceeded',
        }),
      },
    ]) as never,
  );
  assistant.chat(request());
  await drain();
  expect(send).toHaveBeenCalledWith(
    'from:ai:error',
    expect.objectContaining({ code: 'chatgpt_usage_limit' }),
  );
  expect(send.mock.calls.some(([channel]) => channel === 'from:ai:done')).toBe(
    false,
  );
});

test('an interrupted response cannot be reported as a completed turn', async () => {
  jest
    .mocked(streamText)
    .mockReturnValue(
      stream([{ type: 'text-delta', text: 'Partial' }], 'unknown') as never,
    );
  assistant.chat(request());
  await drain();
  expect(send.mock.calls.some(([channel]) => channel === 'from:ai:done')).toBe(
    false,
  );
  expect(send).toHaveBeenCalledWith('from:ai:error', expect.anything());
});

test('an incomplete subscription response cannot release document tools even when the SDK reports stop', async () => {
  const incomplete = stream();
  incomplete.stream = (async function* () {
    yield {
      type: 'tool-call',
      toolCallId: 'edit',
      toolName: 'edit_file',
      input: {},
    };
    yield { type: 'raw', rawValue: { type: 'response.incomplete' } };
  })();
  jest.mocked(streamText).mockReturnValue(incomplete as never);
  assistant.chat(request());
  await drain();
  expect(
    send.mock.calls.some(
      ([channel]) =>
        channel === 'from:ai:tool-call' || channel === 'from:ai:done',
    ),
  ).toBe(false);
  expect(send).toHaveBeenCalledWith('from:ai:error', expect.anything());
});

test('changing authentication cancels pending inference before credentials resolve', async () => {
  let finish!: (value: string) => void;
  mockToken.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  assistant.chat(request());
  mockChangedAuth();
  finish('subscription-token');
  await drain();
  expect(streamText).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(
    'from:ai:error',
    expect.objectContaining({ code: 'cancelled' }),
  );
});

test('tool results retain their namespace and call ordering across the next turn', async () => {
  jest
    .mocked(streamText)
    .mockReturnValueOnce(
      stream(
        [
          {
            type: 'tool-call',
            toolCallId: 'edit',
            toolName: 'edit_file',
            input: {},
          },
        ],
        'tool-calls',
      ) as never,
    )
    .mockReturnValueOnce(
      stream([{ type: 'text-delta', text: 'Done' }]) as never,
    );
  assistant.chat(request());
  await drain();
  expect(streamText).toHaveBeenCalledTimes(1);
  assistant.submitToolResult({
    callId: 'plan-call',
    toolCallId: 'edit',
    result: { ok: true },
  });
  await drain();
  expect(streamText).toHaveBeenCalledTimes(2);
  expect(
    jest.mocked(streamText).mock.calls[1][0].messages?.at(-1),
  ).toMatchObject({
    role: 'tool',
    content: [{ toolCallId: 'edit', toolName: 'edit_file' }],
  });
});
