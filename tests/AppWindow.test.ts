/**
 * AppWindow unit tests.
 *
 * `ipcMain` is the jest.fn() from `tests/__mocks__/electron.js`. Each
 * test instantiates AppWindow against a hand-built BrowserWindow stub
 * and reads handlers off `ipcMain.on.mock.calls`.
 */

import { ipcMain } from 'electron';
import { AppWindow } from '../src/app/lib/AppWindow';

type Listener = (...args: unknown[]) => void;

interface MockWindow {
  minimize: jest.Mock;
  maximize: jest.Mock;
  unmaximize: jest.Mock;
  close: jest.Mock;
  setFullScreen: jest.Mock;
  isMaximized: jest.Mock<boolean, []>;
  isFullScreen: jest.Mock<boolean, []>;
  isDestroyed: jest.Mock<boolean, []>;
  on: jest.Mock;
  once: jest.Mock;
  webContents: {
    id: number;
    send: jest.Mock;
    once: jest.Mock;
  };
  fireEvent: (event: string, ...args: unknown[]) => void;
  fireWindowOnce: (event: string, ...args: unknown[]) => void;
  fireWebContentsOnce: (event: string, ...args: unknown[]) => void;
}

// Sender-id used by the sender-scoping check in AppWindow.register —
// every fake IPC event must carry this so the wrapper passes through.
const FAKE_SENDER_ID = 42;

function makeMockWindow(senderId: number = FAKE_SENDER_ID): MockWindow {
  const eventHandlers = new Map<string, Listener[]>();
  const windowOnceHandlers = new Map<string, Listener[]>();
  const webContentsOnceHandlers = new Map<string, Listener[]>();
  return {
    minimize: jest.fn(),
    maximize: jest.fn(),
    unmaximize: jest.fn(),
    close: jest.fn(),
    setFullScreen: jest.fn(),
    isMaximized: jest.fn<boolean, []>(() => false),
    isFullScreen: jest.fn<boolean, []>(() => false),
    isDestroyed: jest.fn<boolean, []>(() => false),
    on: jest.fn((event: string, handler: Listener) => {
      const arr = eventHandlers.get(event) ?? [];
      arr.push(handler);
      eventHandlers.set(event, arr);
    }),
    once: jest.fn((event: string, handler: Listener) => {
      const arr = windowOnceHandlers.get(event) ?? [];
      arr.push(handler);
      windowOnceHandlers.set(event, arr);
    }),
    webContents: {
      id: senderId,
      send: jest.fn(),
      once: jest.fn((event: string, handler: Listener) => {
        const arr = webContentsOnceHandlers.get(event) ?? [];
        arr.push(handler);
        webContentsOnceHandlers.set(event, arr);
      }),
    },
    fireEvent: (event, ...args) => {
      (eventHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
    fireWindowOnce: (event, ...args) => {
      (windowOnceHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
    fireWebContentsOnce: (event, ...args) => {
      (webContentsOnceHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
  };
}

/** Fake IPC event the sender-scoped wrappers want to see. */
function fakeIpcEvent(senderId: number = FAKE_SENDER_ID) {
  return { sender: { id: senderId } } as unknown as Parameters<Listener>[0];
}

function getIpcHandler(channel: string): Listener {
  const calls = (ipcMain.on as jest.Mock).mock.calls;
  // Take the most recently registered handler for the channel — repeated
  // AppWindow instantiations within a single test would stack listeners
  // on the shared ipcMain mock; we want the one this test installed.
  const found = [...calls].reverse().find(([ch]) => ch === channel);
  if (!found) throw new Error(`No handler registered for ${channel}`);
  return found[1] as Listener;
}

beforeEach(() => {
  (ipcMain.on as jest.Mock).mockClear();
});

describe('AppWindow', () => {
  it('to:window:minimize calls context.minimize', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    getIpcHandler('to:window:minimize')(fakeIpcEvent());
    expect(win.minimize).toHaveBeenCalledTimes(1);
  });

  it('to:window:maximize toggles based on current state', () => {
    const win = makeMockWindow();
    win.isMaximized.mockReturnValueOnce(false).mockReturnValueOnce(true);
    new AppWindow(win as never, true);
    const handler = getIpcHandler('to:window:maximize');

    handler(fakeIpcEvent());
    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.unmaximize).not.toHaveBeenCalled();

    handler(fakeIpcEvent());
    expect(win.unmaximize).toHaveBeenCalledTimes(1);
    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it('to:window:close calls context.close', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    getIpcHandler('to:window:close')(fakeIpcEvent());
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('to:window:fullscreen toggles via setFullScreen with the inverse of isFullScreen', () => {
    const win = makeMockWindow();
    win.isFullScreen.mockReturnValueOnce(false).mockReturnValueOnce(true);
    new AppWindow(win as never, true);
    const handler = getIpcHandler('to:window:fullscreen');

    handler(fakeIpcEvent());
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true);

    handler(fakeIpcEvent());
    expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
  });

  it('ignores IPC events whose sender does not match this window (sender-scoping)', () => {
    // Each ipcMain.on listener is process-global, so on macOS where
    // multiple BrowserWindows can exist, IPC traffic from window B
    // would otherwise drive window A's minimize/maximize/etc. The
    // sender-id mismatch must bail before any window action runs.
    const win = makeMockWindow(/* senderId */ 1);
    new AppWindow(win as never, true);
    getIpcHandler('to:window:minimize')(fakeIpcEvent(/* senderId */ 999));
    getIpcHandler('to:window:close')(fakeIpcEvent(/* senderId */ 999));
    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });

  it('removes its IPC listeners when the window emits `closed` (no leak across recreation)', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    const beforeRemove = (ipcMain.removeListener as jest.Mock).mock.calls
      .length;
    win.fireWindowOnce('closed');
    const afterRemove = (ipcMain.removeListener as jest.Mock).mock.calls.length;
    // One removeListener per registered channel (7 total: minimize,
    // maximize, close, fullscreen, cut, copy, paste).
    expect(afterRemove - beforeRemove).toBe(7);
  });

  it('emits from:window:state on the maximize event', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    win.fireEvent('maximize');
    expect(win.webContents.send).toHaveBeenCalledWith('from:window:state', {
      isMaximized: true,
    });
  });

  it('emits from:window:state on the unmaximize event', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    win.fireEvent('unmaximize');
    expect(win.webContents.send).toHaveBeenCalledWith('from:window:state', {
      isMaximized: false,
    });
  });

  it('hydrates the renderer with the current maximize state on did-finish-load', () => {
    const win = makeMockWindow();
    win.isMaximized.mockReturnValue(true);
    new AppWindow(win as never, true);
    win.fireWebContentsOnce('did-finish-load');
    expect(win.webContents.send).toHaveBeenCalledWith('from:window:state', {
      isMaximized: true,
    });
  });

  it('drops IPC calls when the window is already destroyed', () => {
    const win = makeMockWindow();
    win.isDestroyed.mockReturnValue(true);
    new AppWindow(win as never, true);

    getIpcHandler('to:window:minimize')(fakeIpcEvent());
    getIpcHandler('to:window:maximize')(fakeIpcEvent());
    getIpcHandler('to:window:close')(fakeIpcEvent());
    getIpcHandler('to:window:fullscreen')(fakeIpcEvent());

    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it('does not register IPC handlers when constructed without auto-register', () => {
    const win = makeMockWindow();
    const before = (ipcMain.on as jest.Mock).mock.calls.length;
    new AppWindow(win as never); // register = false (default)
    const after = (ipcMain.on as jest.Mock).mock.calls.length;
    expect(after).toBe(before);
  });
});
