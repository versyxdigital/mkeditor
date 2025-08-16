import {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log/main';
import { homedir } from 'os';
import { join, normalize } from 'path';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { iconBase64 } from './assets/icon';

// Configure app logger
log.transports.file.resolvePathFn = () => {
  return join(normalize(homedir()), '.mkeditor/main.log');
};
log.initialize();

// Configure auto-updater
autoUpdater.logger = log;
autoUpdater.autoDownload = true;

let context: BrowserWindow | null;

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

/** --------------------App Lifecycle ---------------------------- */

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

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
  log.info('changes');
  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }
  main(file);
});

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall();
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
  } else if (file && file !== '.' && !file.startsWith('-')) {
    AppStorage.setActiveFile(context, file);
  }
});

app.on('window-all-closed', () => {
  app.clearRecentDocuments();
  app.quit();
});
