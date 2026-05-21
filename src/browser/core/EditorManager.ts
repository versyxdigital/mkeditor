import { editor, KeyCode } from 'monaco-editor';
import type { EditorProviders } from '../interfaces/Providers';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { ScrollSync } from '../extensions/editor/ScrollSync';
import { welcomeMarkdown } from '../assets/intro';
import { debounce, logger } from '../util';
import { dom } from '../dom';

/**
 * Several Monaco controllers cancel in-flight tokens when their model
 * changes or when `restoreViewState` is called. The cancel triggers a
 * rejection on an internal promise that has no error handler, so the
 * browser logs an error. It's a benign Monaco design choice,
 *
 * We install one `unhandledrejection` listener at module load that
 * suppresses *only* this specific shape.
 */
let monacoCancelFilterInstalled = false;
function installMonacoCancelFilter() {
  if (monacoCancelFilterInstalled) return;
  if (typeof window === 'undefined') return;
  monacoCancelFilterInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: string; message?: string } | null;
    if (
      reason &&
      (reason.name === 'Canceled' || reason.message === 'Canceled')
    ) {
      event.preventDefault();
    }
  });
}

interface EditorConstructOptions {
  dispatcher: EditorDispatcher;
  init?: boolean | undefined;
  watch?: boolean | undefined;
}

interface EditorCreateOptions {
  mount?: HTMLElement | null;
  watch?: boolean;
}

/**
 * Per-instance configuration for a diff-preview surface. The Monaco
 * tuning (line numbers, gutters, scrollbars, narrow-panel overrides)
 * is fixed inside `createDiffPreview` — this struct only carries the
 * values that vary per call: the language and the render mode.
 */
export interface DiffPreviewOptions {
  language: string;
  renderSideBySide: boolean;
}

/**
 * Handle returned from `EditorManager.createDiffPreview`. Callers
 * update content via `setOriginal` / `setModified` (no remount) and
 * tear the whole thing down with `dispose` (editor-first, then both
 * models — the order Monaco requires to avoid a
 * `Cannot read properties of undefined (_isDisposed)` crash).
 */
export interface DiffPreviewHandle {
  setOriginal(value: string): void;
  setModified(value: string): void;
  dispose(): void;
}

export class EditorManager {
  /** Editor instance */
  private mkeditor: editor.IStandaloneCodeEditor | null = null;

  /** Editor event dispatcher */
  private dispatcher: EditorDispatcher;

  /** The loaded original editor value for tracking */
  private loadedInitialEditorValue: string | null = null;

  /** Editor functional providers */
  public providers: EditorProviders = {
    bridge: null,
    commands: null,
    completion: null,
    settings: null,
    exportSettings: null,
  };

  /**
   * Create a new mkeditor.
   */
  public constructor(opts: EditorConstructOptions) {
    this.dispatcher = opts.dispatcher;

    // editor:render is handled by <PreviewPane> (innerHTML write) and
    // <Counts> via useCounts (word/character counts). EditorManager
    // no longer subscribes here. The version build chip and About
    // modal version label both source APP_VERSION directly from
    // <BottomToolbarRight> / <AboutModal>.

    if (opts.init) {
      this.create({ watch: opts.watch });
    }
  }

  /**
   * Provide access to a provider.
   *
   * @param provider - the provider to access
   * @param instance - the associated provider instance
   */
  public provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  /**
   * Create a new editor instance.
   *
   * @param mount - DOM element to host Monaco. Production callers (the
   *   React <EditorHost>) always supply this. The `dom.editor.dom`
   *   fallback exists only for tests, which seed a `<div id="editor">`
   *   before importing this module; production HTML no longer contains
   *   that id.
   * @param watch - flag to watch the editor for changes
   * @returns
   */
  public create({ mount, watch = false }: EditorCreateOptions = {}) {
    if (this.mkeditor) {
      // Idempotency: React effects may re-fire under strict-mode or hot
      // reload. Monaco is created exactly once.
      logger?.warn(
        'EditorManager.create',
        'Editor already created; ignoring duplicate invocation.',
      );
      return this;
    }

    const target: HTMLElement | null = mount ?? dom.editor.dom ?? null;
    if (!target) {
      logger?.error(
        'EditorManager.create',
        'No mount target available (mount param and dom.editor.dom both null).',
      );
      return this;
    }

    // Suppress Monaco's benign "Canceled" promise rejections. Idempotent
    // — safe to call on every create even though we only create one
    // editor per session.
    installMonacoCancelFilter();

    try {
      // Monaco boots with the welcome markdown. In web mode the
      // WebFileBridge bootstrap (kicked off from `onEditorReady`)
      // restores the persisted session — including any untitled
      // tabs — and FileManager.restoreSession overwrites this
      // placeholder content with the session's saved value.
      const editorContent = welcomeMarkdown;

      // Create the underlying monaco editor.
      // See https://microsoft.github.io/monaco-editor/
      this.mkeditor = editor.create(target, {
        value: editorContent,
        language: 'markdown',
        wordBasedSuggestions: 'off',
        autoIndent: 'advanced',
        wordWrap: 'on',
        renderWhitespace: 'all',
        renderLineHighlight: 'gutter',
        smoothScrolling: true,
        roundedSelection: false,
        accessibilityPageSize: 1000,
      });
      console.info('mkeditor: Monaco editor instance created.');

      // Set loadedInitialEditorValue for tracking file changes.
      this.loadedInitialEditorValue = this.mkeditor.getValue();
      this.dispatcher.addEventListener('editor:track:content', (event) => {
        this.loadedInitialEditorValue = event.detail;
      });

      // Window resize relayouts Monaco. The editor-pane resize is now
      // observed by <EditorHost>'s ResizeObserver, and the split-pane
      // drag fires Panel.onResize from <Workspace>.
      window.onload = () => this.mkeditor?.layout();
      window.onresize = () => this.mkeditor?.layout();

      // Trigger initial preview render. <PreviewPane> subscribes to
      // editor:render and writes innerHTML; <Counts> recomputes the
      // word/character counts via useCounts.
      this.dispatcher.render();

      if (watch) {
        // Watch the editor for changes and re-render if needed.
        this.watch();
      }
    } catch (err) {
      this.mkeditor = null;
      logger?.error('EditorManager.create', JSON.stringify(err));
    }

    return this;
  }

  /**
   * Get the current editor instance.
   * @returns
   */
  public getMkEditor() {
    return this.mkeditor;
  }

  /**
   * Get the current editor value. Returns '' if Monaco isn't mounted yet.
   * Consumed by <PreviewPane> to feed markdown-it on every editor:render.
   */
  public getValue(): string {
    return this.mkeditor?.getValue() ?? '';
  }

  /**
   * Web-mode "Delete content" handler — resets the active buffer to
   * the welcome markdown. Called by <EditorToolbar>'s trash button
   * (visible only in web mode). The buffer change flows into the
   * session via the normal Monaco-content-change → debounced session
   * save chain, so the next launch will reopen with the welcome
   * content rather than the wiped tab's previous value.
   */
  public resetContent() {
    this.mkeditor?.setValue(welcomeMarkdown);
  }

  /**
   * Relayout Monaco. Called by EditorHost's ResizeObserver and by
   * split-pane drag handlers.
   */
  public layout() {
    this.mkeditor?.layout();
  }

  /**
   * Tear down the Monaco instance. Allows the React host to clean up on
   * unmount so a subsequent mount can call create() again.
   */
  public dispose() {
    if (!this.mkeditor) return;
    this.mkeditor.dispose();
    this.mkeditor = null;
  }

  /**
   * Spin up a read-only Monaco diff-editor surface backed by two
   * throwaway models. Called by `<InlineDiffPreview>` so the chat
   * tool-confirmation card can render an inline diff without
   * importing `monaco-editor` itself — the manager/React rule keeps
   * every `monaco-editor` create call inside `core/`.
   *
   * The returned handle exposes:
   *   - `setOriginal(value)` / `setModified(value)` — push new
   *     content into the existing models (Monaco recovers from
   *     setValue cleanly, but NOT from setModel(disposed); the
   *     React component uses these to avoid a remount on prop
   *     changes).
   *   - `dispose()` — tear down editor THEN models (Monaco crashes
   *     if a model is disposed while an editor still references it).
   *
   * The chat-panel-specific Monaco tuning (no line numbers / glyph
   * margin, fontSize 12, narrow-panel overrides, etc.) is fixed
   * here rather than parameterised — there's only one diff-preview
   * surface in the app, and exposing every Monaco knob would defeat
   * the seam.
   */
  public createDiffPreview(
    host: HTMLElement,
    original: string,
    modified: string,
    options: DiffPreviewOptions,
  ): DiffPreviewHandle {
    const originalModel = editor.createModel(original, options.language);
    const modifiedModel = editor.createModel(modified, options.language);
    const diff = editor.createDiffEditor(host, {
      renderSideBySide: options.renderSideBySide,
      // Monaco silently forces inline view when the editor is
      // narrower than `renderSideBySideInlineBreakpoint` (default
      // ~900px) and `useInlineViewWhenSpaceIsLimited` is true (also
      // default). The chat panel is well under 900px, so without
      // these overrides the side-by-side toggle would have no
      // visible effect — Monaco overrides `renderSideBySide` on
      // every layout pass.
      useInlineViewWhenSpaceIsLimited: false,
      renderSideBySideInlineBreakpoint: 0,
      // Smaller than Monaco's 14px default — the chat panel is tight
      // and the diff is a preview, not the main editing surface.
      fontSize: 12,
      readOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      // Line numbers are noise inside a narrow chat panel — the
      // tool-card's `detail` line already carries "Lines X–Y" for
      // context-bounded previews. Killing them reclaims ~50px of
      // horizontal space.
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      wordWrap: 'on',
      renderOverviewRuler: false,
      // Hide per-pane scrollbars in unified mode where they cause
      // double-scrollbar noise; the inline diff fits the chat panel
      // better without them.
      scrollbar: { vertical: 'auto', horizontal: 'hidden' },
    });
    diff.setModel({ original: originalModel, modified: modifiedModel });

    return {
      setOriginal(value: string) {
        if (originalModel.getValue() !== value) originalModel.setValue(value);
      },
      setModified(value: string) {
        if (modifiedModel.getValue() !== value) modifiedModel.setValue(value);
      },
      dispose() {
        // Editor first, then models — disposing a model that an
        // editor still references throws inside Monaco's internals.
        // Per-step try/catch so an already-disposed downstream
        // doesn't strand the others.
        try {
          diff.dispose();
        } catch {
          // already-disposed; nothing to do
        }
        try {
          originalModel.dispose();
        } catch {
          // already-disposed; nothing to do
        }
        try {
          modifiedModel.dispose();
        } catch {
          // already-disposed; nothing to do
        }
      },
    };
  }

  /**
   * Track content over the execution bridge. Web mode used to mirror
   * the active buffer into `localStorage['mkeditor-content']` as a
   * crash-survival fallback — that's now covered by the session save
   * path (FileManager.scheduleSessionSave fires on every edit-adjacent
   * event), so this method is purely "tell the bridge whether the
   * buffer has diverged from the last-saved baseline."
   */
  public updateBridgedContent({ init }: { init?: boolean } = {}) {
    if (!this.providers.bridge) return;

    const hasChanged = init
      ? false
      : this.loadedInitialEditorValue !== this.mkeditor?.getValue();

    this.providers.bridge.sendFileContentHasChanged(hasChanged);
  }

  /**
   * Watch and re-render the editor for changes.
   */
  public watch() {
    const debouncedUpdateBridgedContent = debounce(
      () => this.updateBridgedContent(),
      250,
    );

    // Track Enter key presses to determine if we should attempt list continuation
    this.mkeditor?.onKeyDown((e) => {
      if (!this.providers.completion) return;
      if (e.keyCode === KeyCode.Enter) {
        // Only auto-continue lists on plain Enter (not Shift+Enter)
        this.providers.completion.shouldHandleEnterList = !e.shiftKey;
      } else {
        this.providers.completion.shouldHandleEnterList = false;
      }
    });

    // When the editor content changes, update the main process through the IPC handler
    // so that it can do things such as set the title notifying the user of unsaved changes,
    // prompt the user to save if they try to close the app or open a new file, etc.
    this.mkeditor?.onDidChangeModelContent((event) => {
      // Update the tracked content over the execution bridge.
      debouncedUpdateBridgedContent();

      // Auto-continue list markers when Enter was pressed.
      this.providers.completion?.autoContinueListMarkers(event.changes);

      // Register dynamic completions provider to suggest items based on input.
      this.providers.completion?.suggestOnValidInput(event.changes[0].text);

      // Add a small timeout for the render. The dispatch fires the
      // editor:render event — the constructor listener updates word/
      // character counts and <PreviewPane> writes innerHTML.
      setTimeout(() => {
        this.dispatcher.render();
      }, 150);
    });

    // Track the editor scroll state and update the preview scroll position to match.
    // Note: this method isn't perfect, for example, in cases of large images there is
    // a slight discrepancy of about 20-30px, but for the most part it works.
    this.mkeditor?.onDidScrollChange(() => {
      if (this.providers.settings?.getSetting('scrollsync')) {
        const visibleRange = this.mkeditor?.getVisibleRanges()[0];
        if (visibleRange) {
          // Note: requires markdown line-numbers extension to be active
          ScrollSync(visibleRange.startLineNumber, dom.preview.wrapper);
        }
      }
    });
  }
}
