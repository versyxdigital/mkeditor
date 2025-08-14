import {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'path';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { iconBase64 } from './assets/icon';

let context: BrowserWindow | null;
let updaterInitialized = false;

function notify(status: 'info' | 'success' | 'error', message: string) {
  if (context && !context.isDestroyed()) {
    context.webContents.send('from:notification:display', { status, message });
  }
}

function initAutoUpdaterOnce() {
  if (updaterInitialized) return;
  updaterInitialized = true;

  // Silent background download; install when user quits
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Event wiring
  autoUpdater.on('checking-for-update', () => {
    notify('info', 'Checking for updates…');
  });

  autoUpdater.on('update-available', (info) => {
    notify(
      'info',
      `Update ${info.version} found. Downloading in the background…`,
    );
  });

  autoUpdater.on('update-not-available', () => {
    notify('success', `You’re on the latest version (${app.getVersion()}).`);
  });

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent);
    if (pct > 0 && pct < 100) notify('info', `Downloading update… ${pct}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    notify(
      'success',
      `Update ${info.version} is ready. It will install when you exit.`,
    );
    // If you ever want immediate install:
    // autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    notify('error', `Updater error: ${err?.message || 'Unknown error'}`);
  });
}

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

  context.webContents.on('will-navigate', (event) => event.preventDefault());
  context.loadFile(join(__dirname, '../index.html'));

  // const dialog = new Dialog(context);
  const settings = new AppSettings(context);

  const bridge = new AppBridge(context);
  bridge.provide('settings', settings);
  bridge.register();

  const menu = new AppMenu(context);
  menu.register();

  const tray = new Tray(nativeImage.createFromDataURL(iconBase64()));
  tray.setContextMenu(menu.buildTrayContextMenu(context));
  tray.setToolTip('MKEditor');
  tray.setTitle('MKEditor');

  initAutoUpdaterOnce();
  autoUpdater.checkForUpdates().catch(() => {});

  context.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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

      if (file && file !== '.' && !file.startsWith('-')) {
        AppStorage.setActiveFile(context, file);
      }
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

// MacOS - open with... Also handle files using the same runnning instance
app.on('open-file', (event) => {
  event.preventDefault();
  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }

  if (!context) {
    main(file);
  } else if (file && file !== '.' && !file.startsWith('-')) {
    AppStorage.setActiveFile(context, file);
  }
});

app.on('ready', () => {
  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }
  main(file);
});

app.on('activate', () => {
  if (!context) {
    main();
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (event, args) => {
    app.focus();
    if (args.length >= 2) {
      const file: string = args[2];
      if (
        file &&
        file !== '.' &&
        !file.startsWith('-') &&
        file.indexOf('MKEditor.lnk') === -1 &&
        context
      ) {
        AppStorage.setActiveFile(context, file);
      }
    }
  });
}

app.on('window-all-closed', () => {
  app.clearRecentDocuments();
  app.quit();
});
