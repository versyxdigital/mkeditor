const storage = require('./storage')

module.exports = class IpcHandler
{
    constructor(ipc) {
        this.ipc = ipc
    }

    register(context) {
        this.ipc.on('to:request:new', (event, data) => {
            const content = data.content
            const file = data.filepath

            storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            })
        })

        this.ipc.on('to:request:save', (event, data = { content, filepath }) => {
            const content = data.content
            const filepath = data.filepath

            storage.save(context, {
                id: event.sender.id,
                data: content,
                existingFilepath: filepath
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