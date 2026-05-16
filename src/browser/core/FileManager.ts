import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import Swal from 'sweetalert2';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { dom } from '../dom';
import { t } from '../i18n';

export interface TabInfo {
  path: string;
  name: string;
}

export interface FilesSnapshot {
  tabs: TabInfo[];
  activeFile: string | null;
}

/**
 * Handle editor files, models and tabs.
 *
 * The DOM-mutation surface that previously lived here (creating <li> tab
 * elements, drag listeners, classList toggles for active state) has moved
 * to <TabBar> + <Navbar> + <Sidebar> in the React tree. FileManager keeps
 * the file/model/baseline data and exposes an observable surface:
 *
 *   - tabs:        Map<path, { path, name }> (insertion-ordered)
 *   - activeFile:  current active path or null
 *   - getSnapshot: stable snapshot for useSyncExternalStore
 *   - on:          subscribe to change events
 *
 * React contexts (FilesContext) subscribe via on('change', listener) and
 * read getSnapshot() for the latest tabs + activeFile.
 */
export class FileManager {
  /** The current active file */
  public activeFile: string | null = null;

  /** Flag to determine whether the content has changed */
  public contentHasChanged = false;

  /** Map of open file models */
  public models: Map<string, editor.ITextModel> = new Map();

  /** Map of original contents (used for unsaved-change detection) */
  public originals: Map<string, string> = new Map();

  /** Insertion-ordered map of tab metadata. */
  public tabs: Map<string, TabInfo> = new Map();

  /** counter for untitled files */
  public untitledCounter = 1;

  /** Flag to indicate that a file is being opened */
  public openingFile = false;

  /** Is the app log */
  private isLogFile: boolean = false;

  /** Stable snapshot used by FilesContext (rebuilt only on emitChange). */
  private snapshot: FilesSnapshot = { tabs: [], activeFile: null };

  /** Active listeners for the 'change' event. */
  private listeners = new Set<() => void>();

  /**
   * Create a new file manager instance.
   *
   * @param bridge - the execution bridge
   * @param mkeditor - the editor instance
   * @param dispatcher - the event dispatcher
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private mkeditor: editor.IStandaloneCodeEditor,
    private dispatcher: EditorDispatcher,
  ) {}

  // ---------------------------------------------------------------------
  // Observable surface (consumed by FilesContext)
  // ---------------------------------------------------------------------

  /**
   * Subscribe to change events. Fires on add/close/activate/rename/reorder.
   * Returns an unsubscribe function.
   */
  public on(event: 'change', listener: () => void): () => void {
    if (event !== 'change') {
      throw new Error(`FileManager.on: unsupported event "${event}"`);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stable snapshot of {tabs, activeFile}. Reference is preserved between
   * emits, so useSyncExternalStore consumers can `===` compare safely.
   */
  public getSnapshot(): FilesSnapshot {
    return this.snapshot;
  }

  /** Rebuild the snapshot and notify all subscribed listeners. */
  private emitChange() {
    this.snapshot = {
      tabs: Array.from(this.tabs.values()),
      activeFile: this.activeFile,
    };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Tab management
  // ---------------------------------------------------------------------

  /**
   * Add a new tab for an activated file. Data-only; the React <TabBar>
   * renders the tabs via FilesContext.
   *
   * @param name - the file name
   * @param path - the file path
   */
  public addTab(name: string, path: string) {
    this.tabs.set(path, { path, name });
    this.emitChange();
  }

  /**
   * Close a tab (prompting for unsaved changes via SweetAlert until
   * Phase 8 swaps SweetAlert out for a shadcn AlertDialog).
   */
  public async closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    const original = this.originals.get(path) ?? '';
    const current = mdl.getValue();

    if (original !== current && !this.isLogFile) {
      const result = await Swal.fire({
        customClass: { container: 'unsaved-changes-popup' },
        title: t('modals-unsaved:title'),
        text: t('modals-unsaved:text'),
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: t('modals-unsaved:confirm'),
        denyButtonText: t('modals-unsaved:deny'),
        cancelButtonText: t('modals-unsaved:cancel'),
      });

      if (result.isConfirmed) {
        if (path.startsWith('untitled')) {
          this.bridge.send('to:file:saveas', current);
        } else {
          this.bridge.send('to:file:save', {
            content: current,
            file: path,
            openFile: false,
          });
        }
      } else if (!result.isDenied) {
        return;
      }
    }

    mdl.dispose();
    this.models.delete(path);
    this.originals.delete(path);
    this.tabs.delete(path);

    if (this.activeFile === path) {
      this.activeFile = null;
      const next = this.tabs.keys().next();
      if (!next.done) {
        const nextPath = next.value;
        const nextInfo = this.tabs.get(nextPath);
        // Activate the next tab. activateFile will emitChange itself.
        this.activateFile(nextPath, nextInfo?.name);
        return;
      }
      // No tabs left — open a fresh untitled.
      const newPath = `untitled-${this.untitledCounter++}`;
      const newName = `Untitled ${this.untitledCounter - 1}`;
      const model = editor.createModel('', 'markdown');
      this.models.set(newPath, model);
      this.originals.set(newPath, '');
      this.tabs.set(newPath, { path: newPath, name: newName });
      this.activateFile(newPath, newName);
      return;
    }

    this.emitChange();
  }

  /**
   * Reorder tabs to match the given path order. Called by <TabBar> after
   * an HTML5 drag-and-drop reorder. Unknown/missing paths are ignored;
   * any tabs not in `newOrder` are preserved at the end.
   */
  public reorderTabs(newOrder: string[]) {
    const next: Map<string, TabInfo> = new Map();
    for (const path of newOrder) {
      const info = this.tabs.get(path);
      if (info) next.set(path, info);
    }
    for (const [path, info] of this.tabs) {
      if (!next.has(path)) next.set(path, info);
    }
    this.tabs = next;
    this.emitChange();
  }

  /**
   * Replace the active untitled tab with a freshly-opened real file,
   * preserving the model (which may carry the user's typed content).
   * Returns true if a replacement happened, false if the caller should
   * fall back to addTab + activateFile.
   */
  public replaceUntitled(
    newPath: string,
    newName: string,
    content: string,
  ): boolean {
    if (
      this.models.has(newPath) ||
      this.openingFile ||
      !this.activeFile ||
      !this.activeFile.startsWith('untitled')
    ) {
      return false;
    }

    const oldPath = this.activeFile;
    const mdl = this.models.get(oldPath);
    if (!mdl) return false;

    this.models.delete(oldPath);
    this.originals.delete(oldPath);

    this.models.set(newPath, mdl);
    this.originals.set(newPath, content);
    mdl.setValue(content);

    // Rebuild tabs map preserving insertion order, swapping the
    // untitled entry's key + name in place.
    const next: Map<string, TabInfo> = new Map();
    for (const [path, info] of this.tabs) {
      if (path === oldPath) {
        next.set(newPath, { path: newPath, name: newName });
      } else {
        next.set(path, info);
      }
    }
    this.tabs = next;
    this.activeFile = newPath;
    this.emitChange();
    return true;
  }

  /**
   * Rename a tab in place (triggered by the file-tree rename action).
   * Migrates the open model and unsaved-change baseline to the new path.
   * Returns true if a matching tab was renamed, false otherwise.
   */
  public renameTab(oldPath: string, newPath: string, newName: string): boolean {
    const mdl = this.models.get(oldPath);
    if (!mdl) return false;

    const original = this.originals.get(oldPath);
    if (original !== undefined) {
      this.originals.delete(oldPath);
      this.originals.set(newPath, original);
    }

    this.models.delete(oldPath);
    this.models.set(newPath, mdl);

    if (this.tabs.has(oldPath)) {
      const next: Map<string, TabInfo> = new Map();
      for (const [path, info] of this.tabs) {
        if (path === oldPath) {
          next.set(newPath, { path: newPath, name: newName });
        } else {
          next.set(path, info);
        }
      }
      this.tabs = next;
    }

    if (this.activeFile === oldPath) {
      this.activeFile = newPath;
      // Re-emit through activateFile so the dispatcher fires editor:render
      // and the window title gets the new name.
      this.activateFile(newPath, newName);
      return true;
    }

    this.emitChange();
    return true;
  }

  // ---------------------------------------------------------------------
  // Activation, opening, saving
  // ---------------------------------------------------------------------

  /**
   * Activate a file. Sets the Monaco model, updates the unsaved-change
   * baseline, fires editor:render, and tells the main process to update
   * the window title.
   */
  public activateFile(path: string, name?: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    this.activeFile = path;
    this.mkeditor.setModel(mdl);
    const filename = name || path.split(/[\\/]/).pop() || '';

    const original = this.originals.get(path) ?? '';
    const current = this.mkeditor.getValue();

    this.isLogFile = filename.endsWith('.log');

    if (!this.isLogFile) {
      this.dispatcher.setTrackedContent({ content: original });
      this.trackContentHasChanged(original !== current);
    } else {
      this.contentHasChanged = false;
    }

    // File-tree active-state highlight still lives in legacy DOM (Phase 5
    // owns the file tree). Tab + active-file highlight in the navbar is
    // owned by React via FilesContext.
    if (dom.filetree) {
      dom.filetree.querySelectorAll('li.file .file-name').forEach((el) => {
        const li = (el as HTMLElement).parentElement as HTMLElement;
        if (li.dataset.path === path)
          (el as HTMLElement).classList.add('active');
        else (el as HTMLElement).classList.remove('active');
      });
    }

    this.dispatcher.render();
    this.mkeditor.focus();

    this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
    this.emitChange();
  }

  /**
   * Open a file from a given path.
   *
   * @param path - the file path
   * @returns
   */
  public openFileFromPath(path: string) {
    this.openingFile = true;

    if (this.models.has(path)) {
      this.activateFile(path);
      this.openingFile = false;
      return;
    }

    if (this.contentHasChanged && this.activeFile !== path) {
      this.dispatcher.setTrackedContent({
        content: this.mkeditor.getValue(),
      });
    }

    this.bridge.send('to:file:openpath', { path });
  }

  /**
   * Track the editor state (contents) on the active file.
   *
   * @param hasChanged - whether the state has changed
   * @returns
   */
  public trackContentHasChanged(hasChanged: boolean) {
    if (this.isLogFile) hasChanged = false;
    this.bridge.send('to:editor:state', hasChanged);
    this.contentHasChanged = hasChanged;
  }

  /**
   * Save the active file contents.
   * @returns
   */
  public saveContentToFile() {
    if (this.activeFile && !this.activeFile.startsWith('untitled')) {
      this.bridge.send('to:file:save', {
        content: this.mkeditor.getValue(),
        file: this.activeFile,
      });
      this.originals.set(this.activeFile, this.mkeditor.getValue());
      this.dispatcher.setTrackedContent({
        content: this.mkeditor.getValue(),
      });
    } else {
      this.bridge.send('to:file:saveas', this.mkeditor.getValue());
    }
  }

  /**
   * Export an active file to HTML
   *
   * @param content - the HTML content
   * @returns
   */
  public exportToHTML(content: string) {
    this.bridge.send('to:html:export', { content });
  }

  /**
   * Export an active file to PDF
   *
   * @param content - the HTML content
   * @returns
   */
  public exportToPDF(content: string) {
    this.bridge.send('to:pdf:export', { content });
  }
}
