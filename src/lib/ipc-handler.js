const storage = require('./storage')

module.exports = class IpcHandler
{
    constructor(ipc) {
        this.ipc = ipc
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
            console.log(original === current)
            console.log({original, current})
        })

        this.ipc.on('to:request:new', (event, { content, file }) => {
            storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            })
        })

        this.ipc.on('to:request:save', (event, { content, file }) => {
            storage.save(context, {
                id: event.sender.id,
                data: content,
                file
            })
        })

        this.ipc.on('to:request:saveas', (event, data) => {
            storage.save(context, {
                id: event.sender.id,
                data,
            })
        })
    }
}