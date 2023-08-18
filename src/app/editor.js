import md from './markdown';
import copyCodeBlocks from './extensions/code-blocks';
import { wordCount, characterCount } from './extensions/word-count';
import { scrollPreviewToEditorVisibleRange } from './extensions/scroll-sync';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';

class Editor {
    constructor (editor, preview) {
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
    }

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
            window.addEventListener('editor:state', (event) => {
                this.loadedInitialEditorValue = event.detail;
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

    watch () {
        this.instance.onDidChangeModelContent(() => {
            if (this.ipcHandler) {
                this.ipcHandler.trackEditorStateBetweenExecutionContext(
                    this.loadedInitialEditorValue,
                    this.instance.getValue()
                );
            }

            this.render();
        });

        this.instance.onDidScrollChange(() => {
            const visibleRange = this.instance.getVisibleRanges()[0];
            if (visibleRange) {
                scrollPreviewToEditorVisibleRange(visibleRange.startLineNumber, this.preview);
            }
        });

        this.instance.onKeyDown((e) => {
            if (e.ctrlKey && e.keyCode === 42 /* L */) {
                this.commandHandler.alerts.toggle();
            }

            if (e.ctrlKey && e.keyCode === 41 /* K */) {
                this.commandHandler.codeblocks.toggle();
            }

            this.instance.focus();
        });
    }

    render () {
        this.preview.innerHTML = md.render(this.instance.getValue());

        copyCodeBlocks();
        wordCount(this.preview);
        characterCount(this.preview);
    }

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

    registerCommandHandler (handler) {
        this.commandHandler = handler;
    }

    registerSettingsHandler (handler) {
        this.settingsHandler = handler;
    }

    registerIpcHandler (handler) {
        this.ipcHandler = handler;
    }
}

export default Editor;
