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
import { join, normalize } from 'path';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { iconBase64 } from './assets/icon';
import type { LogConfig } from './interfaces/Logging';
import { AppState } from './lib/AppState';

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

  // Prevent navigation to links within the BrowserWindow. This is usually
  // emitted when a user clicks a link that would cause a full page load.
  // Instead of preventing the app's main window from being redirected, we
  // block it here and then handle links navigation further down below.*
  context.webContents.on('will-navigate', (event) => event.preventDefault());

  // Load the main process settings handler
  const settings = new AppSettings(context);
  settings.provide('logger', logconfig);

  // State should be instantiated here.
  const state = new AppState(context);
  state.provide('logger', logconfig);
  state.setEnabled(settings.getSetting('stateEnabled') ?? false);

  // Load the main process "bridge" to handle IPC traffic across
  // execution contexts.
  const bridge = new AppBridge(context);
  bridge.provide('settings', settings);
  bridge.provide('logger', logconfig);
  bridge.register(); // Register all IPC event listeners

  // Load the electron application menu
  const menu = new AppMenu(context);
  menu.provide('logger', logconfig);
  menu.register(); // Register all menu items

  // Configure the app's tray icon and context menu
  const tray = new Tray(nativeImage.createFromDataURL(iconBase64()));
  tray.setContextMenu(menu.buildTrayContextMenu(context));
  tray.setToolTip('MKEditor');
  tray.setTitle('MKEditor');

  // Register the mked:// protocol for opening linked markdown documents
  // in new tabs from within the editor.*
  protocol.handle('mked', (request) => {
    bridge.handleMkedUrl(request.url);
    return new Response(''); // satisfy the protocol
  });

  // Set the window open handler for HTTP(S) URLs.*
  context.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); // Use the user's default browser
    return { action: 'deny' }; // No new window in main process
  });

  // On finished frotend loading, set the editor theme and settings,
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
      AppStorage.openActiveFile(context, file);
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
  app.on('second-instance', (event, args) => {
    console.log({ event, args });
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
