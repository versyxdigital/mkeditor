import { editor, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';
import type { EditorProviders } from '../interfaces/Providers';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { CharacterCount, WordCount } from '../extensions/editor/WordCount';
import { ScrollSync, refreshLines } from '../extensions/editor/ScrollSync';
import { registerUIToolbarListeners } from './ToolbarListeners';
import { Markdown } from './Markdown';
import { APP_VERSION } from '../version';
import { welcomeMarkdown } from '../assets/intro';
import { debounce, logger } from '../util';
import { dom } from '../dom';

interface EditorConstructOptions {
  mode: 'web' | 'desktop';
  dispatcher: EditorDispatcher;
  init?: boolean | undefined;
  watch?: boolean | undefined;
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

    dom.about.version.innerHTML = APP_VERSION;
    dom.build.innerHTML = `v${APP_VERSION}`;

    this.dispatcher.addEventListener('editor:render', () => {
      const value = this.mkeditor?.getValue() ?? '';
      WordCount(value);
      CharacterCount(value);
      this.render(value);
    });

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
   * @param watch - flag to watch the editor for changes
   * @returns
   */
  public create({ watch = false }) {
    try {
      let editorContent = welcomeMarkdown;
      // For web mode, fetch stored content from localStorage
      if (this.mode === 'web') {
        const webStoredContent = localStorage.getItem('mkeditor-content');
        if (webStoredContent) editorContent = webStoredContent;

        dom.buttons.delete.addEventListener('click', () => {
          localStorage.removeItem('mkeditor-content');
          this.mkeditor?.setValue(welcomeMarkdown);
        });
      }

      // Create the underlying monaco editor.
      // See https://microsoft.github.io/monaco-editor/
      this.mkeditor = editor.create(dom.editor.dom, {
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

      // Set loadedInitialEditorValue for tracking file changes.
      this.loadedInitialEditorValue = this.mkeditor.getValue();
      this.dispatcher.addEventListener('editor:track:content', (event) => {
        this.loadedInitialEditorValue = event.detail;
      });

      // Event listeners for the renderer context's UI toolbar.
      registerUIToolbarListeners(this.mkeditor, this.providers);

      // Resize listeners to resize the editor.
      window.onload = () => this.mkeditor?.layout();
      window.onresize = () => this.mkeditor?.layout();
      dom.preview.dom.onresize = () => this.mkeditor?.layout();

      // Initialize word count and character count values
      const value = this.mkeditor.getValue();
      WordCount(value);
      CharacterCount(value);

      // Render the editor content to preview.
      this.render(value);

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
   * Render the editor.
   */
  public render(value?: string) {
    if (!this.mkeditor) {
      logger?.error('EditorManager.render', 'No editor instance.');
      return;
    }

    const content = value ?? this.mkeditor.getValue();
    dom.preview.dom.innerHTML = Markdown.render(content);
    refreshLines();
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

      // Add a small timeout for the render.
      setTimeout(() => {
        const value = this.mkeditor?.getValue() ?? '';
        WordCount(value);
        CharacterCount(value);

        // Update the rendered content in the preview.
        this.render(value);
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
