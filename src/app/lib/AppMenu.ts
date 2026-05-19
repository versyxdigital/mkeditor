import {
  app,
  ipcMain,
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
 * On macOS the menu lives on the system menu bar and is visible there.
 * On Windows and Linux the in-window `<TitleBar>` (added in P2) renders
 * the same model — but we still install the Electron application menu
 * so global accelerators (Ctrl+S, Ctrl+O, etc.) keep working. The menu
 * bar itself is suppressed by the BrowserWindow being frameless plus
 * `autoHideMenuBar: true` / `setMenuBarVisibility(false)` in `main.ts`,
 * so the menu is functional-but-invisible and the user only ever sees
 * the renderer-drawn `<TitleBar>` strip.
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
   * Build the Electron menu template from `menuModel` and install it
   * on all platforms.
   *
   * On macOS this populates the system menu bar (the visible UI).
   * On Windows / Linux the menu bar is suppressed (frameless window +
   * `setMenuBarVisibility(false)` in `main.ts`), but the menu itself
   * is still registered so Electron's accelerator dispatcher fires
   * the click handlers when the user presses Ctrl+S / Ctrl+O / etc.
   * Without this the in-window `<TitleBar>` would show keybindings
   * that don't actually do anything.
   */
  register() {
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
   * Dispatch table for `{ kind: 'command' }` menu actions. Public so the
   * renderer-side in-window menu (P2) can reach the same handlers via
   * `to:command:run` — see `wireRendererCommandBridge()` below.
   *
   * Adding a new command means adding an entry here; both the native
   * macOS menu and the in-window menu pick it up for free.
   */
  public runCommand(commandId: string): void {
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
   * Register the `to:command:run` IPC listener so the renderer's
   * in-window menu (P2) can fire main-process commands through the
   * same dispatch table the native macOS menu uses. Called from
   * `main.ts` once per BrowserWindow.
   */
  wireRendererCommandBridge() {
    ipcMain.on('to:command:run', (_event, commandId: string) => {
      this.runCommand(commandId);
    });
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
        // P8 — fires the same `from:assistant:toggle` channel the
        // application menu's View → Toggle Assistant Sidebar uses,
        // which routes through BridgeListeners → UIStateContext
        // `toggleRightSidebarExternal`.
        label: 'Toggle Assistant',
        click: () => {
          if (!context.isDestroyed()) {
            context.webContents.send('from:assistant:toggle');
          }
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
