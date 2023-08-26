import md from './markdown';
import { generateExportHTML } from './export';
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
     * @var {object}
     */
    handlers = {
        command: null,
        ipc: null,
        settings: null
    };

    /**
     * Create a Editor instance.
     *
     * @param {*} editor the HTML element for the editor
     * @param {*} preview the HTML element for the preview
     * @param {*} dispatcher the custom event dispatcher for the editor
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
            this.instance = editor.create(this.editor, {
                value: '# Write something cool...',
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

            this.loadedInitialEditorValue = this.instance.getValue();
            this.dispatcher.addEventListener('editor:state', (event) => {
                this.loadedInitialEditorValue = event.message;
            });

            const saveSettingsButton = document.querySelector('#save-settings-ipc');
            if (saveSettingsButton) {
                saveSettingsButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    const { ipc, settings } = this.handlers;
                    if (ipc && settings) {
                        ipc.saveSettingsToFile(settings.getSettings());
                    }
                });
            }

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

            // Resize listeners.
            window.onload = () => this.instance.layout();
            window.onresize = () => this.instance.layout();
            this.preview.onresize = () => this.instance.layout();

            this.render();

            if (watch) {
                this.watch();
            }
        } catch (error) {
            this.instance = null;
            console.log(error);
        }

        return this.instance;
    }

    /**
     * Watch the editor for changes.
     *
     * @returns
     */
    watch () {
        this.instance.onDidChangeModelContent(() => {
            if (this.handlers.ipc) {
                this.handlers.ipc.trackEditorStateBetweenExecutionContext(
                    this.loadedInitialEditorValue,
                    this.instance.getValue()
                );
            }

            setTimeout(() => {
                this.render();
            }, 250);
        });

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

    /**
     * Render editor content to the preview.
     *
     * @returns
     */
    render () {
        this.preview.innerHTML = md.render(this.instance.getValue());

        copyableCodeBlocks();
        wordCount(this.preview);
        characterCount(this.preview);
    }

    /**
     * Apply settings from IPC.
     *
     * @param {*} settings
     * @returns
     */
    applySettingsFromIpcStorage (settings) {
        this.instance.updateOptions({
            autoIndent: settings.toggleAutoIndent
                ? 'advanced'
                : 'none'
        });

        this.instance.updateOptions({
            wordWrap: settings.toggleWordWrap
                ? 'on'
                : 'off'
        });

        this.instance.updateOptions({
            renderWhitespace: settings.toggleWhitespace
                ? 'all'
                : 'none'
        });

        this.instance.updateOptions({
            minimap: settings.toggleMinimap
                ? { enabled: true }
                : { enabled: 'false' }
        });

        this.instance.updateOptions({
            showFoldingControls: settings.showFoldingControls
                ? 'always'
                : 'never'
        });
    }
}

export default Editor;
