/**
* Preload script.
*
* The contextBridge module provides a safe, bi-directional, synchronous
* bridge across isolated contexts.
*/
import { contextBridge, ipcRenderer } from 'electron';

const senderWhitelist = [
  'to:title:set',
  'to:editor:state',
  'to:settings:save',
  'to:html:export',
  'to:file:new',
  'to:file:open',
  'to:file:save',
  'to:file:saveas'
];

const receiverWhitelist = [
  'from:theme:set',
  'from:settings:set',
  'from:file:new',
  'from:file:open',
  'from:file:opened',
  'from:file:save',
  'from:file:saveas',
  'from:modal:open',
  'from:command:palette',
  'from:notification:display'
];

/**
* contextBridgeChannel utilises the ipcRenderer module to provide methods for
* sending synchronous and asynchronous messages accross different execution contexts
* (i.e. from the renderer process to the main process.).
*/
const contextBridgeChannel = () => {
  return {
    send: (channel: string, data: any) => {
      if (senderWhitelist.includes(channel)) {
        // Send an async message to te main process via whitelisted channel,
        // along with data.
        //
        // Note, arguments will be serialized with the Structured Clone Algorithm,
        // so prototype chains will not be included. Sending functions, promises,
        // symbols, weakmaps, weaksets or DOM objects will throw an exception.
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel: string, fn: Function) => {
      if (receiverWhitelist.includes(channel)) {
        // Listen to channels and execute callack when messages are received.
        ipcRenderer.on(channel, (event, ...args) => {
          fn(...args);
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
