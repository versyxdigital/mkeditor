jest.mock('../src/app/lib/AppBridge', () => ({
  AppBridge: jest.fn().mockImplementation(() => ({
    provide: jest.fn(),
    register: jest.fn(),
    promptUserBeforeQuit: jest.fn(),
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
    applied: { systemtheme: false },
    provide: jest.fn(),
    loadFile: jest.fn(() => ({})),
  })),
}));

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: { setActiveFile: jest.fn() },
}));

import { app, BrowserWindow } from 'electron';

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
