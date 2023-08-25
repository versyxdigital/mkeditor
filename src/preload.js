/**
* Preload script to access node.js from the main renderer process.
*
* This script runs before the renderer process is loaded, and has
* access to both renderer global context (e.g. window and document)
* and a node.js environment context.
*
* The contextBridge module provides a safe, bi-directional, synchronous
* bridge across isolated contexts.
*/
const { contextBridge, ipcRenderer } = require('electron');

const senderWhitelist = [
    'to:title:set',
    'to:editor:state',
    'to:settings:save',
    'to:html:export',
    'to:file:new',
    'to:file:save',
    'to:file:saveas'
];

const receiverWhitelist = [
    'from:theme:set',
    'from:settings:set',
    'from:file:new',
    'from:file:open',
    'from:file:save',
    'from:file:saveas',
    'from:command:palette',
    'from:notification:display'
];

/**
* contextBridgeChannel utilises the ipcRenderer module to provide methods for
* sending synchronous and asynchronous messages accross different execution contexts
* (i.e. from the render process (web page) to the main process.).
*/
const contextBridgeChannel = () => {
    return {
        send: (channel, data) => {
            if (senderWhitelist.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        receive: (channel, func) => {
            if (receiverWhitelist.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => {
                    func(...args);
                });
            }
        }
    };
};

/**
* The "Main World" is the JavaScript context that the main renderer code runs in.
*
* When contextIsolation is enabled in webPreferences, the preload scripts run in an
* "Isolated World" that is exposed to the "Main World" through the contextBridge.
*
* Docs: https://electronjs.org/docs/api/context-bridge
*/
contextBridge.exposeInMainWorld('executionBridge', contextBridgeChannel());
