import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorSettings, ValidSetting } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { settings } from '../config';
import { dom } from '../dom';

export class Settings {
  /** Execution mode */
  private mode: 'web' | 'desktop' = 'web';

  /** Editor model instance */
  private model: editor.IStandaloneCodeEditor;

  /** Editor event dispatcher */
  private dispatcher: EditorDispatcher;

  /** Editor settings */
  private settings: EditorSettings = settings;

  /** Editor theme */
  private theme: 'light' | 'dark' = 'light';

  /**
   * Create a new editor settings handler.
   */
  public constructor(
    mode: 'web' | 'desktop' = 'web',
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
  ) {
    this.mode = mode;
    this.model = model;
    this.dispatcher = dispatcher;

    this.loadSettings();

    this.registerDOMListeners();
  }

  /**
   * Sets the app execution mode.
   *
   * @param mode - the execution mode
   */
  public setAppMode(mode: 'web' | 'desktop') {
    this.mode = mode;
  }

  /**
   * Get the editor settings.
   *
   * @returns - the editor settings
   */
  public getSettings() {
    return this.settings;
  }

  /**
   * Set the editor settings.
   *
   * @param settings - the settings to set
   */
  public setSettings(settings: EditorSettings) {
    this.settings = settings;
  }

  /**
   * Get default editor settings.
   *
   * @returns - the default editor settings
   */
  public getDefaultSettings() {
    return settings;
  }

  /**
   * Set editor settings back to defaults.
   */
  public setDefaultSettings() {
    this.settings = settings;
  }

  /**
   * Set a specific editor setting.
   *
   * @param key - the settings key
   * @param value - the value to set
   */
  public setSetting(key: string, value: boolean) {
    this.settings[key as ValidSetting] = value;
  }

  /**
   * Register DOM event listeners for changes to editor settings.
   */
  public registerDOMListeners() {
    const toggler = dom.settings;
    this.registerAutoIndentChangeListener(toggler.autoindent);
    this.registerDarkModeChangeListener(toggler.darkmode);
    this.registerMinimapChangeListener(toggler.minimap);
    this.registerWordWrapChangeListener(toggler.wordwrap);
    this.registerWhitespaceChangeListener(toggler.whitespace);
    this.registerSystemThemeOverrideChangeListener(toggler.systemtheme);

    this.setUIState();
  }

  /**
   * Set the UI state of the editor settings handlers.
   */
  public setUIState() {
    const { settings, icons } = dom;

    if (this.mode === 'web') {
      settings.fileinfo.style.display = 'none';
      const systemThemeToggle = settings.systemtheme.parentElement;
      if (systemThemeToggle) {
        systemThemeToggle.style.display = 'none';
      }
    }

    for (const k of Object.keys(settings)) {
      const key = k as ValidSetting;
      if (key !== 'darkmode') {
        settings[key].checked = this.settings[key];
      }
    }

    settings.darkmode.checked = this.theme === 'dark';
    if (this.mode !== 'web') {
      settings.darkmode.disabled = this.settings.systemtheme;
    }

    if (this.theme === 'dark') {
      icons.darkmode.classList.remove('text-dark');
      icons.darkmode.classList.add('text-warning');
    } else {
      icons.darkmode.classList.remove('text-warning');
      icons.darkmode.classList.add('text-dark');
    }
  }

  /**
   * Load the editor settings.
   */
  private loadSettings() {
    if (this.mode === 'web') {
      this.loadSettingsFromLocalStorage();
    }

    this.setTheme()
      .setAudoIndent()
      .setMinimap()
      .setWhitespace()
      .setWordWrap()
      .setSystemThemeOverride();
  }

  /**
   * Loads editor settings from local storage for web execution context.
   */
  private loadSettingsFromLocalStorage() {
    const storage = localStorage.getItem('mkeditor-settings');
    if (storage) {
      const settings = JSON.parse(storage) as EditorSettings;
      this.setSettings(settings);
    } else {
      this.setDefaultSettings();
      this.updateSettingsInLocalStorage();
    }
  }

  /**
   * Updates editor settings in local storage for web execution context.
   */
  private updateSettingsInLocalStorage() {
    localStorage.setItem('mkeditor-settings', JSON.stringify(this.settings));
  }

  /**
   * Register the handler for the auto-indent settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerAutoIndentChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('autoindent', target.checked);
      this.setAudoIndent();
      this.persist();
    });

    return this;
  }

  /**
   * Set the auto-indent settings.
   *
   * @returns this
   */
  public setAudoIndent() {
    this.model.updateOptions({
      autoIndent: this.settings.autoindent ? 'advanced' : 'none',
    });

    return this;
  }

  /**
   * Register the handler for the dark-mode settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerDarkModeChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('darkmode', target.checked);
      this.setTheme();
      this.persist();
    });

    return this;
  }

  /**
   * Set the editor theme (light or dark).
   *
   * @returns this
   */
  public setTheme() {
    document.body.setAttribute(
      'data-theme',
      this.settings.darkmode ? 'dark' : 'light',
    );
    editor.setTheme(this.settings.darkmode ? 'vs-dark' : 'vs');

    this.theme = this.settings.darkmode ? 'dark' : 'light';

    return this;
  }

  /**
   * Register the handler for the mini-map settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerMinimapChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('minimap', target.checked);
      this.setMinimap();
      this.persist();
    });

    return this;
  }

  /**
   * Set the mini-map settings.
   *
   * @returns this
   */
  public setMinimap() {
    this.model.updateOptions({
      minimap: { enabled: this.settings.minimap },
    });

    return this;
  }

  /**
   * Register the hanlder for the word-wrap settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerWordWrapChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('wordwrap', target.checked);
      this.setWordWrap();
      this.persist();
    });

    return this;
  }

  /**
   * Set the word-wrap settings.
   *
   * @returns this
   */
  public setWordWrap() {
    this.model.updateOptions({
      wordWrap: this.settings.wordwrap ? 'on' : 'off',
    });

    return this;
  }

  /**
   * Register the hanlder for the whitespace rendering settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerWhitespaceChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('whitespace', target.checked);
      this.setWhitespace();
      this.persist();
    });

    return this;
  }

  /**
   * Set whitespace settings.
   *
   * @returns this
   */
  public setWhitespace() {
    this.model.updateOptions({
      renderWhitespace: this.settings.whitespace ? 'all' : 'none',
    });

    return this;
  }

  /**
   * Register the hanlder for the system theme override settings.
   *
   * @param handler - the handler
   * @returns this
   */
  private registerSystemThemeOverrideChangeListener(handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('systemtheme', target.checked);
      this.setSystemThemeOverride();
      this.persist();
    });

    return this;
  }

  /**
   * Set system theme override settings.
   *
   * @returns this
   */
  public setSystemThemeOverride() {
    dom.settings.darkmode.checked = this.theme === 'dark';

    return this;
  }

  /**
   * Persist configured settings.
   */
  private persist() {
    this.setUIState();
    if (this.mode === 'web') {
      this.updateSettingsInLocalStorage();
    } else {
      this.dispatcher.bridgeSettings({ settings: this.settings });
    }
  }
}
