import {
  app,
  BrowserWindow,
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
import { join, normalize, dirname } from 'path';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { iconBase64 } from './assets/icon';
import type { LogConfig } from './interfaces/Logging';
import { AppState } from './lib/AppState';
import { getPathFromUrl } from './util';

/** --------------------App Logging------------------------------- */

// Set the log path
const logpath = join(normalize(homedir()), '.mkeditor/main.log');

// Truncate the log file
if (existsSync(logpath)) {
  writeFileSync(logpath, '');
}

// Configure the logger
log.transports.file.resolvePathFn = () => logpath;
log.transports.file.level = 'info'; // TODO make this a setting
log.initialize();

// Define log config to pass to app handlers
const logconfig: LogConfig = { log, logpath };

/** --------------------Auto Updates------------------------------ */

// Configure the auto-update
// NOTE: This does not work for MacOS without code signing and
// other bits... Mac users stuck on manual downloads for now.
autoUpdater.logger = log;
autoUpdater.autoDownload = true;

/** --------------------Custom Protocol--------------------------- */

// Register the mked:// protocol scheme for opening linked
// markdown documents in new tabs from within the editor.
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

/** --------------------App Entry--------------------------------- */

let context: BrowserWindow | null;

/**
 * Main entry point for MKEditor app.
 *
 * @param file - present if we are opening the app from a file
 */
function main(file: string | null = null) {
  // Create a new browser window
  context = new BrowserWindow({
    show: false,
    icon: join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  // Load the editor frontend
  context.loadFile(join(__dirname, '../index.html'));

  // Prevent navigation to links within the BrowserWindow.
  context.webContents.on('will-navigate', (event) => event.preventDefault());

  // Create settings handler for editor settings
  const settings = new AppSettings(context, logconfig);

  // Create app state handler for managing recent items
  const state = new AppState(context, logconfig);
  state.setEnabled(settings.getSetting('recentItemsEnabled') ?? true);

  // Provide singleton access to state handler
  AppStorage.setState(state);

  // Create app menu handler and build menu items
  const menu = new AppMenu(context, state, logconfig);

  // Rebuild menu items when state changes (e.g. recent items)
  state.onDidStateChange(() => menu.register());

  // Create app bridge handler for IPC traffic management
  const bridge = new AppBridge(context, settings, state, logconfig);

  // Configure the app system tray icon
  const tray = new Tray(nativeImage.createFromDataURL(iconBase64()));
  tray.setContextMenu(menu.buildTrayContextMenu(context));
  tray.setToolTip('MKEditor');
  tray.setTitle('MKEditor');

  // Register the mked:// protocol handler
  protocol.handle('mked', (request) => {
    bridge.handleMkedUrl(request.url);
    return new Response('');
  });

  // Set the window open handler for HTTP(S) URLs.*
  context.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // On finished frontend loading, set the editor theme and settings,
  // and set the active file (untitled new file if no file open).
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

      // Restore last opened folder/file if configured and no file was directly requested
      if (
        !file ||
        (file.trim() === '.' &&
          settings.getSetting('recentItemsEnabled') === true)
      ) {
        const recents = state.getRecent();
        const top = recents[0];

        if (top) {
          try {
            if (top.type === 'folder') {
              // Open the most recent folder only
              const folderPath = getPathFromUrl(top.uri);
              AppStorage.openPath(context, folderPath);
            } else {
              // Open the most recent file and the last opened folder
              const filePath = getPathFromUrl(top.uri);
              const lastFolderEntry = recents.find((e) => e.type === 'folder');
              const folderPath = lastFolderEntry
                ? getPathFromUrl(lastFolderEntry.uri)
                : dirname(filePath);

              // Open the folder first so the file remains most recent
              if (folderPath) AppStorage.openPath(context, folderPath);
              AppStorage.openPath(context, filePath);
            }
          } catch (e) {
            log.error('Unable to restore from recent entries', e);
          }
        } else {
          AppStorage.openActiveFile(context, file);
        }
      } else {
        AppStorage.openActiveFile(context, file);
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

// If the app is already running then handle it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, args) => {
    app.focus();
    // If user has opened the app via a file, then set active file.
    if (args.length >= 2) {
      const filepath = args.find((arg) => arg.toLowerCase().endsWith('.md'));
      if (context && filepath) AppStorage.openPath(context, filepath);
    }
  });
}

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
  let file: string | null = null;
  if (process.platform === 'win32' && process.argv.length >= 2) {
    file = process.argv[1];
  }
  main(file);
});

autoUpdater.on('update-available', async (event) => {
  context?.webContents.send('from:notification:display', {
    status: 'info',
    key: 'notifications:update_available',
    values: { version: event.version },
  });
});

autoUpdater.on('update-downloaded', async (event) => {
  context?.webContents.send('from:notification:display', {
    status: 'success',
    key: 'notifications:update_downloaded',
    values: { version: event.version },
  });
});

// Mainly MacOS...
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
    AppStorage.openActiveFile(context, file);
  }
});

app.on('window-all-closed', () => {
  app.clearRecentDocuments(); // TODO get recent documents working or remove
  app.quit();
});
