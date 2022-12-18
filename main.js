const path = require('path')
const storage = require('./app/lib/node/storage')

const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const openAboutWindow = require('about-window').default

let win

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-gpu-rasterization')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('--no-sandbox')
app.disableHardwareAcceleration()

function configureApplicationMenu() {
    app.applicationMenu = Menu.buildFromTemplate([
        {
            label: '',
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'New File...',
                    click: () => {
                        win.webContents.send('from:request:new', 'to:request:new')
                    },
                    accelerator: 'Ctrl+N' 
                },
                {
                    label: 'Open File...',
                    click: () => {
                        storage.open(win).then(response => {
                            win.webContents.send('from:request:open', response)
                        })
                    },
                    accelerator: 'Ctrl+O' 
                },
                {
                    label: 'Save',
                    click: () => {
                        win.webContents.send('from:request:save', 'to:request:save')
                    },
                    accelerator: 'Ctrl+S'
                },
                {
                    label: 'Save As...',
                    click: () => {
                        win.webContents.send('from:request:saveas', 'to:request:saveas')
                    },
                    accelerator: 'Ctrl+Shift+S'
                },
                { type: 'separator' },
                { role: 'quit' },
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Command Palette...',
                    click: () => {
                        win.webContents.send('from:command:palette', 'open')
                    },
                    accelerator: 'F1'
                },
                { role: 'togglefullscreen' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: (function () {
                        return process.platfom === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I'
                    }()),
                    click: () => {
                        win.webContents.toggleDevTools()
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About...',
                    click: () => {
                        openAboutWindow({
                            icon_path: path.join(__dirname, 'app/assets/logo.ico'),
                            product_name: 'MKEditor',
                            copyright: '© 2021-' + new Date().getFullYear() + ' Chris Rowles. All rights reserved.',
                            package_json_dir: __dirname,
                            use_version_info: false
                        })
                    }
                }
            ]
        }
    ])
}

function createWindow() {
    win = new BrowserWindow({
        show: false,
        icon: path.join(__dirname, 'app/assets/logo.ico'),
        webPreferences: {
            nodeIntegration: false, 
            contextIsolation: true,
            enableRemoteModule: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.webContents.on('will-navigate', event => event.preventDefault())
    win.loadFile(path.join(__dirname, 'dist/index.html'))

    configureApplicationMenu()

    win.on('close', function(event) {
        const choice = require('electron').dialog.showMessageBoxSync(this, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?'
        })

        if (choice == 1) {
            event.preventDefault()
        }
    })

    win.on('closed', () => {
        win = null
    })

    win.maximize()
    win.show()
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (win === null) {
        createWindow()
    }
})

ipcMain.on('to:request:save', (event, data = { content, filepath }) => {
    const content = data.content
    const filepath = data.filepath

    storage.save(win, {
        id: event.sender.id,
        data: content,
        existingFilepath: filepath
    })
})

ipcMain.on('to:request:saveas', (event, data) => {
    storage.save(win, {
        id: event.sender.id,
        data,
    })
})

ipcMain.on('to:request:new', (event, data) => {
    console.log(event, data)
})