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

// Create a new event dispatcher.
const dispatcher = new EditorDispatcher();

// Create a new Editor instance.
const mkeditor = new Editor(editor, preview, dispatcher);
const instance = mkeditor.init({ watch: true });

// Implement draggable splitter.
Split(['#editor-split', '#preview-split'], {
    onDrag () {
        instance.layout();
    }
});

// Event listener to resize the layout when the viewport is loaded.
window.onload = () => instance.layout();

// Register new command handler for the monaco editor instance to provide
// and handle editor commands and actions (e.g. bold, alertblock etc.)
mkeditor.registerCommandHandler(
    new CommandHandler(instance, true)
);

// Register new settings handler for the monaco editor instance to provide
// local settings with persistence.
mkeditor.registerSettingsHandler(
    new SettingsHandler(instance, {
        persistSettings: true
    }, true)
);

// If running within electron app, register IPC handler for communication
// between execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')) {
    const context = window.executionBridge;
    mkeditor.registerIpcHandler(
        new IpcHandler(mkeditor, instance, context, dispatcher, true)
    );
}
