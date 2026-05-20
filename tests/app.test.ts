jest.mock('../src/app/lib/AppBridge', () => ({
  AppBridge: jest.fn().mockImplementation(() => ({
    provide: jest.fn(),
    register: jest.fn(),
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
  },
}));

import { app, BrowserWindow, nativeTheme } from 'electron';

describe('Electron main app', () => {
  it('creates main window on ready', () => {
    require('../src/app/main');
    const readyHandler = app.on.mock.calls.find(
      (c: any) => c[0] === 'ready',
    )[1];
    readyHandler();
    expect(BrowserWindow).toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('subscribes to nativeTheme.on("updated") so live OS theme switches propagate without a relaunch', () => {
    // The 'ready' handler in the first test created the window and
    // ran `main()`, which registers the listener. Verify it landed.
    expect(nativeTheme.on).toHaveBeenCalledWith(
      'updated',
      expect.any(Function),
    );
  });

  it('did-finish-load sends from:theme:set with the OS value (regression for stale-darkmode bug)', () => {
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
    (didFinishLoad![1] as () => void)();

    const sendCalls = (winInstance.webContents.send as jest.Mock).mock.calls;
    const themeSet = sendCalls.find(
      (c: unknown[]) => c[0] === 'from:theme:set',
    );
    expect(themeSet).toBeDefined();
    // Mock has nativeTheme.shouldUseDarkColors === false, so we expect
    // the OS push to carry `false` (light).
    expect(themeSet![1]).toBe(nativeTheme.shouldUseDarkColors);
  });

  it('hides the menu bar on non-darwin (frameless window + setMenuBarVisibility(false)) so the in-window TitleBar is the only menu UI but accelerators still fire', () => {
    // Regression: setting the application menu to `null` on Win/Linux
    // (previous behaviour) killed Electron's accelerator dispatch
    // entirely, so the keybindings the in-window TitleBar advertises
    // had no effect. The fix installs the menu but suppresses the
    // bar UI — verified here via the two surfaces involved.
    // (Mock's process.platform is whatever Jest is running on; on
    // non-darwin we should see both signals, on darwin neither.)
    if (process.platform === 'darwin') return;
    const ctorOpts = (BrowserWindow as unknown as jest.Mock).mock.calls[0]?.[0];
    expect(ctorOpts).toMatchObject({
      frame: false,
      autoHideMenuBar: true,
    });
    const winInstance = (BrowserWindow as unknown as jest.Mock).mock.results[0]
      ?.value;
    expect(winInstance?.setMenuBarVisibility).toHaveBeenCalledWith(false);
  });
});
