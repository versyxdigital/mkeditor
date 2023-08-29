const path = require('path');
const { app, Menu } = require('electron');
const openAboutWindow = require('about-window').default;
const storage = require('./storage');

module.exports = class AppMenu {
    constructor (context, register = false) {
        this.context = context;

        if (register) {
            this.register();
        }
    }

    register () {
        app.applicationMenu = Menu.buildFromTemplate([
            {
                label: 'File',
                submenu: [
                    {
                        label: 'New File...',
                        click: () => {
                            this.context.webContents.send('from:file:new', 'to:file:new');
                        },
                        accelerator: 'Ctrl+N'
                    },
                    {
                        label: 'Open File...',
                        click: () => {
                            storage.open(this.context).then(response => {
                                this.context.webContents.send('from:file:open', response);
                            });
                        },
                        accelerator: 'Ctrl+O'
                    },
                    {
                        label: 'Save',
                        click: () => {
                            this.context.webContents.send('from:file:save', 'to:file:save');
                        },
                        accelerator: 'Ctrl+S'
                    },
                    {
                        label: 'Save As...',
                        click: () => {
                            this.context.webContents.send('from:file:saveas', 'to:file:saveas');
                        },
                        accelerator: 'Ctrl+Shift+S'
                    },
                    { type: 'separator' },
                    {
                        label: 'Settings...',
                        click: () => {
                            this.context.webContents.send('from:modal:open', 'settings');
                        }
                    },
                    { type: 'separator' },
                    { role: 'quit' }
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
                    { role: 'paste' }
                ]
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Command Palette...',
                        click: () => {
                            this.context.webContents.send('from:command:palette', 'open');
                        },
                        accelerator: 'F1'
                    },
                    { type: 'separator' },
                    { role: 'togglefullscreen' },
                    {
                        label: 'Toggle Developer Tools',
                        accelerator: (function () {
                            return process.platfom === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I';
                        }()),
                        click: () => {
                            this.context.webContents.toggleDevTools();
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
                                use_version_info: true,
                                bug_report_url: 'https://github.com/mkeditorOSS/mkeditor/issues'
                            });
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Shortcuts...',
                        click: () => {
                            this.context.webContents.send('from:modal:open', 'shortcuts');
                        }
                    }
                ]
            }
        ]);
    }
};
