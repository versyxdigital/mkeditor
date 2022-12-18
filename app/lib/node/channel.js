const { ipcRenderer } = require('electron')

const senderWhitelist = [
    'to:request:new',
    'to:request:open',
    'to:request:save',
    'to:request:saveas',
    'to:command:palette',
    'to:notification:display'
]

const receiverWhitelist = [
    'from:request:new',
    'from:request:open',
    'from:request:save',
    'from:request:saveas',
    'from:command:palette',
    'from:notification:display'
]

module.exports = {
    senderWhitelist,
    receiverWhitelist,
    contextBridgeChannel() {
        return {
            send: (channel, data) => {
                if (senderWhitelist.includes(channel)) {
                    ipcRenderer.send(channel, data)
                }
            },
            receive: (channel, func) => {
                if (receiverWhitelist.includes(channel)) {
                    ipcRenderer.on(channel, (event, ...args) => {
                        func(...args)
                    })
                }
            }
        }
    }
}