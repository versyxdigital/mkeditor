import notify from '../utilities/notify';
import { editor } from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * IPC Handler
 *
 * Facilitates communication between the main/renderer execution contexts.
 */
export default class IPCHandler {
    /**
     * @var {{settings: *, command: *}}
     */
    handlers = {
        settings: null,
        command: null
    };

    /**
     * @var {string|null}
     */
    activeFile = null;

    /**
     * Create a new IPC handler
     *
     * @param {*} editor the editor
     * @param {*} bridge the context bridge to the main process
     * @param {*} dispatcher the custom event dispatcher
     * @param {boolean} register register event handlers from construcor
     */
    constructor (editor, bridge, dispatcher, register = false) {
        this.editor = editor;
        this.bridge = bridge;
        this.dispatcher = dispatcher;

        if (register) {
            this.register();
        }
    }

    /**
     * Attach handlers
     *
     * @param {string} handler
     * @param {object} instance
     */
    attach (handler, instance) {
        this.handlers[handler] = instance;
    }

    /**
     * Register IPC event handlers.
     *
     * @return {void}
     */
    register () {
        // Set the theme according to the user's system theme
        this.bridge.receive('from:theme:set', (shouldUseDarkMode) => {
            if (shouldUseDarkMode) {
                const icon = document.querySelector('#darkModeIcon');
                icon.classList.remove('text-dark');
                icon.classList.add('text-warning');

                const toggle = document.querySelector('#toggleDarkMode');
                toggle.checked = true;

                document.body.setAttribute('data-theme', 'dark');
                editor.setTheme('vs-dark');
            }
        });

        // Set settings from stored settings file (%HOME%/.mkeditor/settings.json)
        this.bridge.receive('from:settings:set', (settings) => {
            this.loadSettingsFromStorageChannel(settings);
            this.handlers.settings.setSettings(settings);
            this.handlers.settings.register();
        });

        // Enable new files from outside of the renderer execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.bridge.receive('from:file:new', (channel) => {
            this.bridge.send('to:title:set', '');
            this.bridge.send(channel, {
                content: this.editor.getValue(),
                file: this.activeFile
            });
        });

        // Enable saving files from outside of the renderer execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.bridge.receive('from:file:save', (channel) => {
            this.bridge.send(channel, {
                content: this.editor.getValue(),
                file: this.activeFile
            });
        });

        this.bridge.receive('from:file:saveas', (channel) => {
            this.bridge.send(channel, this.editor.getValue());
        });

        // Enable opening files from outside of the renderer execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.bridge.receive('from:file:open', ({ content, filename, file }) => {
            this.editor.focus();
            this.editor.setValue(content);
            this.activeFile = file;

            // Dispatch contents so the editor can track it.
            this.dispatcher.setState({
                content: this.editor.getValue()
            });

            this.trackEditorStateBetweenExecutionContext(content, content);

            document.querySelector('#active-file').innerText = filename;

            this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
        });

        // Enable access to the monaco editor command palette.
        this.bridge.receive('from:command:palette', (command) => {
            this.editor.focus();
            this.editor.trigger(command, 'editor.action.quickCommand');
        });

        // Enable access to the monaco editor shortcuts modal.
        this.bridge.receive('from:modal:open', (modal) => {
            if (this.handlers.command && this.handlers.command[modal]) {
                this.handlers.command[modal].toggle();
            }
        });

        // Enable notifications from the main context.
        this.bridge.receive('from:notification:display', (event) => {
            notify.send(event.status, event.message);
        });
    }

    /**
     * Save settings to the settings file.
     *
     * @param {*} settings
     */
    saveSettingsToFile (settings) {
        this.bridge.send('to:settings:save', { settings });
    }

    /**
     * Save editor content to markdown file.
     */
    saveContentToFile () {
        if (this.activeFile) {
            this.bridge.send('to:file:save', {
                content: this.editor.getValue(),
                file: this.activeFile
            });
        } else {
            this.bridge.send('to:file:saveas', this.editor.getValue());
        }
    }

    /**
     * Export preview to html file.
     *
     * @param {string} content
     */
    exportPreviewToFile (content) {
        this.bridge.send('to:html:export', { content });
    }

    /**
     * Track editor state between the original document and whatever changes have
     * been made.
     *
     * @param {string} original
     * @param {string} current
     */
    trackEditorStateBetweenExecutionContext (original, current) {
        this.bridge.send('to:editor:state', { original, current });
    }

    /**
     * Apply settings from IPC.
     *
     * @param {*} settings
     * @returns
     */
    loadSettingsFromStorageChannel (settings) {
        this.editor.updateOptions({
            autoIndent: settings.toggleAutoIndent
                ? 'advanced'
                : 'none'
        });

        this.editor.updateOptions({
            wordWrap: settings.toggleWordWrap
                ? 'on'
                : 'off'
        });

        this.editor.updateOptions({
            renderWhitespace: settings.toggleWhitespace
                ? 'all'
                : 'none'
        });

        this.editor.updateOptions({
            minimap: settings.toggleMinimap
                ? { enabled: true }
                : { enabled: 'false' }
        });

        this.editor.updateOptions({
            showFoldingControls: settings.showFoldingControls
                ? 'always'
                : 'never'
        });
    }
}
