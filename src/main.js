const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, nativeTheme } = require('electron');
const AppMenu = require('./lib/app-menu');
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

    const dialogHandler = new DialogHandler(context);
    const settingsHandler = new SettingsHandler(context);

    const ipcHandler = new IpcHandler(ipcMain, {
        settings: settingsHandler,
        dialog: dialogHandler
    });
    ipcHandler.register(context);

    const appMenu = new AppMenu(app, Menu);
    appMenu.register(context);

    context.webContents.on('did-finish-load', () => {
        context.webContents.send('from:theme:set', nativeTheme.shouldUseDarkColors);
        context.webContents.send('from:settings:set', settingsHandler.loadSettingsFile());
    });

    context.on('close', (event) => {
        ipcHandler.promptForChangedContextBridgeContent(event);
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
