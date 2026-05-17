import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import type { BridgeProviders } from '../interfaces/Providers';
import { AppStorage } from './AppStorage';
import {
  menuModel,
  type MenuGroup,
  type MenuItem,
  type MenuAction,
} from './menuModel';

/**
 * AppMenu
 *
 * Builds the Electron application menu from the shared `menuModel`.
 *
 * On macOS the menu lives on the system menu bar and stays in use; on
 * Windows and Linux we set `Menu.setApplicationMenu(null)` so the OS
 * strip disappears — the in-window `<TitleBar>` (added in P2) renders
 * the same model in the renderer.
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
   * Build the Electron menu template from `menuModel` and install it.
   *
   * On Windows + Linux we explicitly clear the application menu — the
   * in-window `<TitleBar>` (P2) is the new home for those entries.
   */
  register() {
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null);
      return;
    }

    const template: MenuItemConstructorOptions[] = menuModel.map((group) =>
      this.buildGroup(group),
    );
    app.applicationMenu = Menu.buildFromTemplate(template);
  }

  private buildGroup(group: MenuGroup): MenuItemConstructorOptions {
    const submenu: MenuItemConstructorOptions[] = [];
    for (const item of group.items) {
      if (item.separatorBefore) {
        submenu.push({ type: 'separator' });
      }
      submenu.push(this.buildItem(item));
    }
    return { label: group.label, submenu };
  }

  private buildItem(item: MenuItem): MenuItemConstructorOptions {
    if (!item.action) {
      return { label: item.label, accelerator: this.resolveAccelerator(item) };
    }
    return this.applyAction(item, item.action);
  }

  /** macOS takes the `darwinAccelerator` override when present; everything
   *  else uses the default `accelerator`. Resolved here at runtime so the
   *  model itself stays platform-agnostic — webpack would otherwise bake
   *  the wrong platform into the renderer bundle. */
  private resolveAccelerator(item: MenuItem): string | undefined {
    if (process.platform === 'darwin' && item.darwinAccelerator) {
      return item.darwinAccelerator;
    }
    return item.accelerator;
  }

  private applyAction(
    item: MenuItem,
    action: MenuAction,
  ): MenuItemConstructorOptions {
    const accelerator = this.resolveAccelerator(item);
    switch (action.kind) {
      case 'role':
        // Intentionally omit `label` — Electron picks the OS default
        // (e.g. "Exit" instead of "Quit" on Windows).
        return {
          role: action.role as MenuItemConstructorOptions['role'],
          accelerator,
        };
      case 'channel': {
        const { channel, payload } = action;
        return {
          label: item.label,
          accelerator,
          click: () => this.context.webContents.send(channel, payload),
        };
      }
      case 'command':
        return {
          label: item.label,
          accelerator,
          click: () => this.runCommand(action.commandId),
        };
    }
  }

  /**
   * Dispatch table for `{ kind: 'command' }` menu actions. Adding a new
   * command means adding both an entry here and a case in the renderer
   * dispatch surface (P2's `to:command:run`).
   */
  private runCommand(commandId: string): void {
    switch (commandId) {
      case 'open-log': {
        const logpath = this.providers.logger?.logpath;
        if (logpath) AppStorage.openPath(this.context, logpath);
        return;
      }
      case 'toggle-devtools':
        this.context.webContents.toggleDevTools();
        return;
      default:
        // Unknown commandId — drop silently rather than throw; the model
        // is the contract and an unknown id is a coding error caught in
        // dev, not a user-visible failure.
        return;
    }
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
