import './icons';
import Split from 'split.js';
import Editor from './editor';
import EditorDispatcher from './events/editor-dispatcher';
import CommandHandler from './handlers/command-handler';
import SettingsHandler from './handlers/settings-handler';
import IpcHandler from './handlers/ipc-handler';

require('file-loader?name=[name].[ext]!./index.html'); // eslint-disable-line

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');

// Create new custom event dispatcher.
const dispatcher = new EditorDispatcher();

// Create new editor instance.
const mkeditor = new Editor(editor, preview, dispatcher);
const instance = mkeditor.create({ watch: true });

// Register new command handler for the editor instance to provide
// and handle editor commands and actions (e.g. bold, alertblock etc.)
mkeditor.attach('command', new CommandHandler(instance, true));

// Register new settings handler for the editor instance to provide local
// settings with persistence (with support for localStorage/filesystem).
mkeditor.attach('settings', new SettingsHandler(instance, {
    persistSettings: true
}, true));

// If running within electron app, register IPC handler for communication
// between node and browser execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')) {
    const context = window.executionBridge;
    const ipcHandler = new IpcHandler(mkeditor, instance, context, dispatcher, true);

    ipcHandler.attach('settings', mkeditor.handlers.settings);
    mkeditor.attach('ipc', ipcHandler);
}

// Implement draggable splitter.
Split(['#editor-split', '#preview-split'], {
    onDrag () { instance.layout(); }
});
