import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { normalize } from 'path';
import type { BrowserWindow } from 'electron';
import type { SettingsFile } from '../interfaces/Settings';
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
  private settings: SettingsFile = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: true,
    exportSettings: {
      withStyles: true,
      container: 'container-fluid',
      fontSize: 16,
      lineSpacing: 1.5,
      background: '#ffffff',
    },
  };

  /** Applied editor settings */
  public applied: SettingsFile | null = null;

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

    this.applied = this.loadFile() as SettingsFile;
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
  createFileIfNotExists(settings: Partial<SettingsFile>) {
    if (!existsSync(this.appPath)) {
      mkdirSync(this.appPath);
    }

    if (!existsSync(this.filePath)) {
      const s: SettingsFile = {
        ...this.settings,
        ...settings,
        exportSettings: {
          ...this.settings.exportSettings,
          ...(settings.exportSettings || {}),
        },
      };
      this.saveSettingsToFile(s, true);
    }
  }

  /**
   * Save current settings to the settings file.
   *
   * @param settings - the settings to save
   * @param init - first-time init
   * @returns
   */
  saveSettingsToFile(settings: Partial<SettingsFile>, init = false) {
    try {
      const current = this.loadFile() as SettingsFile;
      const updated: SettingsFile = {
        ...current,
        ...settings,
        exportSettings: {
          ...current.exportSettings,
          ...(settings.exportSettings || {}),
        },
      };

      writeFileSync(this.filePath, JSON.stringify(updated, null, 4), {
        encoding: 'utf-8',
      });

      this.applied = updated;

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
