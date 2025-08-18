import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log/main';
import { existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, normalize, resolve } from 'path';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { iconBase64 } from './assets/icon';

// Set the log path
const logPath = join(normalize(homedir()), '.mkeditor/main.log');

// Truncate the log file
if (existsSync(logPath)) {
  writeFileSync(logPath, '');
}

// Configure the logger
log.transports.file.resolvePathFn = () => logPath;
log.transports.file.level = 'info';
log.initialize();

// Configure auto-updater
autoUpdater.logger = log;
autoUpdater.autoDownload = true;

let context: BrowserWindow | null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mked',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      allowServiceWorkers: false,
    },
  },
]);

ipcMain.handle('mked:path:dirname', (_e, p: string) => dirname(p));
ipcMain.handle('mked:path:resolve', (_e, base: string, rel: string) =>
  resolve(base, rel),
);

ipcMain.on('mked:open-url', (_e, url: string) => {
  try {
    handleMkedUrl(url);
  } catch (e) {
    log.error('[mked:open-url]', e);
  }
});

/**
 * Main entry point for MKEditor app.
 *
 * @param file - present if we are opening the app from a file
 */
function main(file: string | null = null) {
  context = new BrowserWindow({
    show: false,
    icon: join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  context.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mked://')) {
      event.preventDefault();
      handleMkedUrl(url);
    } else {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  context.loadFile(join(__dirname, '../index.html'));

  const settings = new AppSettings(context);

  const bridge = new AppBridge(context);
  bridge.provide('settings', settings);
  bridge.register();

  const menu = new AppMenu(context, logPath);
  menu.register();

  const tray = new Tray(nativeImage.createFromDataURL(iconBase64()));
  tray.setContextMenu(menu.buildTrayContextMenu(context));
  tray.setToolTip('MKEditor');
  tray.setTitle('MKEditor');

  context.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mked://')) {
      handleMkedUrl(url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  context.webContents.on('did-finish-load', () => {
    if (context) {
      if (settings.applied && settings.applied.systemtheme) {
        context.webContents.send(
          'from:theme:set',
          nativeTheme.shouldUseDarkColors,
        );
      } else {
        context.webContents.send('from:theme:set', settings.applied?.darkmode);
      }

      context.webContents.send('from:settings:set', settings.loadFile());

      openActiveFile(file);
    }
  });

  context.on('close', (event) => {
    bridge.promptUserBeforeQuit(<Event>event);
  });

  context.on('closed', () => {
    context = null;
  });

  context.maximize();
  context.show();
}

function openActiveFile(file: string | null) {
  if (
    context &&
    file &&
    file !== '.' &&
    !file.startsWith('-') &&
    file.indexOf('MKEditor.lnk') === -1
  ) {
    AppStorage.setActiveFile(context, file);
  }
}

function handleMkedUrl(url: string) {
  try {
    const parsed = new URL(url);
    console.log({ parsed });
    if (parsed.hostname === 'open') {
      const path = parsed.searchParams.get('path');
      openActiveFile(path);
    }
  } catch {
    // ignore malformed URLs
  }
}

/** --------------------App Lifecycle ---------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (event, args) => {
    app.focus();
    if (args.length >= 2) {
      openActiveFile(args[2]);
    }
  });
}

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();

  protocol.registerStringProtocol('mked', ({ url }, callback) => {
    handleMkedUrl(url);
    callback('');
  });

  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }
  main(file);
});

autoUpdater.on('update-available', async (event) => {
  if (context) {
    context.webContents.send('from:notification:display', {
      status: 'info',
      message: `Update ${event.version} is available, downloading in the background...`,
    });
  }
});

autoUpdater.on('update-downloaded', async (event) => {
  if (context) {
    context.webContents.send('from:notification:display', {
      status: 'success',
      message: `Update ${event.version} has been downloaded, restart to update.`,
    });
  }
});

app.on('activate', () => {
  if (!context) {
    main();
  }
});

// MacOS - open with... Also handle files using the same runnning instance
app.on('open-file', (event) => {
  event.preventDefault();
  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }

  if (!context) {
    main(file);
  } else {
    openActiveFile(file);
  }
});

app.on('window-all-closed', () => {
  app.clearRecentDocuments();
  app.quit();
});
