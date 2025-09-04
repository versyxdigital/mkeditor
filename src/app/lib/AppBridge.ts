import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { dirname, resolve } from 'path';
import type { Logger, LogMessage } from '../interfaces/Logging';
import { AppStorage } from './AppStorage';
import { initMainProviders, normalizeLanguage } from '../util';
/**
 * AppBridge
 */
export class AppBridge {
  /** The browser window */
  private context: BrowserWindow;

  /** The browser window title */
  private contextWindowTitle: string = 'MKEditor';

  /** Flag to determine whether content has changed */
  private editorContentHasChanged: boolean = false;

  /** Providers */
  private providers = initMainProviders;

  /**
   * Create a new AppBridge instance to manage IPC traffic.
   *
   * @param context - the browser window
   * @param register - register all IPC listeners immediately
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
   * Register all IPC event listeners.
   * @returns
   */
  register() {
    // Enable logging from the renderer context
    ipcMain.on('log', (_e, { level, msg, meta }: LogMessage) => {
      const logger = this.providers.logger?.log;
      if (!logger) return;

      if (
        level !== 'error' &&
        level !== 'warn' &&
        level !== 'info' &&
        level !== 'debug'
      ) {
        return;
      }

      (logger as Logger)[level](msg, meta);
    });

    // Set the app window title
    ipcMain.on('to:title:set', (event, title = null) => {
      this.contextWindowTitle = title ? `MKEditor - ${title}` : 'MKEditor';
      this.setWindowTitle();
    });

    // Set the editor state to track content changes in the main process.
    ipcMain.on('to:editor:state', (event, hasChanged: boolean) => {
      this.editorContentHasChanged = hasChanged;
      this.setWindowTitle();
    });

    // Save editor settings to file (~/.mkeditor/settings.json)
    ipcMain.on('to:settings:save', (event, { settings }) => {
      this.providers.settings?.saveSettingsToFile(settings);
    });

    // Export rendered HTML, triggered from the renderer process
    ipcMain.on('to:html:export', (event, { content }) => {
      AppStorage.saveFile(this.context, {
        id: event.sender.id,
        data: content,
        encoding: 'utf-8',
      });
    });

    // Export rendered HTML to PDF
    ipcMain.on('to:pdf:export', async (event, { content }) => {
      const offscreen = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true },
      });

      AppStorage.saveFileToPDF(this.context, offscreen, {
        id: event.sender.id,
        data: content,
        encoding: 'utf-8',
      });
    });

    // Create a new file, linked to the application menu
    ipcMain.on('to:file:new', () => {
      AppStorage.createNewFile(this.context).then(() => {
        this.setWindowTitle();
      });
    });

    // Open a new file, forwarded from the renderer process
    // via received from:file:open event.
    ipcMain.on('to:file:open', () => {
      AppStorage.showOpenDialog(this.context);
    });

    ipcMain.on('to:folder:open', () => {
      AppStorage.openDirectory(this.context);
    });

    ipcMain.on(
      'to:file:openpath',
      (_, { path, recent }: { path: string; recent?: boolean }) => {
        AppStorage.openPath(this.context, path, recent !== false);
      },
    );

    // Save an existing file, this is also used by the renderer bridge "from:file:open" listener, if
    // editor content changes are detected by logic in the renderer process, the renderer bridge will
    // submit a save event to this channel with prompt and fromOpen both defined, otherwise it'll just
    // submit an open event directly to the "to:file:open" channel instead.
    ipcMain.on(
      'to:file:save',
      async (
        event,
        {
          content,
          file,
          prompt = false,
          fromOpen = false,
          openPath = null,
          openFile = true,
        },
      ) => {
        if (await this.promptUserConfirmSave(this.context, prompt)) {
          AppStorage.saveFile(this.context, {
            id: event.sender.id,
            data: content,
            filePath: file,
            encoding: 'utf-8',
            openFile,
          }).then(() => {
            if (openPath) {
              AppStorage.openPath(this.context, openPath);
            } else if (fromOpen) {
              AppStorage.showOpenDialog(this.context);
            }

            this.setWindowTitle();
          });
        } else {
          if (openPath) {
            AppStorage.openPath(this.context, openPath);
          } else if (fromOpen) {
            AppStorage.showOpenDialog(this.context);
          }
        }
      },
    );

    // Save as event, doesn't require checks on "activeFile",
    // this will simply just call AppStorage save and triger
    // the dialog for the user to save the file to the location
    // of their choice.
    ipcMain.on('to:file:saveas', (event, data) => {
      AppStorage.saveFile(this.context, {
        id: event.sender.id,
        data,
        encoding: 'utf-8',
      }).then(() => {
        this.setWindowTitle();
      });
    });

    ipcMain.on('to:file:create', async (_e, { parent, name }) => {
      await AppStorage.createFile(this.context, parent, name);
    });

    ipcMain.on('to:folder:create', async (_e, { parent, name }) => {
      await AppStorage.createFolder(this.context, parent, name);
    });

    ipcMain.on('to:file:rename', async (_e, { path, name }) => {
      await AppStorage.renamePath(this.context, path, name);
    });

    ipcMain.on('to:file:delete', async (_e, { path }) => {
      await AppStorage.deletePath(this.context, path);
    });

    ipcMain.on('to:file:properties', async (event, { path }) => {
      const info = await AppStorage.getPathProperties(path);
      event.sender.send('from:path:properties', info);
    });

    // Recent: clear list
    ipcMain.on('to:recent:clear', () => {
      try {
        this.providers.state?.clearRecent();
      } catch (e) {
        this.providers.logger?.log.error('[to:recent:clear]', e);
      }
    });

    // mked:// protocol handlers
    ipcMain.on('mked:get-active-file', (event) => {
      event.returnValue = AppStorage.getActiveFilePath();
    });

    // Provide app locale to renderer
    ipcMain.on('mked:get-locale', (event) => {
      const locale =
        this.providers.settings?.getSetting('locale') ??
        normalizeLanguage(app.getLocale());
      event.returnValue = locale;
    });

    // Provide path resolution through IPC to avoid having to set
    // nodeIntegration to true.
    ipcMain.handle('mked:path:dirname', (_e, p: string) => dirname(p));
    ipcMain.handle('mked:path:resolve', (_e, base: string, rel: string) =>
      resolve(base, rel),
    );

    ipcMain.on('mked:open-url', (_e, url: string) => {
      try {
        this.handleMkedUrl(url);
      } catch (e) {
        this.providers.logger?.log.error('[mked:open-url]', e);
      }
    });

    // Broadcast language changes to the renderer
    ipcMain.on('to:i18n:set', (_e, lng: string) => {
      try {
        this.context.webContents.send('from:i18n:set', lng);
      } catch (e) {
        this.providers.logger?.log.error('[to:i18n:set]', e);
      }
    });
  }

  /**
   * Handle an mked:// URL
   *
   * @param url - the URL
   * @returns
   */
  handleMkedUrl(url: string) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'open') {
        const path = parsed.searchParams.get('path');
        AppStorage.openActiveFile(this.context, path);
      }
    } catch {
      this.providers.logger?.log.error(
        `Malformed path to linked document: ${url}`,
      );
    }
  }

  /**
   * Prompt the user to save.
   *
   * @param context - the browser window
   * @param shouldShowPrompt - disable if true
   * @returns
   */
  async promptUserConfirmSave(context: BrowserWindow, shouldShowPrompt = true) {
    if (!shouldShowPrompt) {
      return true;
    }

    const check = await dialog.showMessageBox(context, {
      type: 'question',
      buttons: ['Yes', 'No'],
      title: 'Save changes',
      message: 'Would you like to save changes to your existing file?',
    });

    return check.response === 0;
  }

  /**
   * Prompt the user to save before quitting the app.
   *
   * @param event - the trigger event
   * @returns
   */
  promptUserBeforeQuit(event: Event) {
    if (this.editorContentHasChanged) {
      return this.displayPrompt(
        event,
        'Confirm',
        'You have unsaved changes, are you sure you want to quit?',
      );
    }
  }

  /**
   * Display a user prompt dialog.
   *
   * @param event - the trigger event
   * @param title - the prompt title
   * @param message - the prompt message
   * @returns
   */
  displayPrompt(event: Event, title: string, message: string) {
    const choice = dialog.showMessageBoxSync(this.context, {
      type: 'question',
      buttons: ['Yes', 'No'],
      title,
      message,
    });

    if (choice) {
      event.preventDefault();
    }
  }

  /**
   * Set the app window title.
   * @returns
   */
  private setWindowTitle() {
    const suffix = this.editorContentHasChanged ? ' *' : '';
    this.context.setTitle(`${this.contextWindowTitle}${suffix}`);
  }
}
