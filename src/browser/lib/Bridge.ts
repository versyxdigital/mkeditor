import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { ContextBridgeAPI } from '../interfaces/Bridge';
import { BridgeProviders } from '../interfaces/Providers';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { EditorSettings } from '../interfaces/Editor';
import { dom } from '../dom';
import { FileManager } from './bridge/files';
import { FileTree } from './bridge/fileTree';
import { BridgeSettings } from './bridge/settings';
import { registerBridgeListeners } from './bridge/listeners';

export class Bridge {
  /** Execution context bridge */
  public bridge: ContextBridgeAPI;

  /** Editor model instance */
  public model: editor.IStandaloneCodeEditor;

  /** Editor event dispatcher */
  public dispatcher: EditorDispatcher;

  /** Providers to be accessed through bridge */
  public providers: BridgeProviders = {
    settings: null,
    commands: null,
    completion: null,
  };

  /** File manager helper */
  private files: FileManager;

  /** File tree helper */
  private tree: FileTree;

  /** Settings helper */
  private settings: BridgeSettings;

  /**
   * Create a new mkeditor bridge.
   */
  public constructor(
    bridge: ContextBridgeAPI,
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
  ) {
    this.bridge = bridge;
    this.model = model;
    this.dispatcher = dispatcher;

    this.files = new FileManager(this.bridge, this.model, this.dispatcher);
    this.tree = new FileTree(this.bridge, (p) => this.openFileFromPath(p));
    this.settings = new BridgeSettings(this.bridge, this.model);

    registerBridgeListeners(
      this.bridge,
      this.model,
      this.dispatcher,
      this.providers,
      this.files,
      this.tree,
      this.settings,
    );

    dom.tabs?.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dom.tabs) {
        return;
      }
      const after = this.files.getDragAfterElement(dom.tabs, e.clientX);
      const dragging = dom.tabs.querySelector(
        'li.dragging',
      ) as HTMLLIElement | null;
      if (!dragging) {
        return;
      }
      if (after == null) {
        dom.tabs.appendChild(dragging);
      } else {
        dom.tabs.insertBefore(dragging, after);
      }
    });

    this.dispatcher.addEventListener('editor:bridge:settings', (event) => {
      this.saveSettingsToFile(event.message);
    });
  }

  /** Provide access to a provider */
  public provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  /** Send a save settings request across the bridge */
  public saveSettingsToFile(settings: EditorSettings) {
    this.settings.saveSettingsToFile(settings);
  }

  /** Send a save contents request across the bridge */
  public saveContentToFile() {
    this.files.saveContentToFile();
  }

  /** Send an export preview request across the bridge */
  public exportPreviewToFile(content: string) {
    this.files.exportPreviewToFile(content);
  }

  /** Open a file from a given path */
  public openFileFromPath(path: string) {
    this.files.openFileFromPath(path);
  }

  /** Track the editor state between both execution contexts */
  public trackEditorStateBetweenExecutionContext(hasChanged: boolean) {
    this.files.trackEditorStateBetweenExecutionContext(hasChanged);
  }
}
