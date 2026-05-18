/**
 * Targeted tests for the P7 conversation-persistence IPC wiring on
 * AppBridge. The store-file helpers (`loadPersistedConversations` /
 * `writePersistedConversations`) are stubbed so we exercise ONLY the
 * IPC-handler forwarding behaviour; the round-trip persistence path
 * is covered in `assistantStoreFile.persistence.test.ts`.
 */

jest.mock('../src/app/lib/AppSession', () => ({
  AppSession: {
    save: jest.fn(),
    load: jest.fn(() => null),
    clear: jest.fn(),
    buildRestoreEnvelope: jest.fn(() => ({
      session: null,
      missing: [],
      contents: {},
    })),
  },
}));

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: {},
}));

jest.mock('../src/app/lib/assistantStoreFile', () => ({
  loadPersistedConversations: jest.fn(),
  writePersistedConversations: jest.fn(),
}));

import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import {
  loadPersistedConversations,
  writePersistedConversations,
} from '../src/app/lib/assistantStoreFile';
import type { PersistedConversations } from '../src/app/interfaces/Assistant';

const SAMPLE_PAYLOAD: PersistedConversations = {
  activeProvider: 'anthropic',
  activeConversation: { anthropic: 'c-1', openai: null, ollama: null },
  conversations: {
    anthropic: [
      {
        id: 'c-1',
        providerId: 'anthropic',
        title: 'Round trip',
        model: 'claude-sonnet-4-6',
        messages: [],
        autoAcceptWrites: false,
        shareActiveFile: true,
        shareSelection: false,
        mentions: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    openai: [],
    ollama: [],
  },
  drafts: {},
};

function makeBridge() {
  const send = jest.fn();
  const isDestroyed = jest.fn<boolean, []>(() => false);
  const context = {
    webContents: { send },
    isDestroyed,
    setTitle: jest.fn(),
  } as never;
  const bridge = new AppBridge(context);
  bridge.register();
  return { bridge, send, isDestroyed };
}

function findHandler(channel: string) {
  const onMock = ipcMain.on as unknown as jest.Mock;
  const call = onMock.mock.calls.find((c) => c[0] === channel);
  expect(call).toBeDefined();
  return call![1] as (e: unknown, payload: unknown) => void;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AppBridge — to:ai:conversations:save handler (P7)', () => {
  it('forwards the renderer payload to writePersistedConversations', () => {
    makeBridge();
    const handler = findHandler('to:ai:conversations:save');
    handler({}, SAMPLE_PAYLOAD);
    expect(writePersistedConversations).toHaveBeenCalledTimes(1);
    expect(writePersistedConversations).toHaveBeenCalledWith(SAMPLE_PAYLOAD);
  });

  it('forwards a null payload (clear-history affordance)', () => {
    makeBridge();
    const handler = findHandler('to:ai:conversations:save');
    handler({}, null);
    expect(writePersistedConversations).toHaveBeenCalledWith(null);
  });

  it('swallows write errors so the renderer never sees a crash', () => {
    (writePersistedConversations as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    makeBridge();
    const handler = findHandler('to:ai:conversations:save');
    // No throw — error is logged inside the handler.
    expect(() => handler({}, SAMPLE_PAYLOAD)).not.toThrow();
  });
});

describe('AppBridge — to:ai:conversations:flush handler (P7)', () => {
  it('forwards the quit-flush payload to writePersistedConversations', () => {
    makeBridge();
    const handler = findHandler('to:ai:conversations:flush');
    handler({}, SAMPLE_PAYLOAD);
    expect(writePersistedConversations).toHaveBeenCalledWith(SAMPLE_PAYLOAD);
  });
});

describe('AppBridge.pushPersistedConversations (P7)', () => {
  it('sends the loaded snapshot over from:ai:conversations', () => {
    (loadPersistedConversations as jest.Mock).mockReturnValueOnce(
      SAMPLE_PAYLOAD,
    );
    const { bridge, send } = makeBridge();
    bridge.pushPersistedConversations();
    expect(send).toHaveBeenCalledWith(
      'from:ai:conversations',
      SAMPLE_PAYLOAD,
    );
  });

  it('sends null when the store has no conversations block (pre-P7 migration path)', () => {
    (loadPersistedConversations as jest.Mock).mockReturnValueOnce(null);
    const { bridge, send } = makeBridge();
    bridge.pushPersistedConversations();
    expect(send).toHaveBeenCalledWith('from:ai:conversations', null);
  });

  it('is a no-op when the window has been destroyed (race-safe)', () => {
    const { bridge, send, isDestroyed } = makeBridge();
    isDestroyed.mockReturnValue(true);
    bridge.pushPersistedConversations();
    expect(send).not.toHaveBeenCalledWith(
      'from:ai:conversations',
      expect.anything(),
    );
  });
});

describe('AppBridge.requestPersistedConversationsFlush (P7)', () => {
  it('broadcasts from:ai:conversations:flush-request so the renderer ships its serialize() output', () => {
    const { bridge, send } = makeBridge();
    bridge.requestPersistedConversationsFlush();
    expect(send).toHaveBeenCalledWith(
      'from:ai:conversations:flush-request',
      null,
    );
  });

  it('is a no-op when the window has been destroyed', () => {
    const { bridge, send, isDestroyed } = makeBridge();
    isDestroyed.mockReturnValue(true);
    bridge.requestPersistedConversationsFlush();
    expect(send).not.toHaveBeenCalledWith(
      'from:ai:conversations:flush-request',
      expect.anything(),
    );
  });
});
