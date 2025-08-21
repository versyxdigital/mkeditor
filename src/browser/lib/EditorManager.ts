import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorProviders } from '../interfaces/Providers';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { CharacterCount, WordCount } from '../extensions/WordCount';
import { ScrollSync, invalidateLineElements } from '../extensions/ScrollSync';
import { welcomeMarkdown } from '../assets/intro';
import { Markdown } from './Markdown';
import { Exporter } from './Exporter';
import { APP_VERSION } from '../version';
import { dom } from '../dom';

const debounce = <F extends (...args: any[]) => void>(fn: F, wait: number) => {
  let timeout: number | null = null;
  return (...args: Parameters<F>) => {
    if (timeout) {
      window.clearTimeout(timeout);
    }

    timeout = window.setTimeout(() => {
      timeout = null;
      fn(...args);
    }, wait);
  };
};

interface EditorConstructArgs {
  dispatcher: EditorDispatcher;
  init?: boolean | undefined;
  watch?: boolean | undefined;
}

export class EditorManager {
  /** Editor instance */
  private mkeditor: editor.IStandaloneCodeEditor | null = null;

  /** Editor event dispatcher */
  private dispatcher: EditorDispatcher;

  /** The loaded original editor value for tracking */
  private loadedInitialEditorValue: string | null = null;

  /** The editor HTML element (mount point) */
  private editorHTMLElement: HTMLElement;

  /** The preview HTML element (mount point) */
  private previewHTMLElement: HTMLElement;

  /** Editor functional providers */
  public providers: EditorProviders = {
    bridge: null,
    commands: null,
    completion: null,
    settings: null,
  };

  /**
   * Create a new mkeditor.
   */
  public constructor(opts: EditorConstructArgs) {
    this.dispatcher = opts.dispatcher;
    this.editorHTMLElement = dom.editor.dom;
    this.previewHTMLElement = dom.preview.dom;

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
      // Create the underlying monaco editor.
      // See https://microsoft.github.io/monaco-editor/
      this.mkeditor = editor.create(this.editorHTMLElement, {
        value: welcomeMarkdown,
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

      // Set loadedInitialEditorValue for tracking; this value is used
      // to compare to the current editor content to see if changes have
      // occurred, the result of this comparison is used for various things
      // such as modifying the title to notify the user of unsaved changes,
      // prompting the user to save before opening new files, etc.
      this.loadedInitialEditorValue = this.mkeditor.getValue();
      this.dispatcher.addEventListener('editor:track:content', (event) => {
        this.loadedInitialEditorValue = event.message;
      });

      // Event listeners for the renderer context's UI toolbar.
      this.registerUIToolbarListeners();

      // Resize listeners to resize the editor.
      window.onload = () => this.mkeditor?.layout();
      window.onresize = () => this.mkeditor?.layout();
      this.previewHTMLElement.onresize = () => this.mkeditor?.layout();

      // Initialize word count and character count values
      const value = this.mkeditor.getValue();
      WordCount(value);
      CharacterCount(value);

      // Render the editor content to preview; also initialises editor
      // extensions.
      this.render(value);

      if (watch) {
        // Watch the editor for changes, updates the preview and and copntains
        // various event listeners.
        this.watch();
      }
    } catch (err) {
      this.mkeditor = null;
      console.log(err);
    }

    return this;
  }

  /**
   * Track content over the execution bridge.
   */
  public updateBridgedContent({ init }: { init?: boolean } = {}) {
    if (!this.providers.bridge) {
      return false;
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
    if (this.mkeditor) {
      const content = value ?? this.mkeditor.getValue();
      this.previewHTMLElement.innerHTML = Markdown.render(content);
      invalidateLineElements();
    }
  }

  /**
   * Watch and re-render the editor for changes.
   */
  public watch() {
    const debouncedUpdateBridgedContent = debounce(
      () => this.updateBridgedContent(),
      250,
    );

    // When the editor content changes, update the main process through the IPC handler
    // so that it can do things such as set the title notifying the user of unsaved changes,
    // prompt the user to save if they try to close the app or open a new file, etc.
    this.mkeditor?.onDidChangeModelContent((event) => {
      // Update the tracked content over the execution bridge.
      debouncedUpdateBridgedContent();

      // Register dynamic completions provider to provide completion suggestions based on
      // user input.
      this.providers.completion?.changeOnValidProposal(event.changes[0].text);

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
      const visibleRange = this.mkeditor?.getVisibleRanges()[0];
      if (visibleRange) {
        // Note: requires markdown line-numbers extension to be active
        ScrollSync(visibleRange.startLineNumber, this.previewHTMLElement);
      }
    });
  }

  /**
   * Get the current editor instance.
   * @returns
   */
  public getMkEditor() {
    return this.mkeditor;
  }

  /**
   * Register listeners for cross-context events.
   */
  private registerUIToolbarListeners() {
    // Register the event listener for editor UI save settings button; this button
    // is executed from within the web context, and uses the IPC handler to fire an
    // event to the main process, which has access to the filesystem.
    // The main process receives the current settings and saves them to file.
    if (dom.buttons.save.settings) {
      dom.buttons.save.settings.addEventListener('click', (event) => {
        event.preventDefault();
        const { bridge, settings } = this.providers;
        if (bridge && settings) {
          bridge.saveSettingsToFile(settings.getSettings());
        }
      });
    }

    // Register the event listener for editor UI save file button; this button is
    // also executed from within the web context, and also uses the IPC handler to
    // fire an event to the main process, which in turn handles the action of opening
    // the save dialog, saving the content to file etc.
    if (dom.buttons.save.markdown) {
      dom.buttons.save.markdown.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.mkeditor) {
          if (this.providers.bridge) {
            this.providers.bridge.saveContentToFile();
          } else {
            Exporter.webExportToFile(
              this.mkeditor.getValue(),
              'text/plain',
              '.md',
            );
          }
        }
      });
    }

    // Register the event listener for the editor UI export preview button; this
    // button is also executed from within the web context and functions in pretty
    // much the same way as above.
    if (dom.buttons.save.preview) {
      dom.buttons.save.preview.addEventListener('click', (event) => {
        event.preventDefault();
        const styled = <HTMLInputElement>dom.buttons.save.styled;
        const html = Exporter.generateExportHTML(
          this.previewHTMLElement.innerHTML,
          {
            styled: styled.checked,
            providers: ['bootstrap', 'fontawesome', 'highlightjs'],
          },
        );

        if (this.providers.bridge) {
          this.providers.bridge.exportPreviewToFile(html);
        } else {
          Exporter.webExportToFile(html, 'text/html', '.html');
        }
      });
    }
  }
}
