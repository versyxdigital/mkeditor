import { buildChatHistory } from '../src/app/shared/assistantHistory';
import { AssistantManager } from '../src/browser/core/AssistantManager';
import type {
  ChatRequest,
  ProviderId,
  ToolInvocation,
  UiChatMessage,
} from '../src/app/interfaces/Assistant';
import type { ToolExecutor } from '../src/browser/core/AssistantTools';

const tool = (
  id: string,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation => ({
  toolCallId: id,
  toolName: 'create_file',
  arguments: { path: `/poems/${id}.md` },
  status: 'succeeded',
  result: { ok: true, path: `/poems/${id}.md` },
  ...overrides,
});

const message = (overrides: Partial<UiChatMessage> = {}): UiChatMessage => ({
  id: 'message',
  role: 'assistant',
  content: '',
  status: 'complete',
  createdAt: 1,
  ...overrides,
});

describe('assistant tool history', () => {
  it('keeps interleaved text and parallel tool calls/results in their original order', () => {
    const a = tool('a'),
      b = tool('b'),
      c = tool('c');
    const history = buildChatHistory([
      message({
        content: 'Planning. More work. Done.',
        toolCalls: [a, b, c],
        segments: [
          { type: 'text', text: 'Planning. ' },
          { type: 'tool-call', toolCallId: 'a' },
          { type: 'tool-call', toolCallId: 'b' },
          { type: 'text', text: 'More work. ' },
          { type: 'tool-call', toolCallId: 'c' },
          { type: 'text', text: 'Done.' },
        ],
      }),
    ]);
    expect(history).toEqual([
      {
        role: 'assistant',
        content: 'Planning. ',
        toolCalls: [a, b].map(({ toolCallId, toolName, arguments: args }) => ({
          toolCallId,
          toolName,
          arguments: args,
        })),
      },
      {
        role: 'tool',
        toolCallId: 'a',
        toolName: 'create_file',
        content: JSON.stringify(a.result),
      },
      {
        role: 'tool',
        toolCallId: 'b',
        toolName: 'create_file',
        content: JSON.stringify(b.result),
      },
      {
        role: 'assistant',
        content: 'More work. ',
        toolCalls: [
          { toolCallId: 'c', toolName: 'create_file', arguments: c.arguments },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'c',
        toolName: 'create_file',
        content: JSON.stringify(c.result),
      },
      { role: 'assistant', content: 'Done.' },
    ]);
  });

  it('retains tool-only replies from older histories without segment metadata', () => {
    const history = buildChatHistory([message({ toolCalls: [tool('a')] })]);
    expect(history).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            toolCallId: 'a',
            toolName: 'create_file',
            arguments: { path: '/poems/a.md' },
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'a',
        toolName: 'create_file',
        content: '{"ok":true,"path":"/poems/a.md"}',
      },
    ]);
  });

  it('reconstructs all resolved calls when old or incomplete segment metadata omits one', () => {
    const history = buildChatHistory([
      message({
        content: 'Done.',
        toolCalls: [tool('a'), tool('b')],
        segments: [
          { type: 'tool-call', toolCallId: 'a' },
          { type: 'text', text: 'Done.' },
        ],
      }),
    ]);
    expect(
      history.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
    ).toEqual(['a', 'b']);
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'Done.' });
  });

  it('does not replay a repeated segment twice or invent results for unresolved tools', () => {
    const history = buildChatHistory([
      message({
        toolCalls: [
          tool('a'),
          tool('b', { status: 'pending-confirm' }),
          tool('c', { status: 'executing' }),
        ],
        segments: [
          { type: 'tool-call', toolCallId: 'a' },
          { type: 'tool-call', toolCallId: 'a' },
          { type: 'tool-call', toolCallId: 'b' },
          { type: 'tool-call', toolCallId: 'unknown' },
        ],
      }),
    ]);
    expect(
      history.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
    ).toEqual(['a']);
  });

  it.each(['cancelled', 'failed'] as const)(
    'keeps resolved work from a %s turn without replaying its partial text',
    (status) => {
      const history = buildChatHistory([
        message({
          status,
          content: 'Unfinished reply',
          toolCalls: [tool('a')],
        }),
      ]);
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        content: '',
        toolCalls: [{ toolCallId: 'a' }],
      });
      expect(history[1]).toMatchObject({ role: 'tool', toolCallId: 'a' });
    },
  );

  it('reports rejected/failed calls as errors rather than claiming they succeeded', () => {
    const history = buildChatHistory([
      message({
        toolCalls: [
          tool('a', {
            status: 'failed',
            errorCode: 'rejected',
            errorMessage: 'User declined',
          }),
        ],
      }),
    ]);
    expect(JSON.parse(history[1].content)).toEqual({
      ok: false,
      error: 'rejected',
      message: 'User declined',
    });
    expect(history[1].content).not.toContain('"ok":true');
  });

  it('leaves ordinary text history unchanged and omits empty/streaming placeholders', () => {
    expect(
      buildChatHistory([
        message({ role: 'user', content: 'Hi' }),
        message({ content: 'Hello' }),
        message(),
        message({ status: 'streaming', content: 'Not finished' }),
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
  });
});

describe.each(['anthropic', 'openai', 'ollama'] as const)(
  '%s follow-up history',
  (provider) => {
    it.each([false, true])(
      'retains the folder and five files on the next request (reopened: %s)',
      async (reopened) => {
        const bridge = { send: jest.fn(), receive: jest.fn() };
        const manager = new AssistantManager(bridge, {
          disablePacedReveal: true,
        });
        const conversation = manager.createConversation(provider);
        manager.setAutoAcceptWrites(provider, conversation, true);
        const executor: ToolExecutor = {
          hasTool: () => true,

          describe: () => [],

          classify: () => 'write',

          buildPreview: () => null,

          getFullPreviewContent: async () => undefined,
          execute: jest.fn(async (_name, args) => ({
            ok: true,
            ...(args as object),
          })),
        };
        manager.setToolExecutor(executor);
        const call = manager.startCall(
          provider,
          conversation,
          'Create a folder with five poems',
        )!;
        manager.appendChunk(call, 'I will create them. ');
        for (let i = 0; i < 6; i++) {
          manager.onToolCall({
            callId: call,
            toolCallId: `tool-${i}`,
            toolName: i === 0 ? 'create_folder' : 'create_file',
            arguments: { path: i === 0 ? '/poems' : `/poems/${i}.md` },
          });
          await Promise.resolve();
          await Promise.resolve();
        }
        manager.appendChunk(call, 'All five poems are ready.');
        manager.onChatDone(call);
        let target = manager;
        if (reopened) {
          target = new AssistantManager(bridge, { disablePacedReveal: true });
          const saved = JSON.parse(JSON.stringify(manager.serialize()));
          expect(
            saved.conversations[provider][0].messages[1].segments,
          ).toHaveLength(8);
          target.restore(saved);
        }
        const followup = target.startCall(provider, conversation, 'Hi')!;
        const request = bridge.send.mock.calls
          .filter(([channel]) => channel === 'to:ai:chat')
          .at(-1)![1] as ChatRequest;
        const toolResults = request.messages.filter((m) => m.role === 'tool');
        expect(toolResults.map((m) => m.toolCallId)).toEqual([
          'tool-0',
          'tool-1',
          'tool-2',
          'tool-3',
          'tool-4',
          'tool-5',
        ]);
        expect(toolResults.map((m) => JSON.parse(m.content).path)).toEqual([
          '/poems',
          '/poems/1.md',
          '/poems/2.md',
          '/poems/3.md',
          '/poems/4.md',
          '/poems/5.md',
        ]);
        expect(request.messages.at(-1)).toEqual({
          role: 'user',
          content: 'Hi',
        });
        expect(executor.execute).toHaveBeenCalledTimes(6);
        target.onChatDone(followup);
        manager.flushPersist();
        target.flushPersist();
      },
    );
  },
);

it('saves already completed tool work as interrupted history when closing mid-response', async () => {
  const bridge = { send: jest.fn(), receive: jest.fn() };
  const source = new AssistantManager(bridge, { disablePacedReveal: true });
  const provider: ProviderId = 'anthropic';
  const conversation = source.createConversation(provider);
  source.setToolExecutor({
    hasTool: () => true,

    describe: () => [],

    classify: () => 'read',

    buildPreview: () => null,

    getFullPreviewContent: async () => undefined,

    execute: async () => ({ paths: ['/poems/1.md'] }),
  });
  const call = source.startCall(provider, conversation, 'List the poems')!;
  source.onToolCall({
    callId: call,
    toolCallId: 'list',
    toolName: 'list_files',
    arguments: {},
  });
  await Promise.resolve();
  await Promise.resolve();
  const saved = source.serialize()!;
  expect(saved.conversations.anthropic[0].messages[1]).toMatchObject({
    status: 'cancelled',
    toolCalls: [{ toolCallId: 'list', status: 'succeeded' }],
  });
  source.cancelCall(call);
  const target = new AssistantManager(bridge, { disablePacedReveal: true });
  target.restore(JSON.parse(JSON.stringify(saved)));
  const next = target.startCall(provider, conversation, 'What did you find?')!;
  const request = bridge.send.mock.calls
    .filter(([channel]) => channel === 'to:ai:chat')
    .at(-1)![1] as ChatRequest;
  expect(request.messages).toContainEqual({
    role: 'tool',
    toolCallId: 'list',
    toolName: 'list_files',
    content: '{"paths":["/poems/1.md"]}',
  });
  target.onChatDone(next);
  source.flushPersist();
  target.flushPersist();
});
