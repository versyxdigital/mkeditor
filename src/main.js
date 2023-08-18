const path = require('path');
const { app, ipcMain, BrowserWindow, Menu } = require('electron');
const ContextMenu = require('./lib/context-menu');
const DialogHandler = require('./lib/dialog-handler');
const IpcHandler = require('./lib/ipc-handler');
const SettingsHandler = require('./lib/settings-handler');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.disableHardwareAcceleration();

let context;

function createWindow () {
    context = new BrowserWindow({
        show: false,
        icon: path.join(__dirname, 'app/assets/logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    context.webContents.on('will-navigate', event => event.preventDefault());
    context.loadFile(path.join(__dirname, '../dist/index.html'));

    const settingsHandler = new SettingsHandler(context);

    const ipcHandler = new IpcHandler(ipcMain, settingsHandler);
    ipcHandler.register(context);

    const contextMenu = new ContextMenu(app, Menu);
    contextMenu.register(context);

    const dialogHandler = new DialogHandler(context);

    context.webContents.on('did-finish-load', () => {
        context.webContents.send('from:settings:set', settingsHandler.loadSettingsFile());
    });

    context.on('close', (event) => {
        if (ipcHandler.contextBridgedContentHasChanged()) {
            dialogHandler.promptUserForUnsavedChanges(event);
        }
    });

    context.on('closed', () => {
        context = null;
    });

    context.maximize();
    context.show();
}

app.on('ready', createWindow);

app.on('activate', () => {
    if (!context) {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    app.quit();
});
