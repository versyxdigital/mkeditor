import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { registerBridgeListeners } from './BridgeListeners';
import { FileManager } from './FileManager';
import { FileTreeManager } from './FileTreeManager';

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

    // Register event listeners for events sent through IPC channels.
    registerBridgeListeners(
      this.bridge,
      this.mkeditor,
      this.dispatcher,
      this.providers,
      this.fileManager,
      this.fileTreeManager,
    );

    // Configure event listener for a settings update event.
    this.dispatcher.addEventListener('editor:bridge:settings', (event) => {
      this.saveSettingsToFile(event.detail);
    });

    // Configure event listener for a recent items switch event.
    this.dispatcher.addEventListener('editor:recent:enable', (event) => {
      this.bridge.send('to:recent:enable', {
        enabled: event.detail,
      });
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
   * Save settings to file.
   *
   * @param settings - the settings to save.
   * @returns
   */
  public saveSettingsToFile(settings: Partial<SettingsFile>) {
    this.bridge.send('to:settings:save', { settings });
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
   * Request a language change via the main process.
   *
   * @param lng - the language code (e.g., 'en', 'fr')
   */
  public setLanguage(lng: string) {
    this.bridge.send('to:i18n:set', lng);
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
