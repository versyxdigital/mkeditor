import type { EditorDispatcher } from '../../events/EditorDispatcher';
import type { ExportSettings } from '../../interfaces/Editor';
import { exportSettings as defaults } from '../../config';
import { dom } from '../../dom';

export class ExportSettingsProvider {
  private mode: 'web' | 'desktop' = 'web';
  private dispatcher: EditorDispatcher;
  private settings: ExportSettings = defaults;
  private registered = false;

  constructor(mode: 'web' | 'desktop', dispatcher: EditorDispatcher) {
    this.mode = mode;
    this.dispatcher = dispatcher;
    this.loadSettings();
    this.registerDOMListeners();
  }

  public getDefaultSettings() {
    return defaults;
  }

  public getSettings() {
    return this.settings;
  }

  public setSettings(settings: ExportSettings) {
    this.settings = settings;
    this.setUIState();
  }

  private loadSettings() {
    if (this.mode === 'web') {
      const storage = localStorage.getItem('mkeditor-export-settings');
      if (storage) {
        this.settings = JSON.parse(storage) as ExportSettings;
      } else {
        this.updateSettingsInLocalStorage();
      }
    }
    this.setUIState();
  }

  public setUIState(reset = false) {
    const { exports: ex } = dom;
    if (!ex) return;

    const settings = reset ? defaults : this.settings;

    ex.withStyles.checked = settings.withStyles;
    ex.container.value = settings.container;
    ex.fontSize.value = settings.fontSize?.toString();
    ex.lineSpacing.value = settings.lineSpacing?.toString();
    ex.background.value = settings.background;
  }

  public registerDOMListeners() {
    if (this.registered) return;
    this.registered = true;
    const { exports: ex, buttons } = dom;
    ex.withStyles.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.settings.withStyles = target.checked;
      const toolbar = buttons.save.styled as HTMLInputElement;
      if (toolbar) toolbar.checked = target.checked;
      this.persist();
    });
    ex.container.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.settings.container = target.value as 'container' | 'container-fluid';
      this.persist();
    });
    ex.fontSize.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.settings.fontSize = parseInt(target.value, 10);
      this.persist();
    });
    ex.lineSpacing.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.settings.lineSpacing = parseFloat(target.value);
      this.persist();
    });
    ex.background.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      this.settings.background = target.value;
      this.persist();
    });
    const toolbar = buttons.save.styled as HTMLInputElement;
    if (toolbar) {
      toolbar.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.settings.withStyles = target.checked;
        ex.withStyles.checked = target.checked;
        this.persist();
      });
    }
  }

  private updateSettingsInLocalStorage() {
    localStorage.setItem(
      'mkeditor-export-settings',
      JSON.stringify(this.settings),
    );
  }

  private persist() {
    this.setUIState();
    if (this.mode === 'web') {
      this.updateSettingsInLocalStorage();
    } else {
      this.dispatcher.bridgeSettings({
        settings: { exportSettings: this.settings },
      });
    }
  }
}
