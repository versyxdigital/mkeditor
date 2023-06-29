const { ipcRenderer } = require('electron')

const senderWhitelist = [
    'to:request:new',
    'to:request:save',
    'to:request:saveas',
]

const receiverWhitelist = [
    'from:theme:set',
    'from:request:new',
    'from:request:open',
    'from:request:save',
    'from:request:saveas',
    'from:command:palette',
    'from:notification:display',
    'from:set:title'
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