import { ContextBridgeAPI } from '../../interfaces/Bridge';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorSettings } from '../../interfaces/Editor';

/**
 * Handle bridge settings logic.
 */
export class BridgeSettings {
  constructor(
    private bridge: ContextBridgeAPI,
    private model: editor.IStandaloneCodeEditor,
  ) {}

  /** Send a save settings request across the bridge */
  public saveSettingsToFile(settings: EditorSettings) {
    this.bridge.send('to:settings:save', { settings });
  }

  /** Load settings for the editor model */
  public loadSettingsFromStorageChannel(settings: EditorSettings) {
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
