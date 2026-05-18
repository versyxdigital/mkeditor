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

  it('ignores done/error events for callIds it does not own (P4 chat ids)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never);
    expect(mgr.ownsCallId('chat-from-p4')).toBe(false);
    expect(() => mgr.onChatDone('chat-from-p4')).not.toThrow();
    expect(() =>
      mgr.onChatError({
        callId: 'chat-from-p4',
        code: 'unknown',
        message: 'whatever',
      }),
    ).not.toThrow();
  });
});
