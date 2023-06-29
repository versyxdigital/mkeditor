const storage = require('./storage')

module.exports = class IpcHandler
{
    constructor(ipc) {
        this.ipc = ipc
    }

    register(context) {
        this.ipc.on('to:request:new', (event, { content, file }) => {
            storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            })
        })

        this.ipc.on('to:request:save', (event, { content, file }) => {
            console.log(content, file)
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