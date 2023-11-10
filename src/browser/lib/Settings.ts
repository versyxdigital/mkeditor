import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorSettings } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { settings } from '../config';
import { dom } from '../dom';

type ValidSetting = keyof typeof settings;

export class Settings {
  
  public mode: 'web' | 'desktop' = 'web';
  
  public model: editor.IStandaloneCodeEditor;

  public dispatcher: EditorDispatcher;

  public settings: EditorSettings = settings;

  constructor (
    mode: 'web' | 'desktop' = 'web',
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
    register = false
  ) {
    this.mode = mode;
    this.model = model;
    this.dispatcher = dispatcher;

    this.loadSettings();

    if (register) {
      this.registerDOMListeners();
    }
  }

  setAppMode (mode: 'web' | 'desktop') {
    this.mode = mode;
  }

  getSettings () {
    return this.settings;
  }

  getDefaultSettings () {
    return settings;
  }

  setSettings (settings: EditorSettings) {
    this.settings = settings;
  }

  setSetting (key: string, value: boolean) {
    this.settings[key as ValidSetting] = value;
  }

  setDefaultSettings () {
    this.settings = settings;
  }

  loadSettings () {
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

  loadSettingsFromLocalStorage () {
    const storage = localStorage.getItem('mkeditor-settings');
    if (storage) {
      const settings = (JSON.parse(storage) as EditorSettings);
      this.setSettings(settings);
    } else {
      this.setDefaultSettings();
      this.updateSettingsInLocalStorage();
    }
  }

  updateSettingsInLocalStorage () {
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify(this.settings)
    );
  }

  registerDOMListeners () {
    const toggler = dom.settings;
    this.registerAutoIndentChangeListener(toggler.autoindent);
    this.registerDarkModeChangeListener(toggler.darkmode);
    this.registerMinimapChangeListener(toggler.minimap);
    this.registerWordWrapChangeListener(toggler.wordwrap);
    this.registerWhitespaceChangeListener(toggler.whitespace);
    this.registerSystemThemeOverrideChangeListener(toggler.systemtheme);

    this.setUIState();
  }

  registerAutoIndentChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('autoindent', target.checked);
      this.setAudoIndent();
      this.persist();
    });

    return this;
  }

  setAudoIndent () {
    this.model.updateOptions({
      autoIndent: this.settings.autoindent ? 'advanced' : 'none'
    });

    return this;
  }

  registerDarkModeChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('darkmode', target.checked);
      this.setTheme();
      this.persist();
    });

    return this;
  }

  setTheme () {
    document.body.setAttribute('data-theme', this.settings.darkmode ? 'dark' : 'light');
    editor.setTheme(
      this.settings.darkmode ? 'vs-dark' : 'vs'
    );

    return this;
  }

  registerMinimapChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('minimap', target.checked);
      this.setMinimap();
      this.persist();
    });

    return this;
  }

  setMinimap () {
    this.model.updateOptions({
      minimap: { enabled: this.settings.minimap }
    });

    return this;
  }

  registerWordWrapChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('wordwrap', target.checked);
      this.setWordWrap();
      this.persist();
    });

    return this;
  }

  setWordWrap () {
    this.model.updateOptions({
      wordWrap: this.settings.wordwrap ? 'on' : 'off'
    });

    return this;
  }

  registerWhitespaceChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('whitespace', target.checked);
      this.setWhitespace();
      this.persist();
    });

    return this;
  }

  setWhitespace () {
    this.model.updateOptions({
      renderWhitespace: this.settings.whitespace ? 'all' : 'none'
    });

    return this;
  }

  registerSystemThemeOverrideChangeListener (handler: Element) {
    handler.addEventListener('click', (event) => {
      const target = <HTMLInputElement>event.target;
      this.setSetting('systemtheme', target.checked);
      this.setSystemThemeOverride();
      this.persist();
    });

    return this;
  }

  setSystemThemeOverride () {
    // handled by the bridge
    return this;
  }

  setUIState () {
    const { settings } = dom;
    settings.autoindent.checked = this.settings.autoindent;
    settings.darkmode.checked = this.settings.darkmode;
    settings.minimap.checked = this.settings.minimap;
    settings.wordwrap.checked = this.settings.wordwrap;
    settings.whitespace.checked = this.settings.whitespace;
    settings.systemtheme.checked = this.settings.systemtheme;
  }

  persist () {
    this.setUIState();
    if (this.mode === 'web') this.updateSettingsInLocalStorage();
    else this.dispatcher.bridgeSettings({ settings: this.settings });
  }
}