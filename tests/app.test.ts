// Importing main must never truncate the developer's real application log
// or restore a real session. Simulate an unwritable previous log as well.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  writeFileSync: jest.fn(() => {
    throw new Error('read-only log');
  }),
  promises: {
    ...jest.requireActual('fs').promises,
    stat: jest.fn().mockResolvedValue({ isFile: () => true }),
  },
}));

jest.mock('electron', () => {
  const actual = jest.requireActual('electron');
  return {
    ...actual,
    shell: { ...actual.shell, openPath: jest.fn().mockResolvedValue('') },
  };
});

jest.mock('electron-log/main', () => ({
  transports: { file: {} },
  initialize: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('electron-updater', () => ({
  autoUpdater: {
    on: jest.fn(),
    checkForUpdatesAndNotify: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../src/app/lib/AppSession', () => ({
  AppSession: {
    load: jest.fn(() => null),
    buildRestoreEnvelope: jest.fn(() => ({
      session: null,
      missing: [],
      contents: {},
    })),
  },
}));

jest.mock('../src/app/lib/AppBridge', () => ({
  AppBridge: jest.fn().mockImplementation(() => ({
    provide: jest.fn(),
    register: jest.fn(),
    restoreSession: jest.fn(async (enabled) =>
      enabled
        ? require('../src/app/lib/AppSession').AppSession.buildRestoreEnvelope(
            require('../src/app/lib/AppSession').AppSession.load(),
          )
        : { session: null, missing: [], contents: {} },
    ),
    flushSession: jest.fn(async () => true),
    confirmFailedSession: jest.fn(() => false),
    promptUserBeforeQuit: jest.fn(),
    pushAssistantConfig: jest.fn(),
    pushPersistedConversations: jest.fn(),
  })),
}));

jest.mock('../src/app/lib/AppMenu', () => ({
  AppMenu: jest.fn().mockImplementation(() => ({
    provide: jest.fn(),
    register: jest.fn(),
    buildTrayContextMenu: jest.fn(() => ({})),
    wireRendererCommandBridge: jest.fn(),
  })),
}));

jest.mock('../src/app/lib/AppWindow', () => ({
  AppWindow: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
  })),
}));

jest.mock('../src/app/lib/AppSettings', () => ({
  AppSettings: jest.fn().mockImplementation(() => ({
    applied: { systemtheme: true, darkmode: false },
    provide: jest.fn(),
    loadFile: jest.fn(() => ({ systemtheme: true, darkmode: false })),
  })),
}));

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: {
    setActiveFile: jest.fn(),
    openActiveFile: jest.fn(),
    openPath: jest.fn(),
    assertInWorkspace: jest.fn().mockRejectedValue(new Error('No workspace')),
    setWorkspaceRoot: jest.fn(),
    offerWorkspaceRoot: jest.fn(() => true),
  },
}));

// AppAssistant loads the ESM-only `ai` package, which Jest's CommonJS
// runtime can't require.
jest.mock('../src/app/lib/AppAssistant', () => ({
  AppAssistant: jest.fn(),
}));

import { app, BrowserWindow, nativeTheme, shell, protocol } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';
import { promises as fs } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

async function drainLinkOperations() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

let windowsBeforeReady: number;
let startupWarnings: unknown[][];

beforeAll(() => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  require('../src/app/main');
  startupWarnings = [...warning.mock.calls];
  warning.mockRestore();
});

beforeEach(() => {
  const constructors = BrowserWindow as unknown as jest.Mock;
  const previous = constructors.mock.results.at(-1)?.value;
  previous?.on.mock.calls.find(
    ([event]: [string]) => event === 'closed',
  )?.[1]();
  constructors.mockClear();
  (AppBridge as unknown as jest.Mock).mockClear();
  (nativeTheme.on as jest.Mock).mockClear();
  (AppStorage.openActiveFile as jest.Mock).mockClear();
  (AppStorage.offerWorkspaceRoot as jest.Mock)
    .mockReset()
    .mockReturnValue(true);
  (AppSession.load as jest.Mock).mockReset().mockReturnValue(null);
  (AppSession.buildRestoreEnvelope as jest.Mock).mockReset().mockReturnValue({
    session: null,
    missing: [],
    contents: {},
  });
  const openFile = app.on.mock.calls.find(
    ([event]: [string]) => event === 'open-file',
  )[1];
  app.isReady.mockReturnValueOnce(false);
  openFile({ preventDefault: jest.fn() }, '/notes/queued.md');
  windowsBeforeReady = (BrowserWindow as unknown as jest.Mock).mock.calls
    .length;
  const readyHandler = app.on.mock.calls.find(
    ([event]: [string]) => event === 'ready',
  )[1];
  readyHandler();
});

describe('Electron main app', () => {
  it('creates main window on ready', () => {
    expect(windowsBeforeReady).toBe(0);
    expect(BrowserWindow).toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(startupWarnings).toContainEqual([
      'Unable to truncate the previous MKEditor log.',
      expect.any(Error),
    ]);
  });

  it('subscribes to nativeTheme.on("updated") so live OS theme switches propagate without a relaunch', () => {
    // The suite setup ran main(), which registers the listener.
    expect(nativeTheme.on).toHaveBeenCalledWith(
      'updated',
      expect.any(Function),
    );
  });

  it('did-finish-load sends from:theme:set with the OS value (regression for stale-darkmode bug)', async () => {
    // The previous code sent `settings.applied?.darkmode` (the stale
    // stored value) when systemtheme was on/off — combined with the
    // renderer's `if (shouldUseDarkMode)` guard, that meant the OS
    // light state never propagated and the user remained in dark
    // mode after switching the OS to light. Now we always push the
    // current OS theme; the renderer stores it as `osDarkmode` and
    // computes the effective rendered theme from systemtheme + that.
    const winInstance = (BrowserWindow as unknown as jest.Mock).mock.results[0]
      ?.value;
    const onCalls = (winInstance.webContents.on as jest.Mock).mock.calls;
    const didFinishLoad = onCalls.find(
      (c: unknown[]) => c[0] === 'did-finish-load',
    );
    expect(didFinishLoad).toBeDefined();
    await (didFinishLoad![1] as () => Promise<void>)();

    const sendCalls = (winInstance.webContents.send as jest.Mock).mock.calls;
    const themeSet = sendCalls.find(
      (c: unknown[]) => c[0] === 'from:theme:set',
    );
    expect(themeSet).toBeDefined();
    // Mock has nativeTheme.shouldUseDarkColors === false, so we expect
    // the OS push to carry `false` (light).
    expect(themeSet![1]).toBe(nativeTheme.shouldUseDarkColors);
    expect(AppStorage.openActiveFile).toHaveBeenCalledWith(
      winInstance,
      '/notes/queued.md',
    );
  });

  it.each(['nested/notes.MD', '../other.md'])(
    'resolves second-instance argument %s against that instance working directory',
    (argument) => {
      const handler = app.on.mock.calls.find(
        ([event]: [string]) => event === 'second-instance',
      )[1];
      const directory = join(tmpdir(), 'second instance workspace');
      handler({}, ['mkeditor.exe', '--ignore.md', argument], directory);
      expect(AppStorage.openActiveFile).toHaveBeenLastCalledWith(
        expect.anything(),
        resolve(directory, argument),
      );
      expect(app.focus).toHaveBeenCalled();
    },
  );

  it('preserves absolute second-instance paths and ignores flags and non-Markdown arguments', () => {
    const handler = app.on.mock.calls.find(
      ([event]: [string]) => event === 'second-instance',
    )[1];
    const file = join(tmpdir(), 'native docs', 'notes.md');
    handler({}, ['mkeditor.exe', file], join(tmpdir(), 'another cwd'));
    expect(AppStorage.openActiveFile).toHaveBeenLastCalledWith(
      expect.anything(),
      file,
    );
    (AppStorage.openActiveFile as jest.Mock).mockClear();
    handler({}, ['mkeditor.exe', '--ignore.md', 'notes.txt'], tmpdir());
    expect(AppStorage.openActiveFile).not.toHaveBeenCalled();
  });

  it('opens the filename passed by a native open-file event in the existing window', () => {
    const handler = app.on.mock.calls.find((c: any) => c[0] === 'open-file')[1];
    handler({ preventDefault: jest.fn() }, '/notes/native.md');
    expect(AppStorage.openActiveFile).toHaveBeenLastCalledWith(
      expect.anything(),
      '/notes/native.md',
    );
  });

  it('offers a main-generated restored workspace before sending it to the renderer', async () => {
    const win = (BrowserWindow as unknown as jest.Mock).mock.results[0].value;
    const loaded = win.webContents.on.mock.calls.find(
      ([name]: [string]) => name === 'did-finish-load',
    )[1];
    const envelope = {
      session: {
        version: 2,
        tabs: [],
        activeFile: null,
        workspaceRoot: '/restored/notes',
      },
      missing: [],
      contents: {},
    };
    (AppSession.buildRestoreEnvelope as jest.Mock).mockReturnValueOnce(
      envelope,
    );
    (AppStorage.offerWorkspaceRoot as jest.Mock).mockClear();
    win.webContents.send.mockClear();
    await loaded();
    expect(AppStorage.offerWorkspaceRoot).toHaveBeenCalledWith(
      '/restored/notes',
      true,
    );
    const sendIndex = win.webContents.send.mock.calls.findIndex(
      ([name]: [string]) => name === 'from:session:restore',
    );
    expect(
      (AppStorage.offerWorkspaceRoot as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(win.webContents.send.mock.invocationCallOrder[sendIndex]);
    expect(win.webContents.send).toHaveBeenCalledWith(
      'from:session:restore',
      envelope,
    );
  });

  it('drops an unavailable restored root rather than authorising it from renderer input', async () => {
    const win = (BrowserWindow as unknown as jest.Mock).mock.results[0].value;
    const loaded = win.webContents.on.mock.calls.find(
      ([name]: [string]) => name === 'did-finish-load',
    )[1];
    (AppSession.buildRestoreEnvelope as jest.Mock).mockReturnValueOnce({
      session: {
        version: 2,
        tabs: [],
        activeFile: null,
        workspaceRoot: '/unavailable',
      },
      missing: [],
      contents: {},
    });
    (AppStorage.offerWorkspaceRoot as jest.Mock).mockReturnValueOnce(false);
    await loaded();
    expect(win.webContents.send).toHaveBeenCalledWith('from:session:restore', {
      session: { version: 2, tabs: [], activeFile: null, workspaceRoot: null },
      missing: [],
      contents: {},
    });
  });

  it('restricts OS link launches to supported external protocols', () => {
    const win = (BrowserWindow as unknown as jest.Mock).mock.results[0].value;
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    (shell.openExternal as jest.Mock).mockClear();
    for (const url of [
      'file:///tmp/executable',
      'javascript:alert(1)',
      'custom:run',
      'invalid',
    ]) {
      expect(handler({ url })).toEqual({ action: 'deny' });
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  describe('workspace links from the Markdown preview', () => {
    function linkHandler() {
      const owner = (BrowserWindow as unknown as jest.Mock).mock.results[0]
        .value;
      return {
        owner,
        open: owner.webContents.setWindowOpenHandler.mock.calls[0][0],
      };
    }

    beforeEach(() => {
      (AppStorage.assertInWorkspace as jest.Mock).mockReset();
      (AppStorage.openPath as jest.Mock).mockClear();
      (shell.openPath as jest.Mock).mockClear();
      (shell.openExternal as jest.Mock).mockClear();
      (fs.stat as jest.Mock).mockResolvedValue({ isFile: () => true });
      linkHandler().owner.isDestroyed.mockReturnValue(false);
    });

    it('decodes a local Markdown URL and opens it in its owning editor after validation', async () => {
      const path = join(process.cwd(), 'notes', 'with spaces.md');
      (AppStorage.assertInWorkspace as jest.Mock).mockResolvedValue(path);
      const { owner, open } = linkHandler();
      expect(open({ url: pathToFileURL(path).href })).toEqual({
        action: 'deny',
      });
      expect(AppStorage.openPath).not.toHaveBeenCalled();
      await drainLinkOperations();
      expect(AppStorage.assertInWorkspace).toHaveBeenCalledWith(path);
      expect(AppStorage.openPath).toHaveBeenCalledWith(owner, path);
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it.each(['pdf', 'png', 'html', 'txt'])(
      'opens an allowed workspace .%s file through the OS path helper',
      async (extension) => {
        const path = join(process.cwd(), 'notes', `asset.${extension}`);
        (AppStorage.assertInWorkspace as jest.Mock).mockResolvedValue(path);
        linkHandler().open({ url: pathToFileURL(path).href });
        await drainLinkOperations();
        expect(shell.openPath).toHaveBeenCalledWith(path);
        expect(shell.openExternal).not.toHaveBeenCalled();
        expect(AppStorage.openPath).not.toHaveBeenCalled();
      },
    );

    it('rejects a link outside the workspace without launching a browser or file', async () => {
      const path = join(process.cwd(), 'outside.pdf');
      (AppStorage.assertInWorkspace as jest.Mock).mockRejectedValue(
        new Error('outside workspace'),
      );
      linkHandler().open({ url: pathToFileURL(path).href });
      await drainLinkOperations();
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(AppStorage.openPath).not.toHaveBeenCalled();
    });

    it('checks the canonical target extension so an allowed alias cannot launch an executable', async () => {
      const alias = join(process.cwd(), 'notes', 'shortcut.pdf');
      (AppStorage.assertInWorkspace as jest.Mock).mockResolvedValue(
        join(process.cwd(), 'notes', 'program.exe'),
      );
      linkHandler().open({ url: pathToFileURL(alias).href });
      await drainLinkOperations();
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(AppStorage.openPath).not.toHaveBeenCalled();
    });

    it('does not launch a directory named with an allowed extension', async () => {
      const path = join(process.cwd(), 'notes', 'folder.pdf');
      (AppStorage.assertInWorkspace as jest.Mock).mockResolvedValue(path);
      (fs.stat as jest.Mock).mockResolvedValue({ isFile: () => false });
      linkHandler().open({ url: pathToFileURL(path).href });
      await drainLinkOperations();
      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('does not dispatch a delayed local link after the owning window closes', async () => {
      const path = join(process.cwd(), 'notes', 'delayed.md');
      let validate!: (path: string) => void;
      (AppStorage.assertInWorkspace as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          validate = resolve;
        }),
      );
      const { owner, open } = linkHandler();
      open({ url: pathToFileURL(path).href });
      owner.isDestroyed.mockReturnValue(true);
      validate(path);
      await drainLinkOperations();
      expect(AppStorage.openPath).not.toHaveBeenCalled();
      owner.isDestroyed.mockReturnValue(false);
    });
  });

  it('uses the correct native menu and window chrome for the host platform', () => {
    // Regression: setting the application menu to `null` on Win/Linux
    // (previous behaviour) killed Electron's accelerator dispatch
    // entirely, so the keybindings the in-window TitleBar advertises
    // had no effect. The fix installs the menu but suppresses the
    // bar UI — verified here via the two surfaces involved.
    const ctorOpts = (BrowserWindow as unknown as jest.Mock).mock.calls[0]?.[0];
    expect(ctorOpts).toMatchObject(
      process.platform === 'darwin'
        ? {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 12, y: 12 },
          }
        : { frame: false, autoHideMenuBar: true },
    );
    const winInstance = (BrowserWindow as unknown as jest.Mock).mock.results[0]
      ?.value;
    expect(winInstance?.setMenuBarVisibility.mock.calls).toEqual(
      process.platform === 'darwin' ? [] : [[false]],
    );
  });

  it('waits for one checkpoint when closing, keeps the window after failure and permits a later successful close', async () => {
    const win = (BrowserWindow as unknown as jest.Mock).mock.results[0].value;
    win.close = jest.fn();
    const bridge = (AppBridge as unknown as jest.Mock).mock.results[0].value;
    let finish!: (ok: boolean) => void;
    bridge.flushSession.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const close = win.on.mock.calls.find(
      ([event]: [string]) => event === 'close',
    )[1];
    const event = { defaultPrevented: false, preventDefault: jest.fn() };
    const callsBefore = bridge.flushSession.mock.calls.length;
    close(event);
    close(event);
    expect(bridge.flushSession).toHaveBeenCalledTimes(callsBefore + 1);
    expect(win.close).not.toHaveBeenCalled();
    finish(false);
    await drainLinkOperations();
    expect(bridge.confirmFailedSession).toHaveBeenCalledTimes(1);
    expect(win.close).not.toHaveBeenCalled();
    close(event);
    await drainLinkOperations();
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it.each(['win32', 'linux', 'darwin'] as const)(
    'exercises %s window chrome regardless of the test host',
    (platform) => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
      try {
        Object.defineProperty(process, 'platform', {
          ...original,
          value: platform,
        });
        const ready = app.on.mock.calls.find(
          ([event]: [string]) => event === 'ready',
        )[1];
        ready();
        const options = (BrowserWindow as unknown as jest.Mock).mock.calls.at(
          -1,
        )![0];
        const window = (BrowserWindow as unknown as jest.Mock).mock.results.at(
          -1,
        )!.value;
        expect(options).toMatchObject(
          platform === 'darwin'
            ? {
                titleBarStyle: 'hiddenInset',
                trafficLightPosition: { x: 12, y: 12 },
              }
            : { frame: false, autoHideMenuBar: true },
        );
        expect(window.setMenuBarVisibility.mock.calls).toEqual(
          platform === 'darwin' ? [] : [[false]],
        );
      } finally {
        Object.defineProperty(process, 'platform', original);
      }
    },
  );
});

it('removes the old window protocol route before a later window can register it again', () => {
  const constructors = BrowserWindow as unknown as jest.Mock;
  const win = constructors.mock.results.at(-1)!.value;
  const windowsBefore = constructors.mock.calls.length;
  const routesBefore = (protocol.handle as jest.Mock).mock.calls.length;
  (protocol.unhandle as jest.Mock).mockClear();
  const closed = win.on.mock.calls.find(
    ([event]: [string]) => event === 'closed',
  )[1];
  closed();
  expect(protocol.unhandle).toHaveBeenCalledWith('mked');
  const activate = app.on.mock.calls.find(
    ([event]: [string]) => event === 'activate',
  )[1];
  activate();
  expect(constructors.mock.calls).toHaveLength(windowsBefore + 1);
  expect(protocol.handle).toHaveBeenCalledTimes(routesBefore + 1);
});
