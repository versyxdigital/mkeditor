import type { EditorDispatcher } from '../../events/EditorDispatcher';
import type { ExportSettings } from '../../interfaces/Editor';
import { exportSettings as defaults } from '../../config';
import { syncPreviewToExportSettings } from '../../util';
import { dom } from '../../dom';

export class ExportSettingsProvider {
  private mode: 'web' | 'desktop' = 'web';
  private dispatcher: EditorDispatcher;
  private settings: ExportSettings = defaults;
  private registered = false;

  private saveTimer: number | null = null;
  private debounceMs = 250;
  private lastPersistedJSON = '';
  private isApplying = false;

  constructor(mode: 'web' | 'desktop', dispatcher: EditorDispatcher) {
    this.mode = mode;
    this.dispatcher = dispatcher;
    this.loadSettings();
    this.registerDOMListeners();
  }

  public getDefaultSettings() {
    return {
      withStyles: true,
      container: 'container-fluid',
      fontSize: 16,
      lineSpacing: 1.5,
      background: '#ffffff',
      fontColor: '#212529',
    } as ExportSettings;
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

  public setUIState() {
    const { exports: ex } = dom;
    if (!ex) return;

    this.isApplying = true;

    const settings = this.settings;

    ex.withStyles.checked = settings.withStyles;
    ex.container.value = settings.container;
    ex.fontSize.value = settings.fontSize?.toString();
    ex.lineSpacing.value = settings.lineSpacing?.toString();
    ex.background.value = settings.background;
    ex.fontColor.value = settings.fontColor;

    this.isApplying = false;

    syncPreviewToExportSettings(settings, dom.preview.dom);
  }

  public registerDOMListeners() {
    if (this.registered) return;
    this.registered = true;
    const { exports: ex, buttons } = dom;

    const persist = () => {
      this.setUIState();
      this.schedule();
    };

    ex.withStyles.addEventListener('change', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLInputElement;
      this.settings.withStyles = target.checked;
      const toolbar = buttons.save.styled as HTMLInputElement;
      if (toolbar) toolbar.checked = target.checked;
      persist();
    });

    ex.container.addEventListener('change', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLSelectElement;
      this.settings.container = target.value as 'container' | 'container-fluid';
      persist();
    });

    ex.fontSize.addEventListener('change', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLInputElement;
      this.settings.fontSize = parseInt(target.value, 10);
      persist();
    });

    ex.lineSpacing.addEventListener('input', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLInputElement;
      this.settings.lineSpacing = parseFloat(target.value);
      this.setUIState();
      this.schedule(400); // slightly longer debounce for slider drag
    });

    ex.background.addEventListener('change', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLInputElement;
      this.settings.background = target.value;
      persist();
    });

    ex.fontColor.addEventListener('change', (e) => {
      if (this.isApplying) return;
      const target = e.target as HTMLInputElement;
      this.settings.fontColor = target.value;
      persist();
    });

    const toolbar = buttons.save.styled as HTMLInputElement;
    if (toolbar) {
      toolbar.addEventListener('change', (e) => {
        if (this.isApplying) return;
        const target = e.target as HTMLInputElement;
        this.settings.withStyles = target.checked;
        ex.withStyles.checked = target.checked;
        persist();
      });
    }
  }

  public updateSettingsInLocalStorage() {
    localStorage.setItem(
      'mkeditor-export-settings',
      JSON.stringify(this.settings),
    );
  }

  /**
   * Schedule an export save delay
   *
   * @param overrideDelay
   */
  private schedule(overrideDelay?: number) {
    const delay = overrideDelay ?? this.debounceMs;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, delay);
  }

  /**
   * Save export settings.
   *
   * @returns
   */
  private save() {
    const nextJSON = JSON.stringify(this.settings);

    if (nextJSON === this.lastPersistedJSON) {
      return;
    }

    if (this.mode === 'web') {
      this.updateSettingsInLocalStorage();
    } else {
      this.dispatcher.bridgeSettings({
        settings: { exportSettings: this.settings },
      });
    }

    this.lastPersistedJSON = nextJSON;
  }
}
