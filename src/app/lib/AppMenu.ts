import { app, BrowserWindow, Menu } from 'electron';
import { AppStorage } from './AppStorage';

export class AppMenu {
  
  private context: BrowserWindow;
  
  constructor (context: BrowserWindow, register = false) {
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
              AppStorage.open(this.context);
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
              this.context.webContents.send('from:modal:open', 'settings'); // channel / provider
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
            label: 'Open Command Palette',
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
              return process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I';
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
            label: 'About MKEditor',
            click: () => {
              this.context.webContents.send('from:modal:open', 'about'); // channel / provider
            }
          },
          {
            label: 'Editor Shortcuts',
            click: () => {
              this.context.webContents.send('from:modal:open', 'shortcuts'); // channel / provider
            }
          }
        ]
      }
    ]);
  }

  buildTrayContextMenu (context: BrowserWindow) {
    return Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => {
          app.focus();
          context.maximize();
        }
      },
      {
        label: 'Open Recent',
        role: 'recentDocuments',
        submenu: [
          {
            label: 'Clear Recent',
            role: 'clearRecentDocuments'
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit()
      },
    ]);
  }

  setAppContext(context: BrowserWindow) {
    this.context = context;
  }
}
