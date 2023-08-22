import md from './markdown';
import { copyableCodeBlocks } from './extensions/code-blocks';
import { wordCount, characterCount } from './extensions/word-count';
import { scrollPreviewToEditorVisibleRange } from './extensions/scroll-sync';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * Editor
 */
class Editor {
    /**
     * Create a Editor instance.
     *
     * @param {*} editor the HTML element for the editor
     * @param {*} preview the HTML element for the preview
     * @param {*} dispatcher the custom event dispatcher for the editor
     */
    constructor (editor, preview, dispatcher) {
        // Active editor
        this.instance = null;

        // Editor and preview DOM
        this.editor = editor;
        this.preview = preview;

        // Access to handlers
        this.commandHandler = null;
        this.settingsHandler = null;
        this.ipcHandler = null;

        // Track initial editor value for comparison to current value
        this.loadedInitialEditorValue = null;

        // Event dispatcher
        this.dispatcher = dispatcher;
    }

    /**
     * Create a new editor instance.
     *
     * @param {*} options
     * @returns {editor.IStandaloneCodeEditor|null}
     */
    init (options = { watch: false }) {
        try {
            this.instance = editor.create(this.editor, {
                value: '',
                language: 'markdown',
                wordBasedSuggestions: false,
                autoIndent: this.autoIndent,
                wordWrap: this.wordWrap,
                renderWhitespace: this.whitespace,
                renderLineHighlight: 'gutter',
                smoothScrolling: 'true',
                roundedSelection: false,
                accessibilityPageSize: 1000
            });

            this.loadedInitialEditorValue = this.instance.getValue();
            this.dispatcher.addEventListener('editor:state', (event) => {
                this.loadedInitialEditorValue = event.message;
            });

            const saveButton = document.querySelector('#save-settings-ipc');
            if (saveButton) {
                saveButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    if (this.ipcHandler && this.settingsHandler) {
                        this.ipcHandler.saveSettingsToFile(
                            this.settingsHandler.getActiveSettings()
                        );
                    }
                });
            }

            window.onresize = () => this.instance.layout();
            this.preview.onresize = () => this.instance.layout();

            this.render();

            if (options.watch) {
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
            if (this.ipcHandler) {
                this.ipcHandler.trackEditorStateBetweenExecutionContext(
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
        this.wordWrap = settings.toggleWordWrap ? 'on' : 'off';
        this.autoIndent = settings.toggleAutoIndent ? 'advanced' : 'none';
        this.whitespace = settings.toggleWhitespace ? 'all' : 'none';
        this.minimap = settings.toggleMinimap ? { enabled: true } : { enabled: 'false' };
        this.foldingControls = settings.showFoldingControls ? 'always' : 'never';

        editor.setTheme(this.toggleDarkMode ? 'vs-dark' : 'gdmTheme');

        this.instance.updateOptions({ wordWrap: this.wordWrap });
        this.instance.updateOptions({ autoIndent: this.autoIndent });
        this.instance.updateOptions({ renderWhitespace: this.whitespace });
        this.instance.updateOptions({ minimap: this.minimap });
        this.instance.updateOptions({ showFoldingControls: this.foldingControls });
    }

    /**
     * Register a command handler.
     *
     * @param {*} handler
     * @returns
     */
    registerCommandHandler (handler) {
        this.commandHandler = handler;
    }

    /**
     * Register a settings handler.
     *
     * @param {*} handler
     * @returns
     */
    registerSettingsHandler (handler) {
        this.settingsHandler = handler;
    }

    /**
     * Register an IPC handler.
     *
     * @param {*} handler
     * @returns
     */
    registerIpcHandler (handler) {
        this.ipcHandler = handler;
    }
}

export default Editor;
