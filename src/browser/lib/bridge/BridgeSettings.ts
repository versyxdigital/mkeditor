import { ContextBridgeAPI } from '../../interfaces/Bridge';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorSettings } from '../../interfaces/Editor';

/**
 * Handle bridge settings logic.
 */
export class BridgeSettings {
  /**
   * Create a new bridge settings handler
   *
   * @param bridge - the execution bridge
   * @param model - the editor model
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private model: editor.IStandaloneCodeEditor,
  ) {}

  /**
   * Save settings to the settings file.
   *
   * @param settings - the editor settings
   * @returns
   */
  public saveSettingsToFile(settings: EditorSettings) {
    this.bridge.send('to:settings:save', { settings });
  }

  /**
   * Load settings from the from:settings:set channel.
   *
   * @param settings - the settings to load
   * @returns
   */
  public loadSettingsFromBridgeListener(settings: EditorSettings) {
    this.model.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none',
    });

    this.model.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off',
    });

    this.model.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none',
    });

    this.model.updateOptions({
      minimap: { enabled: settings.minimap },
    });
  }
}
