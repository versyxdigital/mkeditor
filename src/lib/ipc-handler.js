const storage = require('./storage');

module.exports = class IpcHandler {
    constructor (ipc, settingsHandler) {
        this.ipc = ipc;
        this.contextWindowTitle = 'MKEditor';
        this.contextBridgedContent = {
            original: null,
            current: null
        };
        this.settingsHandler = settingsHandler;
    }

    /**
     * Register IPC event listeners to the execution context
     *
     * @param {*} context
     */
    register (context) {
        this.ipc.on('to:set:title', (event, title = null) => {
            if (title) {
                this.contextWindowTitle = `MKEditor - ${title}`;
            }

            context.setTitle(this.contextWindowTitle);
        });

        this.ipc.on('to:editor:state', (event, { original, current }) => {
            this.updateContextBridgedContent(original, current);

            if (this.contextBridgedContentHasChanged()) {
                context.setTitle(`${this.contextWindowTitle} - *(Unsaved Changes)*`);
            } else {
                context.setTitle(this.contextWindowTitle);
            }
        });

        this.ipc.on('to:settings:save', (event, { settings }) => {
            this.settingsHandler.saveSettingsToFile(settings);
        });

        this.ipc.on('to:request:new', (event, { content, file }) => {
            storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });

        this.ipc.on('to:request:save', (event, { content, file }) => {
            storage.save(context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });

        this.ipc.on('to:request:saveas', (event, data) => {
            storage.save(context, {
                id: event.sender.id,
                data
            }).then(() => {
                this.resetContextBridgedContent();
            });
        });
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
