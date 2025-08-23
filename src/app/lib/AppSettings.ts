import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { normalize } from 'path';
import type { BrowserWindow } from 'electron';
import type { EditorSettings } from '../interfaces/Settings';
import type { Providers } from '../interfaces/Providers';

/**
 * AppSettings
 */
export class AppSettings {
  /** The browser window */
  private context: BrowserWindow;

  /** Application settings dir path */
  private appPath: string;

  /** Application settings file path */
  private filePath: string;

  /** Providers to provide functions to the settings */
  private providers: Providers = {
    logger: null,
  };

  /** Default editor settings */
  private settings: EditorSettings = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: true,
  };

  /** Applied editor settings */
  public applied: EditorSettings | null = null;

  /**
   * Create a new app settings handler.
   *
   * @param context - the browser window
   * @returns
   */
  constructor(context: BrowserWindow) {
    this.context = context;
    this.appPath = normalize(homedir() + '/.mkeditor/');
    this.filePath = this.appPath + 'settings.json';

    this.createFileIfNotExists(this.settings);

    this.applied = this.loadFile() as EditorSettings;
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
   * Load settings file.
   * @returns - the settings
   */
  loadFile() {
    const file = readFileSync(this.filePath, {
      encoding: 'utf-8',
    });

    return JSON.parse(file);
  }

  /**
   * Create the settings file if it doesn't exist.
   *
   * @param settings - the settings to save
   * @returns
   */
  createFileIfNotExists(settings: EditorSettings) {
    if (!existsSync(this.appPath)) {
      mkdirSync(this.appPath);
    }

    if (!existsSync(this.filePath)) {
      settings = { ...this.settings, ...settings };
      this.saveSettingsToFile(settings, true);
    }
  }

  /**
   * Save current settings to the settings file.
   *
   * @param settings - the settings to save
   * @param init - first-time init
   * @returns
   */
  saveSettingsToFile(settings: EditorSettings, init = false) {
    try {
      writeFileSync(this.filePath, JSON.stringify(settings, null, 4), {
        encoding: 'utf-8',
      });

      if (!init) {
        this.context.webContents.send('from:notification:display', {
          status: 'success',
          message: 'Settings successfully updated.',
        });
      }
    } catch (err) {
      const detail = err as { code: string };
      const message =
        detail.code === 'EPERM'
          ? 'Unable to save settings: permission denied.'
          : 'Unable to save settings: unknown error.';

      this.providers.logger?.log.error(message, err);

      this.context.webContents.send('from:notification:display', {
        status: 'error',
        message,
      });
    }
  }
}
