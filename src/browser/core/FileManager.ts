import { editor } from 'monaco-editor';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type {
  SessionPayload,
  SessionRestoreEnvelope,
  SessionTab,
} from '../interfaces/Session';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { openPromptExternal } from '../react/contexts/PromptsContext';
import { debounce } from '../util';
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

  /** Per-tab Monaco view state. */
  private viewStates: Map<string, editor.ICodeEditorViewState> = new Map();

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
   * Set once `restoreSession` has run for this manager instance. Guards
   * against double-replay if `from:session:restore` ever fires twice
   * (e.g. window reload + cached IPC).
   */
  private restored = false;

  /**
   * True while `restoreSession` is replaying tabs. Suppresses the
   * debounced save trigger so a freshly-restored session doesn't
   * immediately persist itself (each replayed tab event would call
   * scheduleSessionSave otherwise).
   */
  private restoring = false;

  /**
   * Debounced trigger that serialises the current state and ships it
   * to main via `to:session:save`. Built lazily on first call so test
   * environments without `window.setTimeout` can still construct a
   * FileManager.
   */
  private debouncedSessionSave: (() => void) | null = null;

  /**
   * Optional callback that returns the currently-open workspace folder
   * path (or null). Injected by the composition root so
   * `serializeSession()` can include `workspaceRoot` without
   * FileManager having to know about FileTreeManager directly.
   */
  private workspaceRootGetter: (() => string | null) | null = null;

  /**
   * Optional callback returning whether the user has session restore
   * enabled in their settings. Injected by the composition root so
   * `scheduleSessionSave()` and `restoreSession()` can short-circuit
   * without FileManager taking a direct dependency on SettingsProvider.
   * Defaults to "enabled" when no getter is set (first-launch ordering
   * has the bridge plumbing land before settings are pushed; failing
   * open is safer than silently dropping the very first save).
   */
  private sessionEnabledGetter: (() => boolean) | null = null;

  /**
   * When true, `scheduleSessionSave()` short-circuits. Set by the
   * composition root in web mode before `seedUntitled` so the seed's
   * debounced save can't fire ahead of `WebFileBridge.bootstrap()` and
   * overwrite the persisted session with the seeded-untitled-only
   * state. Cleared at the top of `restoreSession()` (success, null
   * session, or disabled — every path), so the very next user-driven
   * change kicks off normal persistence.
   */
  private sessionSaveSuspended = false;

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
    this.scheduleSessionSave();
  }

  /**
   * Close a tab. If the buffer is dirty, opens a three-button prompt
   * (Save & close / Close without saving / Cancel) via openPromptExternal.
   */
  public async closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    const original = this.originals.get(path) ?? '';
    const current = mdl.getValue();

    if (original !== current && !this.isLogFile) {
      const result = await openPromptExternal({
        title: t('modals-unsaved:title'),
        description: t('modals-unsaved:text'),
        buttons: [
          {
            id: 'cancel',
            label: t('modals-unsaved:cancel'),
            variant: 'secondary',
          },
          {
            id: 'deny',
            label: t('modals-unsaved:deny'),
            variant: 'secondary',
          },
          {
            id: 'confirm',
            label: t('modals-unsaved:confirm'),
            variant: 'primary',
          },
        ],
      });

      if (result.button === 'confirm') {
        if (path.startsWith('untitled')) {
          this.bridge.send('to:file:saveas', current);
        } else {
          this.bridge.send('to:file:save', {
            content: current,
            file: path,
            openFile: false,
          });
        }
      } else if (result.button !== 'deny') {
        // null (Esc/overlay) or 'cancel' — abort the close.
        return;
      }
    }

    // Remove the closing tab from the bookkeeping first so the
    // iterator below doesn't yield it back.
    this.models.delete(path);
    this.originals.delete(path);
    this.tabs.delete(path);
    this.viewStates.delete(path);

    if (this.activeFile === path) {
      this.activeFile = null;
      const next = this.tabs.keys().next();
      if (!next.done) {
        const nextPath = next.value;
        const nextInfo = this.tabs.get(nextPath);
        // Swap Monaco to the next tab's model BEFORE disposing the
        // outgoing one. If we disposed first, Monaco would briefly be
        // pointing at a disposed model — fine when the next step
        // creates a fresh model (the empty-tabs branch), but in this
        // branch the next model is an existing one we're re-attaching,
        // and Monaco's internal state doesn't recover cleanly from the
        // disposed-then-reattach sequence.
        this.activateFile(nextPath, nextInfo?.name);
        mdl.dispose();
        this.scheduleSessionSave();
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
      mdl.dispose();
      this.scheduleSessionSave();
      return;
    }

    // Inactive tab — Monaco doesn't reference this model, so disposing
    // now is safe.
    mdl.dispose();
    this.emitChange();
    this.scheduleSessionSave();
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
    this.scheduleSessionSave();
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
    // The model is reused but its content is overwritten below, so any
    // cursor/scroll state captured under the untitled key would now
    // point at lines that no longer exist. Drop it.
    this.viewStates.delete(oldPath);

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
    this.scheduleSessionSave();
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

    const view = this.viewStates.get(oldPath);
    if (view !== undefined) {
      this.viewStates.delete(oldPath);
      this.viewStates.set(newPath, view);
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
      this.scheduleSessionSave();
      return true;
    }

    this.emitChange();
    this.scheduleSessionSave();
    return true;
  }

  /**
   * Seed an initial `untitled-N` tab from the supplied content. Used in
   * web mode at boot so the navbar/title bar reflect the current Monaco
   * buffer (welcome content or restored localStorage) — desktop normally
   * gets its first tab from the first `from:file:opened` event, but on
   * web there is no main process to send one.
   *
   * Creates a fresh model rather than adopting `mkeditor.getModel()`:
   * the editor's auto-created model gets disposed by Monaco the first
   * time `setModel(otherModel)` is called, so adopting it here would
   * leave the seeded tab pointing at a dead reference as soon as the
   * user opens a real file.
   */
  public seedUntitled(initialContent: string): void {
    const path = `untitled-${this.untitledCounter++}`;
    const name = `Untitled ${this.untitledCounter - 1}`;
    const model = editor.createModel(initialContent, 'markdown');
    this.models.set(path, model);
    this.originals.set(path, initialContent);
    this.addTab(name, path);
    this.activateFile(path, name);
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

    const previousPath = this.activeFile;
    const switching = previousPath !== path;

    if (switching) {
      // Capture the outgoing tab's cursor/selection/scroll/folding so
      // we can restore it when the user comes back.
      if (previousPath) {
        const state = this.mkeditor.saveViewState();
        if (state) this.viewStates.set(previousPath, state);
      }

      this.activeFile = path;
      this.mkeditor.setModel(mdl);

      // Restore the incoming tab's view state. First activations have
      // no saved entry and stay at top-of-file (Monaco's default).
      const incoming = this.viewStates.get(path);
      if (incoming) this.mkeditor.restoreViewState(incoming);
    } else {
      // Re-activation: keep Monaco's current view state intact. Still
      // refresh the title and re-emit below so rename / no-op
      // activations behave consistently.
      this.activeFile = path;
    }

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

    // Active-file highlight in both the tab bar and the file tree is now
    // owned by React (FilesContext + FileTreePanel).

    this.dispatcher.render();
    this.mkeditor.focus();

    this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
    this.emitChange();
    this.scheduleSessionSave();
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

  // ---------------------------------------------------------------------
  // Session persistence (Phase 2)
  // ---------------------------------------------------------------------

  /**
   * Inject a getter for the currently-open workspace folder path. The
   * composition root wires this to `FileTreeManager.treeRoot` so
   * `serializeSession()` can include `workspaceRoot` without FileManager
   * holding a direct reference to FileTreeManager.
   */
  public setWorkspaceRootGetter(fn: () => string | null): void {
    this.workspaceRootGetter = fn;
  }

  /**
   * Inject a getter for the user's `sessionRestore` setting. Wired by
   * the composition root to `SettingsProvider.getSetting('sessionRestore')`.
   * When the getter returns `false`, `scheduleSessionSave` and
   * `restoreSession` short-circuit and neither writes nor reads the
   * persisted file.
   */
  public setSessionEnabledGetter(fn: () => boolean): void {
    this.sessionEnabledGetter = fn;
  }

  /**
   * Block `scheduleSessionSave()` until `restoreSession()` runs. Used
   * by the web composition root around `seedUntitled` so a 300 ms
   * debounce can't fire ahead of the async bootstrap and overwrite
   * the persisted session.
   */
  public suspendSessionSaves(): void {
    this.sessionSaveSuspended = true;
  }

  /**
   * Returns true if session persistence is currently active. Falls back
   * to `true` when no getter is registered so first-boot writes (before
   * settings land) aren't silently dropped.
   */
  private isSessionEnabled(): boolean {
    return this.sessionEnabledGetter ? this.sessionEnabledGetter() : true;
  }

  /**
   * Snapshot the current tab/view state for persistence. The active
   * tab's freshest cursor/scroll is captured here (rather than relying
   * solely on the switch-out capture in `activateFile`) so a quit
   * without a final tab switch still records where the user was.
   */
  public serializeSession(): SessionPayload {
    if (this.activeFile) {
      const state = this.mkeditor.saveViewState();
      if (state) this.viewStates.set(this.activeFile, state);
    }

    const tabs: SessionTab[] = [];
    for (const info of this.tabs.values()) {
      const viewState = this.viewStates.get(info.path) ?? null;
      const tab: SessionTab = {
        path: info.path,
        name: info.name,
        viewState,
      };
      if (info.path.startsWith('untitled-')) {
        // Persist scratch content only when non-empty; empty untitled
        // tabs are noise and shouldn't survive a relaunch.
        const content = this.models.get(info.path)?.getValue() ?? '';
        if (content.length > 0) tab.untitledContent = content;
      }
      tabs.push(tab);
    }

    return {
      version: 1,
      tabs,
      activeFile: this.activeFile,
      workspaceRoot: this.workspaceRootGetter?.() ?? null,
    };
  }

  /**
   * Replay a persisted session. Untitled tabs are recreated in-place
   * from `untitledContent`; real-file tabs use the pre-loaded contents
   * shipped in the envelope (no per-file IPC round-trip needed).
   * Idempotent — subsequent calls in the same FileManager lifetime
   * are no-ops.
   */
  public restoreSession(envelope: SessionRestoreEnvelope): void {
    if (this.restored) return;
    this.restored = true;
    // Unblock pending edits regardless of what the envelope carries.
    // Even a null/empty session means bootstrap is over and future
    // user-initiated changes should persist normally. Disabled-by-
    // setting is handled separately by `isSessionEnabled()` inside
    // `scheduleSessionSave`.
    this.sessionSaveSuspended = false;
    // When session restore is disabled, the envelope is still received
    // (main / WebFileBridge always emit one) but we drop it on the
    // floor. Marking `restored = true` above ensures a later toggle
    // doesn't retroactively replay the now-stale envelope.
    if (!this.isSessionEnabled()) return;

    const { session, contents } = envelope;
    if (!session || session.tabs.length === 0) return;

    this.restoring = true;
    // Models we evicted during reconciliation. Kept alive until *after*
    // `activateFile` swaps Monaco onto a survivor — disposing before
    // the swap would put Monaco on a disposed model briefly and Monaco
    // doesn't recover cleanly from that.
    const evictedModels: editor.ITextModel[] = [];
    try {
      // Reconcile current state to match the session exactly. Web boot
      // pre-seeds `untitled-1` before bootstrap fires this restore; if
      // the persisted session didn't include that tab, it would
      // otherwise linger and land in the next save. Real-file tabs
      // suffer the same fate if the user manually opened files between
      // the previous save and this restore.
      const desiredPaths = new Set(session.tabs.map((t) => t.path));
      for (const path of [...this.tabs.keys()]) {
        if (desiredPaths.has(path)) continue;
        const mdl = this.models.get(path);
        if (mdl) evictedModels.push(mdl);
        this.models.delete(path);
        this.originals.delete(path);
        this.tabs.delete(path);
        this.viewStates.delete(path);
      }
      // If the active path was just evicted, null it out so the
      // `activateFile` call below sees `previousPath = null` and skips
      // saving a view state under a path we no longer track. This also
      // means the upcoming `setModel` is the first time Monaco hears
      // about the new model — clean transition, no stale-state mixing.
      if (this.activeFile && !desiredPaths.has(this.activeFile)) {
        this.activeFile = null;
      }

      // Advance the untitled counter past every restored synthetic id so
      // a new "Untitled N" created later doesn't collide.
      for (const tab of session.tabs) {
        if (tab.path.startsWith('untitled-')) {
          const n = parseInt(tab.path.slice('untitled-'.length), 10);
          if (Number.isFinite(n) && n >= this.untitledCounter) {
            this.untitledCounter = n + 1;
          }
        }
      }

      // Build models + tabs + view-state cache in one pass. No
      // activation yet — that comes at the end.
      //
      // If a tab already exists (e.g. a seeded `untitled-1` that the
      // session also tracks), update the existing model's content to
      // match the session's saved value rather than skipping. The
      // session is the source of truth.
      for (const tab of session.tabs) {
        const content = tab.path.startsWith('untitled-')
          ? (tab.untitledContent ?? '')
          : (contents[tab.path] ?? '');

        const existing = this.models.get(tab.path);
        if (existing) {
          if (existing.getValue() !== content) existing.setValue(content);
          this.originals.set(tab.path, content);
          if (tab.viewState) {
            this.viewStates.set(
              tab.path,
              tab.viewState as editor.ICodeEditorViewState,
            );
          }
          // Preserve any updated display name from the session.
          this.tabs.set(tab.path, { path: tab.path, name: tab.name });
          continue;
        }

        const model = editor.createModel(content, 'markdown');
        this.models.set(tab.path, model);
        this.originals.set(tab.path, content);
        if (tab.viewState) {
          this.viewStates.set(
            tab.path,
            tab.viewState as editor.ICodeEditorViewState,
          );
        }
        this.tabs.set(tab.path, { path: tab.path, name: tab.name });
      }

      // Pick what to activate. Prefer the persisted active file;
      // fall back to the first tab if the persisted active is gone.
      let toActivate: string | null = session.activeFile;
      if (!toActivate || !this.tabs.has(toActivate)) {
        toActivate = this.tabs.keys().next().value ?? null;
      }
      if (toActivate) {
        const info = this.tabs.get(toActivate);
        this.activateFile(toActivate, info?.name);
      } else {
        this.emitChange();
      }
    } finally {
      this.restoring = false;
      // Now safe to free evicted models. Monaco's current model is
      // whichever survivor `activateFile` just attached. Disposing
      // earlier risks the disposed-then-reattach race Monaco doesn't
      // handle cleanly.
      for (const mdl of evictedModels) mdl.dispose();
    }
  }

  /**
   * Debounced trigger that ships the current session to main. Wired
   * into every mutating method (addTab/closeTab/activateFile/...) so
   * structural changes persist within ~300 ms of the last edit. Skipped
   * during `restoreSession` so a freshly-replayed session doesn't
   * round-trip itself back to disk.
   */
  public scheduleSessionSave(): void {
    if (this.restoring) return;
    if (this.sessionSaveSuspended) return;
    if (!this.isSessionEnabled()) return;
    if (!this.debouncedSessionSave) {
      this.debouncedSessionSave = debounce(() => {
        // Re-check on flush: the user may have flipped the setting off
        // during the debounce window, OR a bootstrap suspension may
        // still be in flight (a slow async restoreSession has yet to
        // clear the suspend). The persisted file is left untouched so
        // a later flip back on / restoreSession resumes the prior state.
        if (this.sessionSaveSuspended) return;
        if (!this.isSessionEnabled()) return;
        this.bridge.send('to:session:save', this.serializeSession());
      }, 300);
    }
    this.debouncedSessionSave();
  }
}
