import type { editor } from 'monaco-editor';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { AssistantManager } from './AssistantManager';
import { AssistantTools } from './AssistantTools';
import { AssistantContextSource } from './AssistantContextSource';
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

  /** File manager helper (exposed so FilesContext can subscribe). */
  public fileManager: FileManager;

  /** File tree helper (exposed for FileTreeContext). */
  public fileTreeManager: FileTreeManager;

  /**
   * AI Assistant manager (P3+). Owns the sanitized config snapshot
   * the settings UI subscribes to and the outbound `to:ai:*` mutators.
   * Hydrated immediately after `registerBridgeListeners` runs so a
   * `from:ai:config` push from main reaches the registered
   * `onConfigPush` handler.
   */
  public assistantManager: AssistantManager;

  /** Window-control state. Mutated by `BridgeListeners.from:window:state`
   *  on every main-process maximize / unmaximize event. React's
   *  `WindowContext` reads this via `subscribeWindowState` +
   *  `getWindowState`. The snapshot reference is stable between emits
   *  so `useSyncExternalStore`'s `===` compare is safe. */
  private windowState: { isMaximized: boolean } = { isMaximized: false };
  private windowListeners = new Set<() => void>();

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
    this.assistantManager = new AssistantManager(this.bridge);
    // Hand the tool catalog to the manager. The executor needs the
    // BridgeManager instance (it reaches into FileManager /
    // FileTreeManager / EditorManager through there), so it's
    // constructed AFTER those exist on `this`.
    this.assistantManager.setToolExecutor(new AssistantTools(this));
    // Hand the context provider to the manager. Same pattern as
    // above — the source reaches into FileManager / EditorManager /
    // `window.mked` through the bridge ref.
    this.assistantManager.setContextProvider(new AssistantContextSource(this));
    // Let FileManager.serializeSession read the workspace root without
    // taking a direct dependency on FileTreeManager.
    this.fileManager.setWorkspaceRootGetter(
      () => this.fileTreeManager.treeRoot,
    );

    // Register event listeners for events sent through IPC channels.
    registerBridgeListeners(
      this.bridge,
      this.mkeditor,
      this.dispatcher,
      this.providers,
      this.fileManager,
      this.fileTreeManager,
      this,
    );

    // Explicitly request a config push now that listeners are in
    // place. Main also sends one on `did-finish-load`, but the
    // timing race (listener-registration vs. did-finish-load) makes
    // an explicit pull from this side cheap insurance — the handler
    // is idempotent and the snapshot diff'ing in AssistantManager
    // collapses any duplicate emit.
    this.assistantManager.requestConfigRefresh();
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

  // Window-control surface (consumed by <TitleBar> via WindowContext) -----

  /** Subscribe to maximize-state changes. Returns an unsubscribe. */
  public subscribeWindowState(listener: () => void): () => void {
    this.windowListeners.add(listener);
    return () => {
      this.windowListeners.delete(listener);
    };
  }

  /** Latest maximize state; stable reference between emits. */
  public getWindowState(): { isMaximized: boolean } {
    return this.windowState;
  }

  /**
   * Apply a state update from `from:window:state`. Rebuilds the snapshot
   * object only when the value actually changes so consumers' `===`
   * compares stay stable on no-op events.
   */
  public setWindowState(next: { isMaximized: boolean }): void {
    if (this.windowState.isMaximized === next.isMaximized) return;
    this.windowState = next;
    this.windowListeners.forEach((l) => l());
  }

  public windowMinimize(): void {
    this.bridge.send('to:window:minimize', null);
  }

  public windowMaximize(): void {
    this.bridge.send('to:window:maximize', null);
  }

  public windowClose(): void {
    this.bridge.send('to:window:close', null);
  }

  public windowToggleFullscreen(): void {
    this.bridge.send('to:window:fullscreen', null);
  }

  /** Fires `to:command:run` so main's `AppMenu.runCommand` runs the
   *  matching handler (open-log, toggle-devtools, …). */
  public runCommand(commandId: string): void {
    this.bridge.send('to:command:run', commandId);
  }

  // Clipboard ops routed through main's `webContents.cut/copy/paste()`
  // (see `AppWindow.register`). Renderer-side `document.execCommand`
  // fails after Radix's deferred close because the user-activation
  // gesture has been consumed — the WebContents path doesn't have that
  // constraint. Monaco's textarea receives the synthetic events
  // natively and acts accordingly.
  public editCut(): void {
    this.bridge.send('to:edit:cut', null);
  }
  public editCopy(): void {
    this.bridge.send('to:edit:copy', null);
  }
  public editPaste(): void {
    this.bridge.send('to:edit:paste', null);
  }

  /**
   * Move a file or folder inside the workspace. Routes through the
   * desktop `window.mked.moveItem` invoke when available; falls back
   * to the web bridge's `moveItem` (added by `WebFileBridge`) so
   * drag-and-drop and the "Move to…" modal use one call site.
   *
   * Returns the structured result from main so the caller can show
   * a translated toast on refusal (collision, descendant-of-self,
   * outside-workspace, …). The renderer never needs to refresh the
   * file tree or remap open-tab paths itself — main emits both
   * `from:folder:opened` events and `from:path:renamed` and the
   * existing BridgeListeners handlers thread those through
   * FileTreeManager and FileManager.
   */
  public async moveItem(
    srcPath: string,
    dstPath: string,
  ): Promise<
    | { ok: true; oldPath: string; newPath: string }
    | { ok: false; error: string }
  > {
    if (window.mked?.moveItem) {
      return window.mked.moveItem({ srcPath, dstPath });
    }
    // Web bridge: WebFileBridge.moveItem (Phase 5) exposes the same
    // shape. Cast through `unknown` because ContextBridgeAPI is the
    // narrow desktop-shaped surface; the web bridge has the
    // additional method.
    const webBridge = this.bridge as unknown as {
      moveItem?: (opts: {
        srcPath: string;
        dstPath: string;
      }) => Promise<
        | { ok: true; oldPath: string; newPath: string }
        | { ok: false; error: string }
      >;
    };
    if (typeof webBridge.moveItem === 'function') {
      return webBridge.moveItem({ srcPath, dstPath });
    }
    return { ok: false, error: 'move_unsupported_in_this_mode' };
  }

  // Menu dispatch helpers (consumed by both BridgeListeners' anonymous
  // `from:*` handlers and the in-window menu's `dispatchMenuAction`) ------
  //
  // Each method encapsulates the renderer-side effect of one menu entry
  // so both surfaces stay in lock-step. Adding a new menu item that
  // talks to main means adding a helper here, registering it in
  // BridgeListeners, and dispatching it from `menuDispatch.ts`.

  public menuFileNew(): void {
    this.bridge.send('to:title:set', '');
    this.bridge.send('to:file:new', {
      content: this.mkeditor.getValue(),
      // Use the editable path rather than the raw `activeFile`, which
      // can be a `diff://...` overlay id while a popped-out diff
      // preview is showing. Main resolves this against the filesystem
      // for the unsaved-changes prompt; a synthetic id would have no
      // hope of mapping to anything sensible there.
      file: this.fileManager.getActiveEditablePath(),
    });
  }

  public menuFileOpen(): void {
    this.fileManager.openingFile = true;
    this.bridge.send('to:file:open', true);
  }

  public menuFileSave(): void {
    // Delegate to FileManager so every save path (toolbar button,
    // menu accelerator Ctrl+S, native macOS menu, in-window
    // TitleBar) clears the tab's unsaved-changes dot via the same
    // `markTabClean` call. Previously this branch duplicated the
    // body but skipped `markTabClean`, so the file was saved on
    // disk while the dot stayed lit.
    this.fileManager.saveContentToFile();
  }

  public menuFileSaveAs(): void {
    this.bridge.send('to:file:saveas', this.mkeditor.getValue());
  }

  public menuFolderOpen(): void {
    this.fileTreeManager.openingFolder = true;
    this.bridge.send('to:folder:open', true);
  }

  public menuCommandPalette(): void {
    this.mkeditor.focus();
    this.mkeditor.trigger('open', 'editor.action.quickCommand', {});
  }
}
