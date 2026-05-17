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
  isMaximized: jest.Mock<boolean, []>;
  isDestroyed: jest.Mock<boolean, []>;
  on: jest.Mock;
  webContents: {
    send: jest.Mock;
    once: jest.Mock;
  };
  fireEvent: (event: string, ...args: unknown[]) => void;
  fireWebContentsOnce: (event: string, ...args: unknown[]) => void;
}

function makeMockWindow(): MockWindow {
  const eventHandlers = new Map<string, Listener[]>();
  const onceHandlers = new Map<string, Listener[]>();
  return {
    minimize: jest.fn(),
    maximize: jest.fn(),
    unmaximize: jest.fn(),
    close: jest.fn(),
    isMaximized: jest.fn<boolean, []>(() => false),
    isDestroyed: jest.fn<boolean, []>(() => false),
    on: jest.fn((event: string, handler: Listener) => {
      const arr = eventHandlers.get(event) ?? [];
      arr.push(handler);
      eventHandlers.set(event, arr);
    }),
    webContents: {
      send: jest.fn(),
      once: jest.fn((event: string, handler: Listener) => {
        const arr = onceHandlers.get(event) ?? [];
        arr.push(handler);
        onceHandlers.set(event, arr);
      }),
    },
    fireEvent: (event, ...args) => {
      (eventHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
    fireWebContentsOnce: (event, ...args) => {
      (onceHandlers.get(event) ?? []).forEach((h) => h(...args));
    },
  };
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
    getIpcHandler('to:window:minimize')();
    expect(win.minimize).toHaveBeenCalledTimes(1);
  });

  it('to:window:maximize toggles based on current state', () => {
    const win = makeMockWindow();
    win.isMaximized.mockReturnValueOnce(false).mockReturnValueOnce(true);
    new AppWindow(win as never, true);
    const handler = getIpcHandler('to:window:maximize');

    handler();
    expect(win.maximize).toHaveBeenCalledTimes(1);
    expect(win.unmaximize).not.toHaveBeenCalled();

    handler();
    expect(win.unmaximize).toHaveBeenCalledTimes(1);
    expect(win.maximize).toHaveBeenCalledTimes(1);
  });

  it('to:window:close calls context.close', () => {
    const win = makeMockWindow();
    new AppWindow(win as never, true);
    getIpcHandler('to:window:close')();
    expect(win.close).toHaveBeenCalledTimes(1);
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

    getIpcHandler('to:window:minimize')();
    getIpcHandler('to:window:maximize')();
    getIpcHandler('to:window:close')();

    expect(win.minimize).not.toHaveBeenCalled();
    expect(win.maximize).not.toHaveBeenCalled();
    expect(win.unmaximize).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });

  it('does not register IPC handlers when constructed without auto-register', () => {
    const win = makeMockWindow();
    const before = (ipcMain.on as jest.Mock).mock.calls.length;
    new AppWindow(win as never); // register = false (default)
    const after = (ipcMain.on as jest.Mock).mock.calls.length;
    expect(after).toBe(before);
  });
});
