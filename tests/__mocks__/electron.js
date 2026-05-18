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

// safeStorage mock — used by AssistantKeyStore.
// Tests that exercise the encryption path replace these with jest.fn()
// per-suite. The defaults give a working round-trip via base64 + a
// fixed prefix so jest.requireActual paths still behave sanely.
const safeStorage = {
  isEncryptionAvailable: jest.fn(() => true),
  encryptString: jest.fn((s) => Buffer.from('ENC:' + s, 'utf-8')),
  decryptString: jest.fn((buf) => {
    const text = buf.toString('utf-8');
    return text.startsWith('ENC:') ? text.slice(4) : text;
  }),
};

module.exports = {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  safeStorage,
  shell,
  Tray,
  dialog,
  ipcMain,
  protocol,
};
