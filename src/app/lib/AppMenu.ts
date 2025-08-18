import { app, BrowserWindow, Menu } from 'electron';
import { BridgeProviders } from '../interfaces/Providers';
import { AppStorage } from './AppStorage';

/**
 * AppMenu
 */
export class AppMenu {
  /** The browser window */
  private context: BrowserWindow;

  /** Providers to provide functions to the menu */
  private providers: BridgeProviders = {
    bridge: null,
    logger: null,
  };

  /**
   * Create a new app menu handler to manage the app menu.
   *
   * @param context - the browser window
   * @param register - register all menu items immediately
   * @returns
   */
  constructor(context: BrowserWindow, register = false) {
    this.context = context;

    if (register) {
      this.register();
    }
  }

  /**
   * Provide access to a provider.
   *
   * @param provider - the provider to access
   * @param instance - the associated provider instance
   * @returns
   */
  provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  /**
   * Register all menu items.
   * @returns
   */
  register() {
    app.applicationMenu = Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'New File...',
            click: () => {
              this.context.webContents.send('from:file:new', 'to:file:new');
            },
            accelerator: process.platform === 'darwin' ? 'Cmd+N' : 'Ctrl+N',
          },
          {
            label: 'Open File...',
            click: () => {
              this.context.webContents.send('from:file:open', 'to:file:open');
            },
            accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
          },
          {
            label: 'Open Folder...',
            click: () => {
              this.context.webContents.send(
                'from:folder:open',
                'to:folder:open',
              );
            },
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Shift+O' : 'Ctrl+Shift+O',
          },
          {
            label: 'Save',
            click: () => {
              this.context.webContents.send('from:file:save', 'to:file:save');
            },
            accelerator: process.platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S',
          },
          {
            label: 'Save As...',
            click: () => {
              this.context.webContents.send(
                'from:file:saveas',
                'to:file:saveas',
              );
            },
            accelerator:
              process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
          },
          { type: 'separator' },
          {
            label: 'Settings...',
            click: () => {
              this.context.webContents.send('from:modal:open', 'settings'); // channel / provider
            },
          },
          {
            label: 'Open Log...',
            click: () => {
              AppStorage.openPath(
                this.context,
                <string>this.providers.logger?.logpath,
              );
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Open Command Palette',
            click: () => {
              this.context.webContents.send('from:command:palette', 'open');
            },
            accelerator: 'F1',
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          {
            label: 'Toggle Developer Tools',
            accelerator: (function () {
              return process.platform === 'darwin'
                ? 'Alt+Command+I'
                : 'Ctrl+Shift+I';
            })(),
            click: () => {
              this.context.webContents.toggleDevTools();
            },
          },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About MKEditor',
            click: () => {
              this.context.webContents.send('from:modal:open', 'about'); // channel / provider
            },
            accelerator: process.platform === 'darwin' ? 'Cmd+/' : 'Ctrl+/',
          },
          {
            label: 'Editor Shortcuts',
            click: () => {
              this.context.webContents.send('from:modal:open', 'shortcuts'); // channel / provider
            },
            accelerator: process.platform === 'darwin' ? 'Cmd+;' : 'Ctrl+;',
          },
        ],
      },
    ]);
  }

  /**
   * Build the context menu for the system tray.
   *
   * @param context - the browser window
   * @returns
   */
  buildTrayContextMenu(context: BrowserWindow) {
    return Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          app.focus();
          context.maximize();
        },
      },
      {
        label: 'Open Recent',
        role: 'recentDocuments',
        submenu: [
          {
            label: 'Clear Recent',
            role: 'clearRecentDocuments',
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);
  }
}
