import { AssistantManager } from '../src/browser/core/AssistantManager';
import {
  DEFAULT_PROVIDER_CONFIG,
  type ConfigPushPayload,
} from '../src/app/interfaces/Assistant';
import { getAssistantConnection } from '../src/browser/core/assistantConnection';

jest.mock('../src/browser/core/SecureChannelClient', () => ({
  encryptForMain: jest.fn(async () => 'encrypted-key'),
}));

function snapshot(): ConfigPushPayload {
  return {
    encryptionAvailable: true,
    config: {
      anthropic: {
        ...DEFAULT_PROVIDER_CONFIG.anthropic,
        enabled: true,
        hasKey: true,
      },
      openai: {
        ...DEFAULT_PROVIDER_CONFIG.openai,
        enabled: true,
        hasKey: true,
      },
      ollama: {
        ...DEFAULT_PROVIDER_CONFIG.ollama,
        enabled: true,
        hasKey: false,
      },
    },
  };
}

function setup() {
  const bridge = { send: jest.fn(), receive: jest.fn() };
  const manager = new AssistantManager(bridge, { disablePacedReveal: true });
  manager.setConfigFromServer(snapshot());
  return { manager, bridge };
}

test.each(['openai', 'anthropic'] as const)(
  'removing the %s key cancels its call and blocks sends without losing drafts or history',
  (provider) => {
    const { manager, bridge } = setup();
    const id = manager.createConversation(provider);
    const call = manager.startCall(provider, id, 'Earlier message')!;
    manager.setDraft(provider, id, 'Unsent draft');
    const next = snapshot();
    next.config[provider].hasKey = false;
    manager.setConfigFromServer(next);
    expect(bridge.send).toHaveBeenCalledWith('to:ai:cancel', { callId: call });
    expect(manager.getChatSnapshot().inflight).toEqual({});
    const previous = manager.getChatSnapshot().conversations[provider][0];
    expect(manager.startCall(provider, id, 'Do not send')).toBeNull();
    expect(manager.getChatSnapshot().conversations[provider][0]).toBe(previous);
    expect(manager.getDraft(provider, id)).toBe('Unsent draft');
    expect(previous.messages[0].content).toBe('Earlier message');
    manager.setConfigFromServer(snapshot());
    expect(manager.startCall(provider, id, 'Connected again')).not.toBeNull();
    for (const callId of Object.keys(manager.getChatSnapshot().inflight))
      manager.cancelCall(callId);
    manager.flushPersist();
  },
);

test('a signed-out ChatGPT plan cannot use a saved API key automatically', () => {
  const { manager } = setup();
  const next = snapshot();
  next.chatgpt = {
    mode: 'chatgpt',
    connected: false,
    signingIn: false,
    welcome: false,
    accounts: [],
    models: [],
  };
  manager.setConfigFromServer(next);
  const id = manager.createConversation('openai');
  expect(getAssistantConnection('openai', manager.getConfigSnapshot())).toBe(
    'signed-out',
  );
  expect(manager.startCall('openai', id, 'Hello')).toBeNull();
  expect(manager.getChatSnapshot().conversations.openai[0].messages).toEqual(
    [],
  );
  manager.flushPersist();
});

test('authentication-change cancellation is presented as cancelled rather than failed', () => {
  const { manager } = setup();
  const id = manager.createConversation('openai');
  const callId = manager.startCall('openai', id, 'Hello')!;
  manager.onChatError({
    callId,
    code: 'cancelled',
    message: 'Authentication changed',
  });
  expect(
    manager.getChatSnapshot().conversations.openai[0].messages.at(-1)?.status,
  ).toBe('cancelled');
  manager.flushPersist();
});

test('plan readiness requires permission and is independent of API-key presence', () => {
  const next = snapshot();
  next.config.openai.hasKey = false;
  next.chatgpt = {
    mode: 'chatgpt',
    connected: true,
    planEnabled: true,
    signingIn: false,
    welcome: false,
    accounts: [],
    models: [],
  };
  expect(getAssistantConnection('openai', next)).toBe('ready');
  next.chatgpt.planEnabled = false;
  expect(getAssistantConnection('openai', next)).toBe('permission-required');
  next.chatgpt.busy = true;
  expect(getAssistantConnection('openai', next)).toBe('connecting');
});

test.each([true, false])(
  'inline key save waits for acknowledgement and changes billing only on success (%s)',
  async (ok) => {
    const { manager, bridge } = setup();
    let finished = false;
    const connecting = manager
      .connectWithApiKey('openai', 'private-key')
      .then((value) => {
        finished = true;
        return value;
      });
    await Promise.resolve();
    await Promise.resolve();
    const request = bridge.send.mock.calls.find(
      ([channel]) => channel === 'to:ai:key:set',
    )![1];
    expect(request).toMatchObject({
      ciphertext: 'encrypted-key',
      provider: 'openai',
      requestId: expect.any(String),
    });
    expect(JSON.stringify(bridge.send.mock.calls)).not.toContain('private-key');
    expect(finished).toBe(false);
    manager.onKeySaveResult({
      requestId: request.requestId,
      provider: 'anthropic',
      ok: true,
    });
    expect(finished).toBe(false);
    manager.onKeySaveResult({
      requestId: request.requestId,
      provider: 'openai',
      ok,
    });
    expect(await connecting).toBe(ok);
    const modeChanges = bridge.send.mock.calls.filter(
      ([channel]) => channel === 'to:ai:chatgpt',
    );
    expect(modeChanges).toEqual(
      ok ? [['to:ai:chatgpt', { action: 'mode', mode: 'api-key' }]] : [],
    );
  },
);

test('a missing key-save acknowledgement times out without switching billing', async () => {
  jest.useFakeTimers();
  try {
    const { manager, bridge } = setup();
    const pending = manager.connectWithApiKey('openai', 'private-key');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(15000);
    expect(await pending).toBe(false);
    expect(
      bridge.send.mock.calls.some(([channel]) => channel === 'to:ai:chatgpt'),
    ).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
