import {
  app,
  Menu,
  type MenuItemConstructorOptions,
  type BrowserWindow,
} from 'electron';
import { AppStorage } from './AppStorage';
import { initMainProviders } from '../util';

/**
 * AppMenu
 */
export class AppMenu {
  /** The browser window */
  private context: BrowserWindow;

  /** Providers */
  private providers = initMainProviders; 

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
    const recentSubmenu = this.buildRecentSubmenu();

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
            label: 'Open Recent',
            submenu: recentSubmenu,
          },
          {
            label: 'Clear All Recent',
            click: () => {
              this.providers.state?.clearRecent();
            },
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
  public buildTrayContextMenu(context: BrowserWindow) {
    return Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          app.focus();
          context.maximize();
        },
      },
      { label: 'Open Recent', submenu: this.buildRecentSubmenu() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ]);
  }

  /**
   * Build the recent items submenu
   * @returns
   */
  private buildRecentSubmenu() {
    const items: MenuItemConstructorOptions[] = [];
    const entries = this.providers.state?.getRecent() || [];
    if (entries.length === 0) {
      items.push({ label: 'No Recent', enabled: false });
    } else {
      for (const e of entries) {
        items.push({
          label: `${e.label}${e.type === 'folder' ? '/' : ''}`.trim(),
          click: () => {
            try {
              const url = new URL(e.uri);
              let p = decodeURIComponent(url.pathname);
              if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) {
                p = p.slice(1);
              }
              AppStorage.openPath(this.context, p);
            } catch {
              // ignore
            }
          },
        });
      }
    }

    return items;
  }
}
