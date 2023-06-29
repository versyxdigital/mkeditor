const path = require('path')
const storage = require('./storage')
const openAboutWindow = require('about-window').default

module.exports = class MenuHandler
{
    constructor(app, menu) {
        this.app = app
        this.menu = menu
    }

    register(context) {
        this.app.applicationMenu = this.menu.buildFromTemplate([
            {
                label: '',
            },
            {
                label: 'File',
                submenu: [
                    {
                        label: 'New File...',
                        click: () => {
                            context.webContents.send('from:request:new', 'to:request:new')
                        },
                        accelerator: 'Ctrl+N' 
                    },
                    {
                        label: 'Open File...',
                        click: () => {
                            storage.open(context).then(response => {
                                context.webContents.send('from:request:open', response)
                            })
                        },
                        accelerator: 'Ctrl+O' 
                    },
                    {
                        label: 'Save',
                        click: () => {
                            context.webContents.send('from:request:save', 'to:request:save')
                        },
                        accelerator: 'Ctrl+S'
                    },
                    {
                        label: 'Save As...',
                        click: () => {
                            context.webContents.send('from:request:saveas', 'to:request:saveas')
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
                            context.webContents.send('from:command:palette', 'open')
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
                            context.webContents.toggleDevTools()
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
                                icon_path: path.join(__dirname, '../app/assets/logo.ico'),
                                product_name: 'MKEditor',
                                copyright: '© 2021 - ' + new Date().getFullYear() + ' Chris Rowles. All rights reserved.',
                                package_json_dir: path.join(__dirname, '../../'),
                                use_version_info: false
                            })
                        }
                    }
                ]
            }
        ])
    }
}