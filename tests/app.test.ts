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
});
