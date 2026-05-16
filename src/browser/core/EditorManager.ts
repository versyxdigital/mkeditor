import { editor, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';
import type { EditorProviders } from '../interfaces/Providers';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { ScrollSync } from '../extensions/editor/ScrollSync';
import { welcomeMarkdown } from '../assets/intro';
import { debounce, logger } from '../util';
import { dom } from '../dom';

interface EditorConstructOptions {
  mode: 'web' | 'desktop';
  dispatcher: EditorDispatcher;
  init?: boolean | undefined;
  watch?: boolean | undefined;
}

interface EditorCreateOptions {
  mount?: HTMLElement | null;
  watch?: boolean;
}

export class EditorManager {
  /** App mode */
  private mode: 'web' | 'desktop';

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
    this.mode = opts.mode;
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
      // reload. Phase 2 exit criterion: Monaco is created exactly once.
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

    try {
      let editorContent = welcomeMarkdown;
      // For web mode, fetch stored content from localStorage.
      // Web-mode delete-button click is wired by <EditorToolbar> via
      // editorManager.resetContent() (Phase 6 onwards).
      if (this.mode === 'web') {
        const webStoredContent = localStorage.getItem('mkeditor-content');
        if (webStoredContent) editorContent = webStoredContent;
      }

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
      // console.info (not logger.info) so the breadcrumb is visible in the
      // renderer devtools in both web and desktop modes — needed for the
      // Phase 2 exit-criterion smoke check.
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
   * Web-mode "Delete content" handler — clears persisted markdown from
   * `localStorage` and reloads the welcome page. Called by
   * <EditorToolbar>'s trash button (visible only in web mode).
   */
  public resetContent() {
    if (this.mode === 'web') {
      localStorage.removeItem('mkeditor-content');
    }
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
   * Track content over the execution bridge.
   */
  public updateBridgedContent({ init }: { init?: boolean } = {}) {
    if (!this.providers.bridge) {
      // For web mode, store changes in localStorage
      if (this.mode === 'web' && this.mkeditor) {
        localStorage.setItem('mkeditor-content', this.mkeditor.getValue());
      }
      return;
    }

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
