import { editor, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';
import type { EditorProviders } from '../interfaces/Providers';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import { CharacterCount, WordCount } from '../extensions/editor/WordCount';
import {
  ScrollSync,
  invalidateLineElements,
} from '../extensions/editor/ScrollSync';
import { Markdown } from './Markdown';
import { HTMLExporter } from './HTMLExporter';
import { APP_VERSION } from '../version';
import { exportSettings as defaultExportSettings } from '../config';
import { welcomeMarkdown } from '../assets/intro';
import { debounce } from '../util';
import { dom } from '../dom';

interface EditorConstructOptions {
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
      this.mkeditor = editor.create(dom.editor.dom, {
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
      dom.preview.dom.onresize = () => this.mkeditor?.layout();

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
      dom.preview.dom.innerHTML = Markdown.render(content);
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
      // Auto-continue list markers when Enter was pressed
      this.providers?.completion?.autoContinueListMarkers(event);

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
      if (this.providers.settings?.getSetting('scrollsync')) {
        const visibleRange = this.mkeditor?.getVisibleRanges()[0];
        if (visibleRange) {
          // Note: requires markdown line-numbers extension to be active
          ScrollSync(visibleRange.startLineNumber, dom.preview.wrapper);
        }
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
    if (dom.buttons.save.settings) {
      dom.buttons.save.settings.addEventListener('click', (event) => {
        event.preventDefault();
        const { bridge, settings, exportSettings } = this.providers;
        if (bridge && settings && exportSettings) {
          bridge.saveSettingsToFile({
            ...settings.getSettings(),
            exportSettings: exportSettings.getSettings(),
          });
        }
      });
    }

    if (dom.buttons.save.exportSettings) {
      dom.buttons.save.exportSettings.addEventListener('click', (event) => {
        event.preventDefault();
        const { bridge, settings, exportSettings } = this.providers;
        if (bridge && settings && exportSettings) {
          bridge.saveSettingsToFile({
            ...settings.getSettings(),
            exportSettings: exportSettings.getSettings(),
          });
        }
      });
    }

    if (dom.buttons.resetExportSettings) {
      dom.buttons.resetExportSettings.addEventListener('click', (event) => {
        event.preventDefault();
        const { bridge, settings, exportSettings } = this.providers;
        if (exportSettings) {
          const defaults = exportSettings.getDefaultSettings();
          exportSettings.setSettings(defaults);
          if (bridge && settings) {
            bridge.saveSettingsToFile({
              ...settings.getSettings(),
              exportSettings: defaults,
            });
          } else {
            exportSettings.updateSettingsInLocalStorage();
          }
        }
      });
    }

    if (dom.buttons.save.markdown) {
      dom.buttons.save.markdown.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.mkeditor) {
          if (this.providers.bridge) {
            this.providers.bridge.saveContentToFile();
          } else {
            HTMLExporter.webExport(
              this.mkeditor.getValue(),
              'text/plain',
              '.md',
            );
          }
        }
      });
    }

    /**
     * Get the rendered HTML for export.
     * @returns - the rendered HTML
     */
    const generateHTMLForExport = () => {
      const settings =
        this.providers.exportSettings?.getSettings() ?? defaultExportSettings;

      return HTMLExporter.generateHTML(dom.preview.dom.outerHTML, settings);
    };

    // Register the event listener for the editor UI export HTML button.
    if (dom.buttons.save.html) {
      dom.buttons.save.html.addEventListener('click', (event) => {
        event.preventDefault();
        const html = generateHTMLForExport();

        if (this.providers.bridge) {
          this.providers.bridge.exportToDifferentFormat({
            content: html,
            type: 'html',
          });
        } else {
          HTMLExporter.webExport(html, 'text/html', '.html');
        }
      });
    }

    // Register the event listener for the editor UI export PDF button.
    if (dom.buttons.save.pdf) {
      dom.buttons.save.pdf.addEventListener('click', (event) => {
        event.preventDefault();
        const html = generateHTMLForExport();

        if (this.providers.bridge) {
          this.providers.bridge.exportToDifferentFormat({
            content: html,
            type: 'pdf',
          });
        } else {
          HTMLExporter.webExport(html, 'text/html', '.pdf');
        }
      });
    }
  }
}
