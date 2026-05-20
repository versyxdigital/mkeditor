/**
 * Sender-scoping and dispose behaviour for AppBridge — defends against
 * the macOS recreate-on-activate pattern stacking listeners across
 * BrowserWindow instances. Mirrors the contract enforced in AppWindow
 * and AppMenu: every handler is wrapped in a `sender.id ===
 * this.context.webContents.id` guard, and every registered listener /
 * invoke channel is detached when the window emits `closed`.
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
  AppStorage: {
    getActiveFilePath: jest.fn(() => '/abs/active.md'),
    setWorkspaceRoot: jest.fn(),
  },
}));

jest.mock('../src/app/lib/assistantStoreFile', () => ({
  loadPersistedConversations: jest.fn(),
  writePersistedConversations: jest.fn(),
}));

import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';

type Listener = (...args: unknown[]) => void;

const SENDER_ID = 42;

interface MockContext {
  webContents: {
    id: number;
    send: jest.Mock;
  };
  setTitle: jest.Mock;
  isDestroyed: jest.Mock;
  once: jest.Mock;
  fireOnce: (event: string, ...args: unknown[]) => void;
}

function makeContext(senderId: number = SENDER_ID): MockContext {
  const onceHandlers = new Map<string, Listener[]>();
  return {
    webContents: {
      id: senderId,
      send: jest.fn(),
    },
    setTitle: jest.fn(),
    isDestroyed: jest.fn(() => false),
    once: jest.fn((event: string, handler: Listener) => {
      const arr = onceHandlers.get(event) ?? [];
      arr.push(handler);
      onceHandlers.set(event, arr);
    }),
    fireOnce: (event, ...args) => {
      (onceHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
  };
}

function fakeEvent(senderId: number = SENDER_ID) {
  return { sender: { id: senderId } } as unknown as Parameters<Listener>[0];
}

function findOnHandler(channel: string): Listener {
  const calls = (ipcMain.on as jest.Mock).mock.calls;
  const found = [...calls].reverse().find(([ch]) => ch === channel);
  if (!found)
    throw new Error(`No ipcMain.on handler registered for ${channel}`);
  return found[1] as Listener;
}

function findHandleHandler(channel: string): Listener {
  const calls = (ipcMain.handle as jest.Mock).mock.calls;
  const found = [...calls].reverse().find(([ch]) => ch === channel);
  if (!found) {
    throw new Error(`No ipcMain.handle handler registered for ${channel}`);
  }
  return found[1] as Listener;
}

beforeEach(() => {
  (ipcMain.on as jest.Mock).mockClear();
  (ipcMain.handle as jest.Mock).mockClear();
  (ipcMain.removeListener as jest.Mock).mockClear();
  (ipcMain.removeHandler as jest.Mock).mockClear();
  jest.clearAllMocks();
});

describe('AppBridge — sender-scoped IPC handlers', () => {
  it('ignores fire-and-forget channels from a foreign sender', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    findOnHandler('to:session:save')(fakeEvent(999), {
      version: 1,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
    });

    expect(AppSession.save).not.toHaveBeenCalled();
  });

  it('returns null on synchronous channels when the sender mismatches', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const event = { sender: { id: 999 }, returnValue: 'untouched' };
    findOnHandler('mked:secure:public-key')(event as never);

    // Foreign sender must never receive THIS window's public key — the
    // private half lives in the bridge's per-session SecureChannel.
    expect(event.returnValue).toBeNull();
  });

  it('returns the per-window public key for the owning sender', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const event = {
      sender: { id: SENDER_ID },
      returnValue: undefined as unknown as string | null,
    };
    findOnHandler('mked:secure:public-key')(event as never);

    expect(typeof event.returnValue).toBe('string');
    expect((event.returnValue as string).length).toBeGreaterThan(0);
  });

  it('rejects invoke handlers from a foreign sender', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const handler = findHandleHandler('mked:path:dirname');
    expect(() =>
      handler({ sender: { id: 999 } } as never, '/abs/foo/bar.md'),
    ).toThrow(/sender mismatch/);
  });

  it('honours owning-sender invoke calls', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const handler = findHandleHandler('mked:path:dirname');
    const result = handler(
      { sender: { id: SENDER_ID } } as never,
      '/abs/foo/bar.md',
    );
    // `path.dirname('/abs/foo/bar.md')` — exact platform separator
    // doesn't matter; assert via includes.
    expect(String(result)).toMatch(/foo$/);
  });
});

describe('AppBridge — closed-window cleanup', () => {
  it('removes every ipcMain.on listener it registered when the window emits closed', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const onCallsBeforeClose = (ipcMain.on as jest.Mock).mock.calls.length;
    const removeListenerCallsBefore = (ipcMain.removeListener as jest.Mock).mock
      .calls.length;

    ctx.fireOnce('closed');

    const removeListenerCallsAfter = (ipcMain.removeListener as jest.Mock).mock
      .calls.length;

    // One removeListener per registered ipcMain.on handler.
    expect(removeListenerCallsAfter - removeListenerCallsBefore).toBe(
      onCallsBeforeClose,
    );
  });

  it('removes every ipcMain.handle invoke handler it registered when the window emits closed', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    const handleCallsBeforeClose = (ipcMain.handle as jest.Mock).mock.calls
      .length;
    const removeHandlerCallsBefore = (ipcMain.removeHandler as jest.Mock).mock
      .calls.length;

    ctx.fireOnce('closed');

    const removeHandlerCallsAfter = (ipcMain.removeHandler as jest.Mock).mock
      .calls.length;
    expect(removeHandlerCallsAfter - removeHandlerCallsBefore).toBe(
      handleCallsBeforeClose,
    );
  });

  it('is idempotent — a second `closed` firing does not double-remove', () => {
    const ctx = makeContext();
    new AppBridge(ctx as never, true);

    ctx.fireOnce('closed');
    const removeListenerCalls = (ipcMain.removeListener as jest.Mock).mock.calls
      .length;
    const removeHandlerCalls = (ipcMain.removeHandler as jest.Mock).mock.calls
      .length;

    ctx.fireOnce('closed');

    expect((ipcMain.removeListener as jest.Mock).mock.calls.length).toBe(
      removeListenerCalls,
    );
    expect((ipcMain.removeHandler as jest.Mock).mock.calls.length).toBe(
      removeHandlerCalls,
    );
  });
});
