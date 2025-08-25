import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { SettingsFile } from '../interfaces/Editor';

/**
 * Handle bridge settings logic.
 */
export class BridgeSettings {
  /**
   * Create a new bridge settings handler
   *
   * @param bridge - the execution bridge
   * @param mkeditor - the editor instance
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private mkeditor: editor.IStandaloneCodeEditor,
  ) {}

  /**
   * Save settings to the settings file.
   *
   * @param settings - the editor settings
   * @returns
   */
  public saveSettingsToFile(settings: Partial<SettingsFile>) {
    this.bridge.send('to:settings:save', { settings });
  }

  /**
   * Load settings from the from:settings:set channel.
   *
   * @param settings - the settings to load
   * @returns
   */
  public loadSettingsFromBridgeListener(settings: SettingsFile) {
    this.mkeditor.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none',
    });

    this.mkeditor.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off',
    });

    this.mkeditor.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none',
    });

    this.mkeditor.updateOptions({
      minimap: { enabled: settings.minimap },
    });
  }
}
