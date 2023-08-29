const { ipcMain } = require('electron');
const storage = require('./storage');

module.exports = class IPC {
    constructor (context, handlers = { settings: null, dialog: null }, register = false) {
        this.context = context;
        this.contextWindowTitle = 'MKEditor';
        this.contextBridgedContent = {
            original: null,
            current: null
        };

        this.handlers = handlers;

        if (register) {
            this.register();
        }
    }

    /**
     * Register IPC event listeners to the execution context
     *
     * @param {*} context
     */
    register () {
        ipcMain.on('to:title:set', (event, title = null) => {
            if (title) {
                this.contextWindowTitle = `MKEditor - ${title}`;
            }

            this.context.setTitle(this.contextWindowTitle);
        });

        ipcMain.on('to:editor:state', (event, { original, current }) => {
            this.updateContextBridgedContent(original, current);

            if (this.contextBridgedContentHasChanged()) {
                this.context.setTitle(`${this.contextWindowTitle} - *(Unsaved Changes)*`);
            } else {
                this.context.setTitle(this.contextWindowTitle);
            }
        });

        ipcMain.on('to:settings:save', (event, { settings }) => {
            this.handlers.settings.saveSettingsToFile(settings);
        });

        ipcMain.on('to:html:export', (event, { content }) => {
            storage.save(this.context, {
                id: event.sender.id,
                data: content
            });
        });

        ipcMain.on('to:file:new', (event, { content, file }) => {
            storage.create(this.context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });

        ipcMain.on('to:file:save', (event, { content, file }) => {
            storage.save(this.context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });

        ipcMain.on('to:file:saveas', (event, data) => {
            storage.save(this.context, {
                id: event.sender.id,
                data
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });
    }

    promptForChangedContextBridgeContent (event = null) {
        if (this.contextBridgedContentHasChanged()) {
            return this.handlers.dialog.promptUserForUnsavedChanges(event);
        }
    }

    contextBridgedContentHasChanged () {
        return this.contextBridgedContent.current !== this.contextBridgedContent.original;
    }

    updateContextBridgedContent (orginal, current) {
        this.contextBridgedContent.original = orginal;
        this.contextBridgedContent.current = current;
    }

    resetContextBridgedContent () {
        this.contextBridgedContent.original = null;
        this.contextBridgedContent.current = null;
    }
};