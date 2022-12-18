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
const { contextBridge } = require('electron')

/**
 * contextBridgeChannel utilises the ipcRenderer module to provide methods for
 * sending synchronous and asynchronous messages accross different execution contexts
 * (i.e. from the render process (web page) to the main process.).
 */
const { contextBridgeChannel } = require('./lib/channel')

/**
 * The "Main World" is the JavaScript context that the main renderer code runs in.
 * 
 * When contextIsolation is enabled in webPreferences, the preload scripts run in an
 * "Isolated World" that is exposed to the "Main World" through the contextBridge.
 */
contextBridge.exposeInMainWorld('api', contextBridgeChannel())