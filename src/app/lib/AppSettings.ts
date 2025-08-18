import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { normalize } from 'path';
import { BrowserWindow } from 'electron';
import { EditorSettings } from '../interfaces/Settings';
import { Providers } from '../interfaces/Providers';

export class AppSettings {
  private context: BrowserWindow;

  private appPath: string;

  private filePath: string;

  private providers: Providers = {
    logger: null,
  };

  private settings: EditorSettings = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: true,
  };

  public applied: EditorSettings | null = null;

  constructor(context: BrowserWindow) {
    this.context = context;
    this.appPath = normalize(homedir() + '/.mkeditor/');
    this.filePath = this.appPath + 'settings.json';

    this.createFileIfNotExists(this.settings);

    this.applied = this.loadFile() as EditorSettings;
  }

  provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  loadFile() {
    const file = readFileSync(this.filePath, {
      encoding: 'utf-8',
    });

    return JSON.parse(file);
  }

  createFileIfNotExists(settings: EditorSettings) {
    if (!existsSync(this.appPath)) {
      mkdirSync(this.appPath);
    }

    if (!existsSync(this.filePath)) {
      settings = { ...this.settings, ...settings };
      this.saveSettingsToFile(settings, true);
    }
  }

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
