import './icons';
import Split from 'split.js';
import Editor from './editor';
import EditorDispatcher from './events/editor-dispatcher';
import CommandHandler from './handlers/command-handler';
import SettingsHandler from './handlers/settings-handler';
import IPCHandler from './handlers/ipc-handler';

require('file-loader?name=[name].[ext]!./index.html'); // eslint-disable-line

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');

// Create new custom event dispatcher.
const dispatcher = new EditorDispatcher();

// Create new editor.
const mkeditor = new Editor(editor, preview, dispatcher);
const model = mkeditor.create({ watch: true });

// Register new command handler for the editor to provide and handle
// editor commands and actions (e.g. bold, alertblock etc.)
mkeditor.attach('command', new CommandHandler(model, true));

// Register new settings handler for the editor model to provide local
// settings with persistence (with support for localStorage/filesystem).
mkeditor.attach('settings', new SettingsHandler(model, {
    persistSettings: true
}, true));

// If running within electron app, register IPC handler for communication
// between main and renderer execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')) {
    // The bi-directional synchronous bridge to the main execution context.
    // Exposed on the window object through the preloader.
    const bridge = window.executionBridge;

    // Create a new IPC handler for the web execution context.
    const ipc = new IPCHandler(model, bridge, dispatcher, true);

    // Attach settings handler to IPC handler.
    ipc.attach('settings', mkeditor.handlers.settings);
    ipc.attach('command', mkeditor.handlers.command);

    // Attach IPC handler to mkeditor.
    mkeditor.attach('ipc', ipc);
}

// Implement draggable splitter.
Split(['#editor-split', '#preview-split'], {
    onDrag () { model.layout(); }
});
