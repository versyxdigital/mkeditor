require('file-loader?name=[name].[ext]!./index.html');

import './bootstrap'
import Split from 'split.js'
import Editor from './editor'
import CommandHandler from './handlers/command-handler'
import SettingsHandler from './handlers/settings-handler'
import IpcHandler from './handlers/ipc-handler'

const editor = document.getElementById('editor')
const preview = document.getElementById('preview')

// Create a new Editor instance.
const mkeditor = new Editor(editor, preview)
const app = mkeditor.init({ watch: true })

// Ensure windows are split 50,50
Split(['#editor', '#preview'], { sizes: [50, 50] })

// Register new command handler for the monaco editor instance to provide
// and handle editor commands and actions (e.g. bold, alertblock etc.)
const commandHandler = new CommandHandler(app)
commandHandler.register()
mkeditor.registerCommandHandler(commandHandler)

// Register new settings handler for the monaco editor instance to provide
// local settings with persistence.
const settingsHandler = new SettingsHandler(app, true)
settingsHandler.register()
mkeditor.registerSettingsHandler(settingsHandler)

// If running within electron app, register IPC handler for communication
// between execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'api')) {
    const ipcHandler = new IpcHandler(mkeditor, app, window.api)
    ipcHandler.register()
    mkeditor.registerIpcHandler(ipcHandler)
}