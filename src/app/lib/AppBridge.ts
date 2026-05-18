import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { dirname, resolve } from 'path';
import type { SettingsProviders } from '../interfaces/Providers';
import type { Logger, LogMessage } from '../interfaces/Logging';
import type { SessionPayload } from '../interfaces/Session';
import type {
  CancelRequest,
  ChatRequest,
  ConfigSetRequest,
  KeyClearRequest,
  KeySetRequest,
  OllamaListRequest,
  ToolResultRequest,
} from '../interfaces/Assistant';
import { AppSession } from './AppSession';
import { AppStorage } from './AppStorage';
import { AssistantConfig } from './AssistantConfig';
import { AssistantKeyStore } from './AssistantKeyStore';
import { normalizeLanguage } from '../util';
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

  /** Providers to provide functions to the bridge */
  private providers: SettingsProviders = {
    logger: null,
    settings: null,
    assistant: null,
  };

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

    // Persist the renderer's open-tab / cursor / scroll session. Fired
    // by the renderer's debounced session save trigger (P2) and by the
    // renderer's flush-request handler during quit (P1 stub, P2 real).
    ipcMain.on('to:session:save', (_event, payload: SessionPayload) => {
      AppSession.save(payload);
    });

    // Wipe the persisted session file. Fired by the renderer's
    // "Clear saved session" action in the Settings modal.
    ipcMain.on('to:session:clear', () => {
      AppSession.clear();
      this.context.webContents.send('from:notification:display', {
        status: 'success',
        key: 'notifications:session_cleared',
      });
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

    ipcMain.on('to:file:openpath', (event, { path }: { path: string }) => {
      AppStorage.openPath(this.context, path);
    });

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

    // ---- AI Assistant (P1) ----------------------------------------
    //
    // All `to:ai:*` channels delegate to the AppAssistant service the
    // composition root injects via `provide('assistant', ...)`. Each
    // handler returns silently when no AppAssistant is registered so
    // the bridge degrades gracefully in test contexts.

    ipcMain.on('to:ai:chat', (_e, payload: ChatRequest) => {
      this.providers.assistant?.chat(payload);
    });

    ipcMain.on('to:ai:cancel', (_e, payload: CancelRequest) => {
      this.providers.assistant?.cancel(payload);
    });

    ipcMain.on('to:ai:tool-result', (_e, payload: ToolResultRequest) => {
      this.providers.assistant?.submitToolResult(payload);
    });

    ipcMain.on('to:ai:config:get', () => {
      this.pushAssistantConfig();
    });

    ipcMain.on('to:ai:config:set', (_e, payload: ConfigSetRequest) => {
      AssistantConfig.update(payload);
      this.pushAssistantConfig();
    });

    ipcMain.on('to:ai:key:set', (_e, payload: KeySetRequest) => {
      // The key value lives in `payload.key`; never log it, never echo
      // it back. AssistantKeyStore encrypts via safeStorage. The
      // follow-up config push only carries `hasKey: boolean`.
      AssistantKeyStore.setKey(payload.provider, payload.key);
      this.pushAssistantConfig();
    });

    ipcMain.on('to:ai:key:clear', (_e, payload: KeyClearRequest) => {
      AssistantKeyStore.clearKey(payload.provider);
      this.pushAssistantConfig();
    });

    ipcMain.on('to:ai:ollama:list', (_e, payload: OllamaListRequest) => {
      void this.providers.assistant?.listOllamaModels(payload);
    });
  }

  /**
   * Push the sanitized assistant config to the renderer over
   * `from:ai:config`. Triggered by the `to:ai:config:get` handler, by
   * every config/key mutation, and by main.ts on `did-finish-load` so
   * the renderer hydrates on first paint.
   */
  pushAssistantConfig(): void {
    if (!this.providers.assistant) return;
    try {
      if (this.context.isDestroyed()) return;
      this.context.webContents.send(
        'from:ai:config',
        this.providers.assistant.buildSanitizedConfig(),
      );
    } catch (e) {
      this.providers.logger?.log.error('[from:ai:config]', e);
    }
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
