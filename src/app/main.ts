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
import { join, normalize } from 'path';
import { AppAssistant } from './lib/AppAssistant';
import { AppBridge } from './lib/AppBridge';
import { AppMenu } from './lib/AppMenu';
import { AppSession } from './lib/AppSession';
import { AppSettings } from './lib/AppSettings';
import { AppStorage } from './lib/AppStorage';
import { AppWindow } from './lib/AppWindow';
import { runQuitFlush } from './lib/quitFlush';
import { iconBase64 } from './assets/icon';
import type { LogConfig } from './interfaces/Logging';

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
  // Pick the window chrome per platform. Windows + Linux become frameless
  // so the renderer's `<TitleBar>` can draw the logo, menu bar, and 
  // window-control buttons. macOS keeps the native traffic lights via 
  // `titleBarStyle: 'hiddenInset'` and continues to use the system menu 
  // bar — `trafficLightPosition` nudges the buttons down so they align 
  // with the title row P3 will tune.
  const isMac = process.platform === 'darwin';
  let chrome: Electron.BrowserWindowConstructorOptions;
  if (isMac) {
    chrome = {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
    };
  } else {
    // Windows + Linux: frameless so the renderer-drawn `<TitleBar>`
    // owns the chrome; `autoHideMenuBar` is belt-and-braces (some
    // window managers — and certain Electron versions on Linux —
    // can still try to render a menu strip inside the client area
    // even when `frame: false` should suppress it). The Electron
    // application menu IS still installed (see AppMenu.register())
    // so global accelerators like Ctrl+S keep working; only the
    // menu bar UI is suppressed.
    chrome = { frame: false, autoHideMenuBar: true };
  }
  context = new BrowserWindow({
    show: false,
    icon: join(__dirname, 'assets/icon.ico'),
    ...chrome,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });
  // Hard-suppress the menu bar on Windows + Linux. With
  // `autoHideMenuBar` alone, pressing Alt can momentarily reveal the
  // menu (a default Electron UX) which would conflict with the
  // TitleBar's own Alt-to-focus-first-menu handling. Explicitly
  // setting visibility to false keeps the menu purely functional
  // (accelerators) without any UI presence.
  if (!isMac) {
    context.setMenuBarVisibility(false);
  }

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

  // Load the main process "bridge" to handle IPC traffic across
  // execution contexts.
  const bridge = new AppBridge(context);
  bridge.provide('settings', settings);
  bridge.provide('logger', logconfig);

  // AI Assistant — service the bridge delegates `to:ai:*` to. The SDK
  // clients and `safeStorage`-encrypted keys live entirely inside this
  // instance; the renderer reaches it only through the IPC surface
  // AppBridge whitelists.
  const assistant = new AppAssistant(context);
  bridge.provide('assistant', assistant);

  bridge.register(); // Register all IPC event listeners

  // Load the electron application menu. macOS uses it for the system
  // menu bar; Windows + Linux install the same template too — even
  // though the menu bar is hidden (see chrome opts above), Electron
  // still dispatches accelerators (Ctrl+S, Ctrl+O, etc.) from it, so
  // the keybindings the in-window `<TitleBar>` advertises actually
  // work.
  const menu = new AppMenu(context);
  menu.provide('logger', logconfig);
  menu.register(); // Register all menu items
  // Renderer's in-window TitleBar menu reaches main-process commands
  // (open-log, toggle-devtools) through this IPC channel — same
  // dispatch table the native macOS menu uses.
  menu.wireRendererCommandBridge();

  // Window-control IPC + maximize-state emitter. The renderer's title
  // bar sends `to:window:minimize/maximize/close` here; `from:window:state`
  // hydrates the renderer with the initial maximize state on did-finish-load
  // and replays on every maximize/unmaximize.
  const window = new AppWindow(context, true);
  void window; // referenced to keep the instance alive alongside `context`

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

      const sessionEnabled = settings.applied?.sessionRestore ?? true;
      context.webContents.send(
        'from:session:restore',
        sessionEnabled
          ? AppSession.buildRestoreEnvelope(AppSession.load())
          : { session: null, missing: [], contents: {} },
      );

      // Hydrate the renderer with the sanitized AI Assistant config.
      // The payload exposes per-provider `hasKey: boolean` only —
      // never the key value. AssistantManager uses this to decide
      // which provider tabs to show.
      bridge.pushAssistantConfig();

      // Hydrate the renderer with persisted conversation history.
      // Goes second (after config) so AssistantManager exists and is
      // wired before `restore()` is called from the channel handler.
      bridge.pushPersistedConversations();

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

/**
 * Final session flush on quit. Asks the renderer to send one last
 * `to:session:save` (so the at-quit cursor position of the active tab
 * lands on disk), waits up to ~250 ms for it to arrive, and then
 * proceeds with quit either way. The renderer's debounced save covers
 * everything else, so a missed ack just means the very last cursor
 * movement isn't persisted — not data loss.
 */
let isFlushingSession = false;
app.on('before-quit', (event) => {
  if (isFlushingSession) return; // second pass after our own app.quit()
  if (!context || context.isDestroyed()) return;

  event.preventDefault();
  isFlushingSession = true;

  // Two flush requests fan out in parallel — session (FileManager
  // tabs + cursor) and AI conversations. We resolve when BOTH ack
  // OR the 250ms safety timeout fires. Missing one ack just costs
  // a few hundred ms of unpersisted activity, not data loss; the
  // renderer's debounced saves cover everything else. Logic lives
  // in `quitFlush.ts` so it can be unit-tested without spinning up
  // Electron's app lifecycle.
  runQuitFlush({
    on: (channel, listener) => ipcMain.on(channel, listener),
    off: (channel, listener) => ipcMain.removeListener(channel, listener),
    send: (channel, payload) => {
      if (!context || context.isDestroyed()) return;
      // `from:session:flush-request` historically went without a
      // payload; preserve that signature for the renderer.
      if (payload === undefined) context.webContents.send(channel);
      else context.webContents.send(channel, payload);
    },
    onDone: () => app.quit(),
  });
});

app.on('window-all-closed', () => {
  app.clearRecentDocuments(); // TODO get recent documents working or remove
  app.quit();
});
