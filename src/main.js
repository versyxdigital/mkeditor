const { app, BrowserWindow, nativeTheme: { shouldUseDarkColors }, shell } = require('electron');
const path = require('path');
const Menu = require('./lib/menu');
const Dialog = require('./lib/dialog');
const IPC = require('./lib/ipc');
const Settings = require('./lib/settings');

let context;

function main () {
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

    const dialog = new Dialog(context);
    const settings = new Settings(context);

    const ipc = new IPC(context, { settings, dialog });
    ipc.register();

    const menu = new Menu(context);
    menu.register();

    context.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return {
            action: 'deny'
        };
    });

    context.webContents.on('did-finish-load', () => {
        context.webContents.send('from:theme:set', shouldUseDarkColors);
        context.webContents.send('from:settings:set', settings.loadSettingsFile());
    });

    context.on('close', (event) => {
        ipc.promptForChangedContextBridgeContent(event);
    });

    context.on('closed', () => {
        context = null;
    });

    context.maximize();
    context.show();
}

app.on('ready', main);

app.on('activate', () => {
    if (!context) {
        main();
    }
});

app.on('window-all-closed', () => {
    app.quit();
});
