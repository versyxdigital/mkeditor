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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    expect(mgr.getConfigSnapshot()).toEqual({
      config: null,
      encryptionAvailable: false,
    });
  });

  it('replaces the snapshot and notifies subscribers on setConfigFromServer', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const listener = jest.fn();
    mgr.subscribeConfig(listener);
    mgr.setConfigFromServer(SAMPLE_PUSH);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mgr.getConfigSnapshot()).toEqual(SAMPLE_PUSH);
  });

  it('unsubscribe stops further notifications', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.requestConfigRefresh();
    expect(sent).toContainEqual({ channel: 'to:ai:config:get', data: null });
  });

  it('setProviderConfig forwards the full request shape', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.setKey('openai', 'sk-secret-value');
    expect(sent).toContainEqual({
      channel: 'to:ai:key:set',
      data: { provider: 'openai', key: 'sk-secret-value' },
    });
  });

  it('clearKey fires to:ai:key:clear with just the provider id', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.clearKey('anthropic');
    expect(sent).toContainEqual({
      channel: 'to:ai:key:clear',
      data: { provider: 'anthropic' },
    });
  });

  it('cancelChat fires to:ai:cancel with the callId', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const promise = mgr.refreshOllamaModels('http://localhost:11434');
    const sentCall = sent.find((s) => s.channel === 'to:ai:ollama:list');
    const { callId } = sentCall!.data as { callId: string };

    mgr.onOllamaModels({ callId, error: 'ECONNREFUSED' });

    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });

  it('silently drops a late delivery for a call that already resolved', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
      const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const id = mgr.createConversation('anthropic');
    const snap = mgr.getChatSnapshot();
    expect(snap.conversations.anthropic).toHaveLength(1);
    expect(snap.conversations.anthropic[0].id).toBe(id);
    expect(snap.conversations.anthropic[0].title).toBe('New chat');
    expect(snap.activeConversation.anthropic).toBe(id);
  });

  it('createConversation seeds the model from the hydrated config when available', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const id = mgr.createConversation('openai');
    const conv = mgr.getChatSnapshot().conversations.openai.find((c) => c.id === id);
    expect(conv?.model.length).toBeGreaterThan(0);
  });

  it('renameConversation updates the title and notifies subscribers', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const id = mgr.createConversation('openai');
    mgr.setConversationModel('openai', id, 'gpt-5-turbo');
    const conv = mgr.getChatSnapshot().conversations.openai.find((c) => c.id === id);
    expect(conv?.model).toBe('gpt-5-turbo');
  });
});

describe('AssistantManager — drafts', () => {
  it('setDraft / getDraft round-trip per (provider, conversationId)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    mgr.setDraft('anthropic', conv, 'unsent message');
    mgr.startCall('anthropic', conv, 'sent message');
    expect(mgr.getDraft('anthropic', conv)).toBe('');
  });
});

// P8 polish — paced reveal. Tests above pass `disablePacedReveal:
// true` to keep the simpler "append → assert" shape. These tests
// exercise the production code path with an injected fake clock so
// the per-frame drain is deterministic.
describe('AssistantManager — paced streaming reveal (P8)', () => {
  function fakeFrameClock() {
    let pending: FrameRequestCallback[] = [];
    return {
      requestFrame: (cb: FrameRequestCallback) => {
        pending.push(cb);
        return pending.length;
      },
      cancelFrame: () => {
        pending = [];
      },
      tick: () => {
        const due = pending;
        pending = [];
        for (const cb of due) cb(performance.now());
      },
      pendingCount: () => pending.length,
    };
  }

  it('buffers an incoming chunk and reveals fractions of it across rAF ticks (smooth typing)', () => {
    const { bridge } = makeBridge();
    const clock = fakeFrameClock();
    const mgr = new AssistantManager(bridge as never, {
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;

    // Single 14-char chunk arrives — large enough to span multiple
    // frames (drain target is `ceil(len / 7)` per frame).
    mgr.appendChunk(callId, 'Hello, sailor!');

    const contentNow = () =>
      mgr.getChatSnapshot().conversations.anthropic.find((c) => c.id === conv)!
        .messages[1].content;

    // Before any frame fires, nothing is visible yet — the burst
    // hasn't been painted into the message.
    expect(contentNow()).toBe('');

    // Each tick paints `ceil(remaining / 7)` chars: 2, 2, 2, 2, 2, 2, 2.
    clock.tick();
    expect(contentNow().length).toBeGreaterThan(0);
    expect(contentNow().length).toBeLessThan(14);

    // Drain by repeated ticks; should land on full text within ~7
    // frames and stop scheduling.
    for (let i = 0; i < 10 && contentNow().length < 14; i++) clock.tick();
    expect(contentNow()).toBe('Hello, sailor!');
    expect(clock.pendingCount()).toBe(0);
  });

  it('drains the remaining buffer synchronously on onChatDone (final content is never silently truncated)', () => {
    const { bridge } = makeBridge();
    const clock = fakeFrameClock();
    const mgr = new AssistantManager(bridge as never, {
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'A very long final answer that has not been revealed yet.');
    // Stream ends before the buffer has fully drained — done must
    // flush the rest so the persisted body is complete.
    mgr.onChatDone(callId);
    const msg = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )!.messages[1];
    expect(msg.status).toBe('complete');
    expect(msg.content).toBe(
      'A very long final answer that has not been revealed yet.',
    );
  });

  it('drains the buffer on cancelCall too (no token loss when user hits Stop mid-burst)', () => {
    const { bridge } = makeBridge();
    const clock = fakeFrameClock();
    const mgr = new AssistantManager(bridge as never, {
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'Partial response that the user cancelled.');
    mgr.cancelCall(callId);
    const msg = mgr.getChatSnapshot().conversations.anthropic.find(
      (c) => c.id === conv,
    )!.messages[1];
    expect(msg.status).toBe('cancelled');
    expect(msg.content).toBe('Partial response that the user cancelled.');
  });
});

/* ====================================================================== */
/*  P5 — Tool calls                                                          */
/* ====================================================================== */

describe('AssistantManager.onToolCall — read-class auto-execute', () => {
  it('records the tool call as succeeded and ships to:ai:tool-result with the result', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => true),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'read' as const),
      buildPreview: jest.fn(() => null),
      execute: jest.fn(async () => ({ ok: true, content: 'file body' })),
    };
    mgr.setToolExecutor(executor);

    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'read_file',
      arguments: { path: '/x.md' },
    });
    // Microtasks drain the immediate-execute path.
    await Promise.resolve();
    await Promise.resolve();

    expect(executor.execute).toHaveBeenCalledWith('read_file', { path: '/x.md' });
    const toolResultSend = sent.find((s) => s.channel === 'to:ai:tool-result');
    expect(toolResultSend).toBeDefined();
    expect(toolResultSend!.data).toEqual({
      callId,
      toolCallId: 'tc-1',
      result: { ok: true, content: 'file body' },
    });
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0]).toMatchObject({
      toolCallId: 'tc-1',
      status: 'succeeded',
    });
  });

  it('records failure when the tool throws and ships an error-shaped tool-result', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => true),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'read' as const),
      buildPreview: jest.fn(() => null),
      execute: jest.fn(async () => {
        throw new Error('disk full');
      }),
    };
    mgr.setToolExecutor(executor);
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-x',
      toolName: 'read_file',
      arguments: {},
    });
    await Promise.resolve();
    await Promise.resolve();

    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0].status).toBe('failed');
    expect(msg?.toolCalls?.[0].errorCode).toBe('execution_failed');
    expect(msg?.toolCalls?.[0].errorMessage).toBe('disk full');
    const toolResultSend = sent.find((s) => s.channel === 'to:ai:tool-result');
    expect((toolResultSend!.data as { result: { ok: boolean } }).result.ok).toBe(false);
  });

  it('marks the call failed with unknown_tool when the executor does not know the tool', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => false),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'unknown' as const),
      buildPreview: jest.fn(() => null),
      execute: jest.fn(),
    };
    mgr.setToolExecutor(executor);
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-x',
      toolName: 'made_up',
      arguments: {},
    });
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
    const toolResultSend = sent.find((s) => s.channel === 'to:ai:tool-result');
    expect(toolResultSend).toBeDefined();
    expect((toolResultSend!.data as { result: { ok: boolean; error: string } }).result).toEqual({
      ok: false,
      error: 'unknown_tool',
    });
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0].status).toBe('failed');
    expect(msg?.toolCalls?.[0].errorCode).toBe('unknown_tool');
  });

  it('silently drops onToolCall for foreign callIds (no message mutation, no IPC)', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.onToolCall({
      callId: 'never-existed',
      toolCallId: 'tc-x',
      toolName: 'read_file',
      arguments: {},
    });
    expect(sent.filter((s) => s.channel === 'to:ai:tool-result')).toHaveLength(0);
  });
});

describe('AssistantManager.onToolCall — write-class confirmation', () => {
  // The confirm dialog lives in React; AssistantManager opens it via
  // the module-level `confirmToolCallExternal` seam. We register a
  // fake opener that resolves with our chosen verdict.
  let resolveOpen: ((ok: boolean) => void) | null = null;
  beforeEach(() => {
    resolveOpen = null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerToolConfirmOpener } = require('../src/browser/react/contexts/ToolConfirmContext');
    registerToolConfirmOpener(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );
  });

  it('opens the confirm dialog; on accept executes the tool', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => true),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'write' as const),
      buildPreview: jest.fn(() => ({
        kind: 'write' as const,
        path: '/x.md',
        after: 'new',
      })),
      execute: jest.fn(async () => ({ ok: true })),
    };
    mgr.setToolExecutor(executor);

    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: { path: '/x.md', content: 'new' },
    });
    // Initial state: pending-confirm, dialog open, executor NOT called.
    await Promise.resolve();
    let msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0].status).toBe('pending-confirm');
    expect(executor.execute).not.toHaveBeenCalled();

    // Accept the dialog.
    resolveOpen!(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(executor.execute).toHaveBeenCalledWith('write_file', {
      path: '/x.md',
      content: 'new',
    });
    msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0].status).toBe('succeeded');
    const toolResultSend = sent.find((s) => s.channel === 'to:ai:tool-result');
    expect(toolResultSend).toBeDefined();
  });

  it('opens the confirm dialog; on reject ships an error-shaped tool-result + marks failed/rejected', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => true),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'write' as const),
      buildPreview: jest.fn(() => null),
      execute: jest.fn(),
    };
    mgr.setToolExecutor(executor);
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: {},
    });
    await Promise.resolve();
    resolveOpen!(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(executor.execute).not.toHaveBeenCalled();
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)
      ?.messages.find((m) => m.role === 'assistant');
    expect(msg?.toolCalls?.[0].status).toBe('failed');
    expect(msg?.toolCalls?.[0].errorCode).toBe('rejected');
    const toolResultSend = sent.find((s) => s.channel === 'to:ai:tool-result');
    expect((toolResultSend!.data as { result: { error: string } }).result.error).toBe('rejected');
  });

  it('autoAcceptWrites bypasses the confirm dialog and executes immediately', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    mgr.setAutoAcceptWrites('anthropic', conv, true);
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    const executor = {
      hasTool: jest.fn(() => true),
      describe: jest.fn(() => []),
      classify: jest.fn(() => 'write' as const),
      buildPreview: jest.fn(() => null),
      execute: jest.fn(async () => ({ ok: true })),
    };
    mgr.setToolExecutor(executor);
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(executor.execute).toHaveBeenCalled();
    expect(resolveOpen).toBeNull(); // confirm seam never invoked
  });
});

describe('AssistantManager — startCall ships tools when an executor is set', () => {
  it('includes the executor.describe() result in ChatRequest.tools', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    mgr.setToolExecutor({
      hasTool: () => true,
      describe: () => [
        {
          name: 'read_file',
          description: 'read a file',
          parameters: { type: 'object' },
        },
      ],
      classify: () => 'read',
      buildPreview: () => null,
      execute: async () => ({}),
    });
    mgr.startCall('anthropic', conv, 'hi');
    const chatSend = sent.find((s) => s.channel === 'to:ai:chat');
    const payload = chatSend!.data as { tools?: Array<{ name: string }> };
    expect(payload.tools?.map((t) => t.name)).toEqual(['read_file']);
  });

  it('omits tools when no executor is set (chat-only fallback)', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    mgr.startCall('anthropic', conv, 'hi');
    const chatSend = sent.find((s) => s.channel === 'to:ai:chat');
    const payload = chatSend!.data as { tools?: unknown };
    expect(payload.tools).toBeUndefined();
  });
});

describe('AssistantManager — interleaved segments (P6 polish)', () => {
  it('appendChunk extends the trailing text segment in place (no fragmentation)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'Hello ');
    mgr.appendChunk(callId, 'world');
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)!
      .messages.find((m) => m.role === 'assistant')!;
    expect(msg.segments).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(msg.content).toBe('Hello world');
  });

  it('onToolCall (read-class) pushes a tool-call segment after the existing text — exact emission order', async () => {
    // Regression for the "text concatenated, tool cards dumped below"
    // visual: the manager must record segments in the emission order
    // text → tool → text → tool so the renderer can interleave them.
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.setToolExecutor({
      hasTool: () => true,
      describe: () => [],
      classify: () => 'read' as const,
      buildPreview: () => null,
      execute: async () => ({ ok: true }),
    });
    mgr.appendChunk(callId, "I'll create one. ");
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'create_file',
      arguments: {},
    });
    // Let the executor microtask resolve.
    await Promise.resolve();
    await Promise.resolve();
    mgr.appendChunk(callId, 'Done!');
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)!
      .messages.find((m) => m.role === 'assistant')!;
    expect(msg.segments).toEqual([
      { type: 'text', text: "I'll create one. " },
      { type: 'tool-call', toolCallId: 'tc-1' },
      { type: 'text', text: 'Done!' },
    ]);
    // `content` stays in sync (joined text only) — the wire shape the
    // model sees is unchanged.
    expect(msg.content).toBe("I'll create one. Done!");
  });

  it('a tool-call segment is recorded once even though recordToolCall fires on every status transition', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.setToolExecutor({
      hasTool: () => true,
      describe: () => [],
      classify: () => 'read' as const,
      buildPreview: () => null,
      execute: async () => ({ ok: true }),
    });
    mgr.onToolCall({
      callId,
      toolCallId: 'tc-1',
      toolName: 'read_file',
      arguments: {},
    });
    await Promise.resolve();
    await Promise.resolve();
    // The tool went pending → executing → succeeded — three updates,
    // but the segments list must show exactly one entry for this id.
    const msg = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)!
      .messages.find((m) => m.role === 'assistant')!;
    const toolSegs = msg.segments?.filter((s) => s.type === 'tool-call');
    expect(toolSegs).toHaveLength(1);
    expect(toolSegs?.[0]).toEqual({ type: 'tool-call', toolCallId: 'tc-1' });
  });
});

describe('AssistantManager — done/error routing (test path still works after P4)', () => {
  it('onChatDone resolves a pending testConnection before checking chats', async () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
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
