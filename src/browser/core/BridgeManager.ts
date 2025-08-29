import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { FileManager } from './FileManager';
import { FileTreeManager } from './FileTreeManager';
import { BridgeSettings } from './BridgeSettings';
import { registerBridgeListeners } from './BridgeListeners';

/**
 * Bridge handler.
 *
 * This is an orchestrator class for orchestrating operations between
 * the renderer context and the main process.
 */
export class BridgeManager {
  /** Execution context bridge */
  public bridge: ContextBridgeAPI;

  /** Editor instance */
  public mkeditor: editor.IStandaloneCodeEditor;

  /** Editor event dispatcher */
  public dispatcher: EditorDispatcher;

  /** Providers to be accessed through bridge */
  public providers: BridgeProviders = {
    settings: null,
    commands: null,
    completion: null,
    exportSettings: null,
  };

  /** File manager helper */
  private fileManager: FileManager;

  /** File tree helper */
  private fileTreeManager: FileTreeManager;

  /** Settings helper */
  private settings: BridgeSettings;

  /**
   * Create a new bridge handler.
   */
  public constructor(
    bridge: ContextBridgeAPI,
    mkeditor: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
  ) {
    this.bridge = bridge;
    this.mkeditor = mkeditor;
    this.dispatcher = dispatcher;

    this.fileManager = new FileManager(
      this.bridge,
      this.mkeditor,
      this.dispatcher,
    );
    this.fileTreeManager = new FileTreeManager(this.bridge, (path) =>
      this.fileManager.openFileFromPath(path),
    );

    this.settings = new BridgeSettings(this.bridge, this.mkeditor);

    // Register event listeners for events sent through IPC channels.
    registerBridgeListeners(
      this.bridge,
      this.mkeditor,
      this.dispatcher,
      this.providers,
      this.fileManager,
      this.fileTreeManager,
      this.settings,
    );

    // Configure event listener for a settings update event.
    this.dispatcher.addEventListener('editor:bridge:settings', (event) => {
      this.saveSettingsToFile(event.detail);
    });
  }

  /**
   * Provide access to a provider.
   *
   * @param provider - the provider to access
   * @param instance - the associated provider instance
   * @returns
   */
  public provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  /**
   * BridgeSettings wrapper method to save settings to file.
   *
   * @param settings - the settings to save.
   * @returns
   */
  public saveSettingsToFile(settings: Partial<SettingsFile>) {
    this.settings.saveSettingsToFile(settings);
  }

  /**
   * FileManager wrapper method to save content to markdown file.
   * @returns
   */
  public saveContentToFile() {
    this.fileManager.saveContentToFile();
  }

  /**
   * FileManager wrapper method to export preview to HTML file.
   *
   * @param content - the preview HTML content
   * @returns
   */
  public exportToDifferentFormat({
    content,
    type,
  }: {
    content: string;
    type: 'html' | 'pdf';
  }) {
    if (type === 'html') {
      this.fileManager.exportToHTML(content);
    } else {
      this.fileManager.exportToPDF(content);
    }
  }

  /**
   * FileManager wrapper method to send hasChanged over the bridge.
   *
   * @param hasChanged - whether the content has changed
   * @returns
   */
  public sendFileContentHasChanged(hasChanged: boolean) {
    this.fileManager.trackContentHasChanged(hasChanged);
  }
}
