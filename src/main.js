const path = require('path')
const storage = require('./lib/storage')
const { app, dialog, ipcMain, nativeTheme, BrowserWindow, Menu } = require('electron')
const IpcHandler = require('./lib/ipc')
const MenuHandler = require('./lib/menu')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-rasterization')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('--no-sandbox')
app.disableHardwareAcceleration()

let context

function createWindow() {
    context = new BrowserWindow({
        show: false,
        icon: path.join(__dirname, 'app/assets/logo.ico'),
        webPreferences: {
            nodeIntegration: false, 
            contextIsolation: true,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    context.webContents.on('will-navigate', event => event.preventDefault())
    context.loadFile(path.join(__dirname, '../dist/index.html'))

    const menuHandler = new MenuHandler(app, Menu)
    menuHandler.register(context)

    const ipcHandler = new IpcHandler(ipcMain, storage)
    ipcHandler.register(context)

    context.on('close', function(event) {
        const choice = dialog.showMessageBoxSync(this, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        })

        if (choice) {
            event.preventDefault()
        }
    })

    context.on('closed', () => {
        context = null
    })

    context.webContents.on('did-finish-load', () => {
        context.webContents.send('from:theme:set', nativeTheme.shouldUseDarkColors)
    })

    context.maximize()
    context.show()
}

app.on('ready', createWindow)

app.on('activate', () => {
    if (!context) {
        createWindow()
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})