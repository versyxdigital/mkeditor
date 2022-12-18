
module.exports = class IpcHandler
{
    constructor(ipc, storage) {
        this.ipc = ipc
        this.storage = storage
    }

    register(context) {
        this.ipc.on('to:request:new', (event, data) => {
            const content = data.content
            const file = data.filepath

            this.storage.newFile(context, {
                id: event.sender.id,
                data: content,
                file
            })
        })

        this.ipc.on('to:request:save', (event, data = { content, filepath }) => {
            const content = data.content
            const filepath = data.filepath

            this.storage.save(context, {
                id: event.sender.id,
                data: content,
                existingFilepath: filepath
            })
        })

        this.ipc.on('to:request:saveas', (event, data) => {
            this.storage.save(context, {
                id: event.sender.id,
                data,
            })
        })
    }
}