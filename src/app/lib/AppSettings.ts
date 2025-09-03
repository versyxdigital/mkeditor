import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { normalize } from 'path';
import { app, type BrowserWindow } from 'electron';
import type { SettingsFile } from '../interfaces/Settings';
import type { Providers } from '../interfaces/Providers';
import { deepMerge, hasAllKeys, normalizeLanguage } from '../util';

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

  /** Has been newly created with defaults */
  private isNewFile: boolean = false;

  /** Providers to provide functions to the settings */
  private providers: Providers = {
    logger: null,
    state: null
  };

  /** Default editor settings */
  private settings: SettingsFile = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: true,
    scrollsync: true,
    stateEnabled: true,
    launchWithLast: true,
    locale: normalizeLanguage(app.getLocale()),
    exportSettings: {
      withStyles: true,
      container: 'container-fluid',
      fontSize: 16,
      lineSpacing: 1.5,
      background: '#ffffff',
      fontColor: '#212529',
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

    // Create the file if it doesn't exist, then load it.
    this.createFileIfNotExists(this.settings);
    const loaded = this.loadFile() as SettingsFile;

    // Check for settings file integrity
    if (!this.isNewFile && !hasAllKeys(this.settings, loaded)) {
      this.saveSettingsToFile(deepMerge(this.settings, loaded));
    }

    // Set the applied settings for this session.
    this.applied = loaded;
  }

  /**
   * Get the editor settings.
   *
   * @returns - the editor settings
   */
  public getSettings() {
    return this.applied;
  }

  /**
   * Get an editor setting.
   *
   * @param key - the setting key
   * @returns - the setting
   */
  public getSetting<K extends keyof SettingsFile>(key: K) {
    return this.applied?.[key];
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
    try {
      const file = readFileSync(this.filePath, {
        encoding: 'utf-8',
      });

      return JSON.parse(file);
    } catch (err) {
      this.context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:settings_file_corrupted_reset',
      });

      return this.settings;
    }
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
      const config: SettingsFile = {
        ...this.settings,
        ...settings,
        exportSettings: {
          ...this.settings.exportSettings,
          ...(settings.exportSettings || {}),
        },
      };

      this.saveSettingsToFile(config, true);
      this.isNewFile = true;
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
      const base = existsSync(this.filePath)
        ? (this.loadFile() as SettingsFile)
        : this.settings;

      const updated: SettingsFile = {
        ...base,
        ...settings,
        exportSettings: {
          ...base.exportSettings,
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
          key: 'notifications:settings_update_success',
        });
      }
    } catch (err) {
      const detail = err as { code: string };
      const key =
        detail.code === 'EPERM'
          ? 'notifications:unable_save_settings_permission_denied'
          : 'notifications:unable_save_settings_unknown_error';

      this.providers.logger?.log.error(key, err);

      this.context.webContents.send('from:notification:display', {
        status: 'error',
        key,
      });
    }
  }
}
