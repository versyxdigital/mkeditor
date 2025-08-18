const app = {
  on: jest.fn(),
  once: jest.fn(),
  isReady: jest.fn(() => true),
  getName: jest.fn(() => 'mkeditor'),
  getVersion: jest.fn(() => '0.0.0'),
  getPath: jest.fn(),
  isPackaged: false,
  quit: jest.fn(),
  focus: jest.fn(),
  requestSingleInstanceLock: jest.fn(() => true),
  clearRecentDocuments: jest.fn(),
};

const BrowserWindow = jest.fn().mockImplementation((opts) => {
  return {
    loadFile: jest.fn(),
    webContents: {
      on: jest.fn(),
      loadFile: jest.fn(),
      setWindowOpenHandler: jest.fn(),
      send: jest.fn(),
    },
    on: jest.fn(),
    maximize: jest.fn(),
    show: jest.fn(),
    setTitle: jest.fn(),
  };
});

const nativeImage = {
  createFromDataURL: jest.fn(() => ({})),
};

const nativeTheme = {
  shouldUseDarkColors: false,
};

const shell = {
  openExternal: jest.fn(),
};

class Tray {
  constructor() {
    this.setContextMenu = jest.fn();
    this.setToolTip = jest.fn();
    this.setTitle = jest.fn();
  }
}

const dialog = {
  showMessageBoxSync: jest.fn(),
  showOpenDialog: jest.fn(),
  showSaveDialog: jest.fn(),
};

const ipcMain = {
  on: jest.fn(),
  handle: jest.fn(),
};

const protocol = {
  registerSchemesAsPrivileged: jest.fn(),
  handle: jest.fn(),
};

module.exports = {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
  dialog,
  ipcMain,
  protocol,
};
