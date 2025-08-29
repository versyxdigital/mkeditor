/**
 * Preload script.
 *
 * Main Bridge: AppBridge
 * Renderer Bridge: Bridge
 *
 * The contextBridge module provides a safe, bi-directional, synchronous
 * bridge across the isolated contexts.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { LogLevel } from './interfaces/Logging';

// Can be sent from the renderer process and
// received by the main process
const senderWhitelist = [
  'to:title:set',
  'to:editor:state',
  'to:settings:save',
  'to:html:export',
  'to:pdf:export',
  'to:file:new',
  'to:file:open',
  'to:folder:open',
  'to:file:save',
  'to:file:saveas',
  'to:file:openpath',
  'to:file:create',
  'to:folder:create',
  'to:file:rename',
  'to:file:delete',
  'to:file:properties',
];

// Can be sent from the main process and received
// by the renderer process
const receiverWhitelist = [
  'from:theme:set',
  'from:settings:set',
  'from:file:new',
  'from:file:open',
  'from:folder:open',
  'from:folder:opened',
  'from:file:opened',
  'from:file:save',
  'from:file:saveas',
  'from:modal:open',
  'from:command:palette',
  'from:notification:display',
  'from:path:properties',
  'from:path:renamed',
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
        // Note, arguments will be serialized with the structured clone algorithm,
        // so prototype chains will not be included. Sending functions, promises,
        // symbols, weakmaps, weaksets or DOM objects will throw an exception.
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel: string, fn: (...args: any[]) => void) => {
      if (receiverWhitelist.includes(channel)) {
        // Listen to channels and execute callack when messages are received.
        ipcRenderer.on(channel, (event, ...args) => {
          fn(...args);
        });
      }
    },
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

contextBridge.exposeInMainWorld('mked', {
  getActiveFilePath: () => ipcRenderer.sendSync('mked:get-active-file'),
  openMkedUrl: (url: string) => ipcRenderer.send('mked:open-url', url),
  pathDirname: (p: string) => ipcRenderer.invoke('mked:path:dirname', p),
  resolvePath: (base: string, rel: string) => {
    ipcRenderer.invoke('mked:path:resolve', base, rel);
  },
});

contextBridge.exposeInMainWorld('logger', {
  log(level: LogLevel, msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level, msg, meta });
  },
  debug(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'debug', msg, meta });
  },
  info(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'info', msg, meta });
  },
  warn(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'warn', msg, meta });
  },
  error(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'error', msg, meta });
  },
});
