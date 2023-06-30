const storage = require('./storage')

module.exports = class IpcHandler
{
    constructor(ipc) {
        this.ipc = ipc
        this.contextBridgedContent = {
            original: null,
            current: null
        }
    }

    /**
     * Register IPC event listeners to the execution context
     * 
     * @param {*} context 
     */
    register(context) {
        this.ipc.on('to:set:title', (event, title) => {
            context.setTitle(`MKEditor - ${title}`)
        })

        this.ipc.on('to:editor:state', (event, { original, current }) => {
            this.updateContextBridgedContent(original, current)
        })

        this.ipc.on('to:request:new', (event, { content, file }) => {
            storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent()
            })            
        })

        this.ipc.on('to:request:save', (event, { content, file }) => {
            storage.save(context, {
                id: event.sender.id,
                data: content,
                file
            }).then(() => {
                this.resetContextBridgedContent()
            })
        })

        this.ipc.on('to:request:saveas', (event, data) => {
            storage.save(context, {
                id: event.sender.id,
                data,
            }).then(() => {
                this.resetContextBridgedContent()
            })
        })
    }

    contextBridgedContentHasChanged() {
        return this.contextBridgedContent.current !== this.contextBridgedContent.original
    }

    updateContextBridgedContent(orginal, current) {
        this.contextBridgedContent.original = orginal
        this.contextBridgedContent.current = current
    }

    resetContextBridgedContent() {
        this.contextBridgedContent.original = null
        this.contextBridgedContent.current = null
    }
}