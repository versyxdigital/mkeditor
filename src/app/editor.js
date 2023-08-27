import md from './markdown';
import { generateExportHTML } from './export';
import { welcomeMarkdown } from './utilities/intro';
import { copyableCodeBlocks } from './extensions/code-blocks';
import { wordCount, characterCount } from './extensions/word-count';
import { scrollPreviewToEditorVisibleRange } from './extensions/scroll-sync';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * Editor
 */
class Editor {
    /**
     * @var {editor.IStandaloneCodeEditor|null}
     */
    instance = null;

    /**
     * @var {string|null}
     */
    loadedInitialEditorValue = null;

    /**
     * @var {{command: *, ipc: *, settings: *}}
     */
    handlers = {
        command: null,
        ipc: null,
        settings: null
    };

    /**
     * Create a Editor instance.
     *
     * @param {HTMLDivElement} editor the HTML element for the editor
     * @param {HTMLDivElement} preview the HTML element for the preview
     * @param {EventDispatcher} dispatcher the custom event dispatcher for the editor
     */
    constructor (editor, preview, dispatcher) {
        // Editor and preview DOM
        this.editor = editor;
        this.preview = preview;

        // Event dispatcher
        this.dispatcher = dispatcher;
    }

    /**
     * Attach handler
     * @param {string} handler
     * @param {object} instance
     */
    attach (handler, instance) {
        this.handlers[handler] = instance;
    }

    /**
     * Create a new editor instance.
     *
     * @param {{watch: boolean}} watch
     * @returns {editor.IStandaloneCodeEditor}
     */
    create ({ watch = false }) {
        try {
            // Create the underlying monaco editor instance.
            // See https://microsoft.github.io/monaco-editor/
            this.instance = editor.create(this.editor, {
                value: welcomeMarkdown.trim(),
                language: 'markdown',
                wordBasedSuggestions: false,
                autoIndent: 'advanced',
                wordWrap: 'on',
                renderWhitespace: 'all',
                renderLineHighlight: 'gutter',
                smoothScrolling: 'true',
                roundedSelection: false,
                accessibilityPageSize: 1000
            });

            // Set loadedInitialEditorValue for tracking; this value is used
            // to compare to the current editor content to see if changes have
            // occurred, the result of this comparison is used for various things
            // such as modifying the title to notify the user of unsaved changes,
            // prompting the user to save before opening new files, etc.
            this.loadedInitialEditorValue = this.instance.getValue();
            this.dispatcher.addEventListener('editor:state', (event) => {
                this.loadedInitialEditorValue = event.message;
            });

            this.registerContextListeners();

            // Resize listeners to resize the editor.
            window.onload = () => this.instance.layout();
            window.onresize = () => this.instance.layout();
            this.preview.onresize = () => this.instance.layout();

            // Render the editor content to preview; also initialises editor
            // extensions.
            this.render();

            if (watch) {
                // Watch the editor for changes, updates the preview and and copntains
                // various event listeners.
                this.watch();
            }
        } catch (error) {
            this.instance = null;
            console.log(error);
        }

        return this.instance;
    }

    /**
     * Register editor context listeners.
     */
    registerContextListeners () {
        // Register the event listener for editor UI save settings button; this button
        // is executed from within the web context, and uses the IPC handler to fire an
        // event to the main process, which has access to the filesystem.
        // The main process receives the current settings and saves them to file.
        const saveSettingsButton = document.querySelector('#save-app-settings');
        if (saveSettingsButton) {
            saveSettingsButton.addEventListener('click', (event) => {
                event.preventDefault();
                const { ipc, settings } = this.handlers;
                if (ipc && settings) {
                    ipc.saveSettingsToFile(settings.getSettings());
                }
            });
        }

        // Register the event listener for editor UI save file button; this button is
        // also executed from within the web context, and also uses the IPC handler to
        // fire an event to the main process, which in turn handles the action of opening
        // the save dialog, saving the content to file etc.
        const saveMarkdownButton = document.querySelector('#save-editor-markdown');
        if (saveMarkdownButton) {
            saveMarkdownButton.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.handlers.ipc) {
                    this.handlers.ipc.saveContentToFile();
                }
            });
        }

        // Register the event listener for the editor UI export preview button; this
        // button is also executed from within the web context and functions in pretty
        // much the same way as above.
        const exportPreviewButton = document.querySelector('#export-preview-html');
        if (exportPreviewButton) {
            exportPreviewButton.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.handlers.ipc) {
                    this.handlers.ipc.exportPreviewToFile(
                        generateExportHTML(this.preview.innerHTML, {
                            styled: document.querySelector('#export-preview-styled').checked,
                            providers: ['bootstrap', 'fontawesome', 'highlightjs']
                        })
                    );
                }
            });
        }
    }

    /**
     * Render editor content to the preview.
     *
     * @returns
     */
    render () {
        // Render the editor markdown to HTML.
        this.preview.innerHTML = md.render(this.instance.getValue());

        // Track code blocks and make them copyable.
        copyableCodeBlocks();

        // Track word cound and charactcer count.
        wordCount(this.preview);
        characterCount(this.preview);
    }

    /**
     * Watch the editor for changes.
     *
     * @returns
     */
    watch () {
        // When the editor content changes, update the main process through the IPC handler
        // so that it can do things such as set the title notifying the user of unsaved changes,
        // prompt the user to save if they try to close the app or open a new file, etc.
        this.instance.onDidChangeModelContent(() => {
            if (this.handlers.ipc) {
                this.handlers.ipc.trackEditorStateBetweenExecutionContext(
                    // The initial editor content
                    this.loadedInitialEditorValue,
                    // The current editor content
                    this.instance.getValue()
                );
            }

            // Add a small timeout for the render.
            setTimeout(() => {
                // Update the rendered content in the preview.
                this.render();
            }, 250);
        });

        // Track the editor scroll state and update the preview scroll position to match.
        // Note: this method isn't perfect, for example, in cases of large images there is
        // a slight discrepancy of about 20-30px, but for the most part it works.
        this.instance.onDidScrollChange(() => {
            const visibleRange = this.instance.getVisibleRanges()[0];
            if (visibleRange) {
                scrollPreviewToEditorVisibleRange(
                    visibleRange.startLineNumber,
                    this.preview
                );
            }
        });
    }
}

export default Editor;
