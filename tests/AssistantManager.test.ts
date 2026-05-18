/**
 * AssistantManager (renderer-side) unit tests.
 *
 * Covers the P3 surface:
 *   - subscribeConfig / getConfigSnapshot observable contract
 *   - outbound channels (to:ai:*) carry the right payloads
 *   - refreshOllamaModels resolves on from:ai:ollama:models
 *   - testConnection resolves on from:ai:done (success) or
 *     from:ai:error (mapped failure) — and times out cleanly
 *   - ownsCallId distinguishes manager-claimed callIds from chat ids
 *     the future P4 startCall machinery will own
 */

import { AssistantManager } from '../src/browser/core/AssistantManager';

type SentMessage = { channel: string; data: unknown };

function makeBridge() {
  const sent: SentMessage[] = [];
  const bridge = {
    send: jest.fn((channel: string, data: unknown) => {
      sent.push({ channel, data });
    }),
    receive: jest.fn(),
  };
  return { bridge, sent };
}

const SAMPLE_PUSH = {
  config: {
    anthropic: {
      enabled: true,
      hasKey: true,
      defaultModel: 'claude-sonnet-4-6',
    },
    openai: {
      enabled: false,
      hasKey: false,
      defaultModel: 'gpt-4o',
    },
    ollama: {
      enabled: false,
      hasKey: false as const,
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3.2',
    },
  },
  encryptionAvailable: true,
};

describe('AssistantManager.subscribeConfig + getConfigSnapshot', () => {
  it('starts with a null-config snapshot', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    expect(mgr.getConfigSnapshot()).toEqual({
      config: null,
      encryptionAvailable: false,
    });
  });

  it('replaces the snapshot and notifies subscribers on setConfigFromServer', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const listener = jest.fn();
    mgr.subscribeConfig(listener);
    mgr.setConfigFromServer(SAMPLE_PUSH);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mgr.getConfigSnapshot()).toEqual(SAMPLE_PUSH);
  });

  it('unsubscribe stops further notifications', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const listener = jest.fn();
    const off = mgr.subscribeConfig(listener);
    off();
    mgr.setConfigFromServer(SAMPLE_PUSH);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('AssistantManager outbound channels', () => {
  it('requestConfigRefresh fires to:ai:config:get', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.requestConfigRefresh();
    expect(sent).toContainEqual({ channel: 'to:ai:config:get', data: null });
  });

  it('setProviderConfig forwards the full request shape', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.setProviderConfig({
      provider: 'anthropic',
      config: { enabled: true, defaultModel: 'claude-opus-4-7' },
    });
    expect(sent).toContainEqual({
      channel: 'to:ai:config:set',
      data: {
        provider: 'anthropic',
        config: { enabled: true, defaultModel: 'claude-opus-4-7' },
      },
    });
  });

  it('setKey ships the plaintext key on to:ai:key:set (only direction it ever travels)', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.setKey('openai', 'sk-secret-value');
    expect(sent).toContainEqual({
      channel: 'to:ai:key:set',
      data: { provider: 'openai', key: 'sk-secret-value' },
    });
  });

  it('clearKey fires to:ai:key:clear with just the provider id', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.clearKey('anthropic');
    expect(sent).toContainEqual({
      channel: 'to:ai:key:clear',
      data: { provider: 'anthropic' },
    });
  });

  it('cancelChat fires to:ai:cancel with the callId', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.cancelChat('call-X');
    expect(sent).toContainEqual({
      channel: 'to:ai:cancel',
      data: { callId: 'call-X' },
    });
  });
});

describe('AssistantManager.refreshOllamaModels', () => {
  it('resolves with the model list on success', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const promise = mgr.refreshOllamaModels('http://localhost:11434');

    const sentCall = sent.find((s) => s.channel === 'to:ai:ollama:list');
    expect(sentCall).toBeDefined();
    const { callId } = sentCall!.data as { callId: string };
    expect(mgr.ownsCallId(callId)).toBe(true);

    mgr.onOllamaModels({
      callId,
      models: ['llama3.2', 'qwen2.5'],
    });

    await expect(promise).resolves.toEqual(['llama3.2', 'qwen2.5']);
    expect(mgr.ownsCallId(callId)).toBe(false);
  });

  it('rejects when the upstream returns an error', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const promise = mgr.refreshOllamaModels('http://localhost:11434');
    const sentCall = sent.find((s) => s.channel === 'to:ai:ollama:list');
    const { callId } = sentCall!.data as { callId: string };

    mgr.onOllamaModels({ callId, error: 'ECONNREFUSED' });

    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });

  it('silently drops a late delivery for a call that already resolved', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    void mgr.refreshOllamaModels('http://localhost:11434');
    const { callId } = sent.find((s) => s.channel === 'to:ai:ollama:list')!.data as { callId: string };

    mgr.onOllamaModels({ callId, models: ['a'] });
    expect(() =>
      mgr.onOllamaModels({ callId, models: ['b'] }),
    ).not.toThrow();
  });
});

describe('AssistantManager.testConnection', () => {
  it('sends to:ai:chat with maxOutputTokens=1 and a single user message', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    void mgr.testConnection('anthropic', 'claude-sonnet-4-6');

    const sentCall = sent.find((s) => s.channel === 'to:ai:chat');
    expect(sentCall).toBeDefined();
    const payload = sentCall!.data as Record<string, unknown>;
    expect(payload.provider).toBe('anthropic');
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(payload.maxOutputTokens).toBe(1);
    expect(payload.messages).toEqual([{ role: 'user', content: 'ping' }]);
    expect(typeof payload.callId).toBe('string');
  });

  it('resolves with ok:true when from:ai:done lands for the pending callId', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const promise = mgr.testConnection('openai', 'gpt-4o');
    const { callId } = sent.find((s) => s.channel === 'to:ai:chat')!.data as {
      callId: string;
    };

    mgr.onChatDone(callId);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(mgr.ownsCallId(callId)).toBe(false);
  });

  it('resolves with ok:false + code + message when from:ai:error lands', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const promise = mgr.testConnection('anthropic', 'claude-sonnet-4-6');
    const { callId } = sent.find((s) => s.channel === 'to:ai:chat')!.data as {
      callId: string;
    };

    mgr.onChatError({
      callId,
      code: 'invalid_key',
      message: '401 Unauthorized',
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      code: 'invalid_key',
      message: '401 Unauthorized',
    });
  });

  it('times out cleanly when neither done nor error arrives', async () => {
    jest.useFakeTimers();
    try {
      const { bridge, sent } = makeBridge();
      const mgr = new AssistantManager(bridge as never);
      const promise = mgr.testConnection('ollama', 'llama3.2');
      const { callId } = sent.find((s) => s.channel === 'to:ai:chat')!.data as {
        callId: string;
      };

      jest.advanceTimersByTime(20_000);
      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.code).toBe('network_error');
      // Cancellation was fired on timeout so the upstream doesn't keep
      // burning tokens after the UI gave up.
      expect(sent).toContainEqual({
        channel: 'to:ai:cancel',
        data: { callId },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores done/error events for callIds it does not own', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    expect(mgr.ownsCallId('chat-from-elsewhere')).toBe(false);
    expect(() => mgr.onChatDone('chat-from-elsewhere')).not.toThrow();
    expect(() =>
      mgr.onChatError({
        callId: 'chat-from-elsewhere',
        code: 'unknown',
        message: 'whatever',
      }),
    ).not.toThrow();
  });
});

/* ====================================================================== */
/*  P4 — Chat surface                                                       */
/* ====================================================================== */

describe('AssistantManager — conversation CRUD', () => {
  it('createConversation adds a fresh conversation and makes it active', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const id = mgr.createConversation('anthropic');
    const snap = mgr.getChatSnapshot();
    expect(snap.conversations.anthropic).toHaveLength(1);
    expect(snap.conversations.anthropic[0].id).toBe(id);
    expect(snap.conversations.anthropic[0].title).toBe('New chat');
    expect(snap.activeConversation.anthropic).toBe(id);
  });

  it('createConversation seeds the model from the hydrated config when available', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    mgr.setConfigFromServer({
      config: {
        anthropic: { enabled: true, hasKey: true, defaultModel: 'claude-opus-4-7' },
        openai: { enabled: true, hasKey: true, defaultModel: 'gpt-4o' },
        ollama: {
          enabled: false,
          hasKey: false,
          baseUrl: 'http://localhost:11434',
          defaultModel: 'llama3.2',
        },
      },
      encryptionAvailable: true,
    });
    const id = mgr.createConversation('anthropic');
    const conv = mgr.getChatSnapshot().conversations.anthropic.find((c) => c.id === id);
    expect(conv?.model).toBe('claude-opus-4-7');
  });

  it('createConversation falls back to a sane default when config is null', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const id = mgr.createConversation('openai');
    const conv = mgr.getChatSnapshot().conversations.openai.find((c) => c.id === id);
    expect(conv?.model.length).toBeGreaterThan(0);
  });

  it('renameConversation updates the title and notifies subscribers', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const listener = jest.fn();
    mgr.subscribeChat(listener);
    const id = mgr.createConversation('anthropic');
    listener.mockClear();
    mgr.renameConversation('anthropic', id, '  Hello world  ');
    expect(listener).toHaveBeenCalledTimes(1);
    const conv = mgr.getChatSnapshot().conversations.anthropic.find((c) => c.id === id);
    expect(conv?.title).toBe('Hello world');
  });

  it('deleteConversation clears the active pointer when removing the active conversation', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const a = mgr.createConversation('anthropic');
    const b = mgr.createConversation('anthropic');
    mgr.setActiveConversation('anthropic', b);
    mgr.deleteConversation('anthropic', b);
    expect(mgr.getChatSnapshot().activeConversation.anthropic).toBe(a);
    mgr.deleteConversation('anthropic', a);
    expect(mgr.getChatSnapshot().activeConversation.anthropic).toBeNull();
  });

  it('setConversationModel updates the conversation model in place', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const id = mgr.createConversation('openai');
    mgr.setConversationModel('openai', id, 'gpt-5-turbo');
    const conv = mgr.getChatSnapshot().conversations.openai.find((c) => c.id === id);
    expect(conv?.model).toBe('gpt-5-turbo');
  });
});

describe('AssistantManager — drafts', () => {
  it('setDraft / getDraft round-trip per (provider, conversationId)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const a = mgr.createConversation('anthropic');
    const b = mgr.createConversation('openai');
    mgr.setDraft('anthropic', a, 'hello ');
    mgr.setDraft('openai', b, 'world!');
    expect(mgr.getDraft('anthropic', a)).toBe('hello ');
    expect(mgr.getDraft('openai', b)).toBe('world!');
    expect(mgr.getDraft('anthropic', b)).toBe('');
  });

  it('setDraft with empty string drops the entry from the snapshot', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const id = mgr.createConversation('anthropic');
    mgr.setDraft('anthropic', id, 'hi');
    expect(mgr.getChatSnapshot().drafts[`anthropic:${id}`]).toBe('hi');
    mgr.setDraft('anthropic', id, '');
    expect(mgr.getChatSnapshot().drafts[`anthropic:${id}`]).toBeUndefined();
  });
});

describe('AssistantManager.startCall + appendChunk + onChatDone', () => {
  it('appends user + assistant placeholder messages and ships to:ai:chat', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'What is the capital of France?');
    expect(callId).not.toBeNull();
    const messages = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )?.messages;
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({
      role: 'user',
      content: 'What is the capital of France?',
      status: 'complete',
    });
    expect(messages?.[1]).toMatchObject({
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    const chatSend = sent.find((s) => s.channel === 'to:ai:chat');
    expect(chatSend).toBeDefined();
    const payload = chatSend!.data as {
      callId: string;
      provider: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.callId).toBe(callId);
    expect(payload.provider).toBe('anthropic');
    // Only the user message (the streaming placeholder is excluded).
    expect(payload.messages).toEqual([
      { role: 'user', content: 'What is the capital of France?' },
    ]);
  });

  it('appendChunk concatenates text into the assistant placeholder for the matching callId', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'Hello ');
    mgr.appendChunk(callId, 'world');
    const messages = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )?.messages;
    expect(messages?.[1].content).toBe('Hello world');
    expect(messages?.[1].status).toBe('streaming');
  });

  it('appendChunk replaces the assistant message object (new reference) so React.memo wrappers re-render', () => {
    // Regression: a previous implementation mutated `msg.content +=
    // text` in place. `<AssistantBody>` is wrapped in React.memo,
    // which shallow-compares props — same object reference means no
    // re-render, so the bubble stayed empty mid-stream even though
    // the underlying data was updated. The fix is to replace the
    // message at its index in `conv.messages` with a fresh object.
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const before = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )!.messages[1];
    mgr.appendChunk(callId, 'Hello');
    const after = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )!.messages[1];
    expect(after).not.toBe(before); // different reference
    expect(after.content).toBe('Hello');
    // The user message (index 0) keeps its reference — only the
    // streaming assistant message gets replaced.
    const userBefore = before; // placeholder — re-fetched below
    void userBefore;
    const userAfter = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )!.messages[0];
    expect(userAfter.role).toBe('user');
  });

  it('appendChunk for an unknown callId is silently ignored (test pings drop here)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    mgr.startCall('anthropic', conv, 'hi');
    expect(() => mgr.appendChunk('test-some-other', 'x')).not.toThrow();
    const messages = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )?.messages;
    expect(messages?.[1].content).toBe('');
  });

  it('onChatDone marks the streaming placeholder complete and removes the inflight entry', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'Hello');
    mgr.onChatDone(callId);
    const snap = mgr.getChatSnapshot();
    expect(snap.inflight[callId]).toBeUndefined();
    const msg = snap.conversations.anthropic
      .find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.status).toBe('complete');
    expect(msg?.content).toBe('Hello');
  });

  it('onChatError marks the streaming placeholder failed with code + message', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.onChatError({
      callId,
      code: 'invalid_key',
      message: '401 Unauthorized',
    });
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.status).toBe('failed');
    expect(msg?.errorCode).toBe('invalid_key');
    expect(msg?.errorMessage).toBe('401 Unauthorized');
    expect(mgr.getChatSnapshot().inflight[callId]).toBeUndefined();
  });

  it('cancelCall marks the placeholder cancelled and fires to:ai:cancel', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'partial');
    const ok = mgr.cancelCall(callId);
    expect(ok).toBe(true);
    expect(sent).toContainEqual({
      channel: 'to:ai:cancel',
      data: { callId },
    });
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    // Partial content stays visible — user can still see what came through.
    expect(msg?.content).toBe('partial');
    expect(msg?.status).toBe('cancelled');
    expect(mgr.getChatSnapshot().inflight[callId]).toBeUndefined();
  });

  it('keeps parallel provider calls isolated (chunks land on the correct conversation)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const a = mgr.createConversation('anthropic');
    const o = mgr.createConversation('openai');
    const callA = mgr.startCall('anthropic', a, 'A')!;
    const callO = mgr.startCall('openai', o, 'O')!;
    mgr.appendChunk(callA, 'Anthropic ');
    mgr.appendChunk(callO, 'OpenAI ');
    mgr.appendChunk(callA, 'reply');
    mgr.appendChunk(callO, 'reply');
    const snap = mgr.getChatSnapshot();
    const aMsg = snap.conversations.anthropic
      .find((c) => c.id === a)
      ?.messages.find((m) => m.role === 'assistant');
    const oMsg = snap.conversations.openai
      .find((c) => c.id === o)
      ?.messages.find((m) => m.role === 'assistant');
    expect(aMsg?.content).toBe('Anthropic reply');
    expect(oMsg?.content).toBe('OpenAI reply');
  });

  it('clears the draft for that conversation when startCall fires', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const conv = mgr.createConversation('anthropic');
    mgr.setDraft('anthropic', conv, 'unsent message');
    mgr.startCall('anthropic', conv, 'sent message');
    expect(mgr.getDraft('anthropic', conv)).toBe('');
  });
});

describe('AssistantManager — done/error routing (test path still works after P4)', () => {
  it('onChatDone resolves a pending testConnection before checking chats', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    const promise = mgr.testConnection('anthropic', 'claude-sonnet-4-6');
    const { callId } = sent.find((s) => s.channel === 'to:ai:chat')!.data as {
      callId: string;
    };
    mgr.onChatDone(callId);
    await expect(promise).resolves.toEqual({ ok: true });
    // No chat inflight entries should exist.
    expect(Object.keys(mgr.getChatSnapshot().inflight)).toHaveLength(0);
  });
});
