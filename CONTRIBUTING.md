# MKeditor

_This documentation is intended for developers who want to build from source._

MKeditor is a cross-platform markdown editor application built primarily in Javascript, using NodeJS, Electron and Microsoft's Monaco editor.

## Table of Contents

* [Requirements](#requirements)
* [Application Structure](#application-structure)
* [Getting Started](#getting-started)
* [MKeditor Application](#mkeditor-application)
* [Electron Application](#electron-application)
  * [Preloading](#preloading)
  * [Context Isolation and IPC](#context-isolation-and-icp)
* [Building](#building)

## Requirements

- Node v18+
- NPM

## Application Structure

The application structure is as follows:

```sh
.
├── build                   # Package build assets (icon, license)
├── dist                    # Bundled mkeditor package
├── docs                    # Documentation
├── node_modules            # Reserved for NPM
├── src                     # Application source
│   ├── app                 # Mkeditor application
│   ├── lib                 # IPC and storage
│   ├── main.js             # Entry point
│   └── preload.js          # Preloader
├── package.json            # NPM dependencies
├── package-lock.json       # NPM dependencies
├── webpack.config.js       # Webpack build config
├── LICENSE                 # The license
└── README.md               # This file
```

The codebase is split into multiple parts:

- `src/app`: The standalone mkeditor application
- `src/lib`: Other functionality - IPC, context bridging and storage access

## MKeditor Application

The mkeditor application is bundled via [webpack](https://webpack.js.org/) and output to `dist/`, once you've built the application, you can run mkeditor directly in the browser, either through a server or simply by opening `dist/index.html`.


## Electron Application

The electron application entry point - `src/main.js` - creates the browser window:

```javascript
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
```

The mkeditor application is then loaded into the execution context:

```javascript
context.loadFile(path.join(__dirname, '../dist/index.html'))
```

### Preloading

The `preload` option that is passed when creating a new browser window specifies the [preload script](https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts) that will be loaded before other scripts run in the page. This script will always have access to node APIs no matter whether node integration is turned on or off.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

const senderWhitelist = [
    ...
];

const receiverWhitelist = [
    ...
];

const contextBridgeChannel = () => {
    return {
        send: (channel, data) => {
            if (senderWhitelist.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        receive: (channel, func) => {
            if (receiverWhitelist.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => {
                    func(...args);
                });
            }
        }
    };
};

contextBridge.exposeInMainWorld('executionBridge', contextBridgeChannel());
```

### Context Isolation and ICP

The preloader facilitates [context-isolated](https://www.electronjs.org/docs/latest/tutorial/context-isolation) [communication](https://www.electronjs.org/docs/latest/tutorial/ipc) between the renderer and the main process via [IPC channels](https://www.electronjs.org/docs/latest/tutorial/ipc#ipc-channels).

The IPC handler for the main context, located at `src/lib/ipc-handler.js`, is instantiated from the main process entry point - `src/main.js`:

```javascript
const ipcHandler = new IpcHandler(ipcMain, {
    settings: settingsHandler,
    dialog: dialogHandler
});
ipcHandler.register(context);
```

The IPC handler for the web context, located at `src/app/handlers/ipc-handler.js`, is instantiated from the web context entry point - `src/app/index.js`:

```javascript
// If running within electron app, register IPC handler for communication
// between node and browser execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')) {
    const context = window.executionBridge;
    const ipcHandler = new IpcHandler(mkeditor, instance, context, dispatcher, true);

    ipcHandler.attach('settings', mkeditor.handlers.settings);
    mkeditor.attach('ipc', ipcHandler);
}
```

`this.context` is the main context exposed to the browser window as `window.executionBridge`, through the preloader.


#### How it works

##### Web

For example, here is an event listener within the web context that is attached to the editor UI toolbar save button.


```javascript
saveMarkdownButton.addEventListener('click', () => {
    if (this.activeFile) {
        this.context.send('to:file:save', {
            content: this.instance.getValue(),
            file: this.activeFile
        });
    } else {
        this.context.send('to:file:saveas', this.instance.getValue());
    }
});
```

When the user clicks the save button on the editor UI toolbar, it will trigger an event on the `to:file:save` channel, the listener for this channel is defined in the main context's IPC handler, as it requires access to the filesystem.

You will see how the `to:file:save` listener handles the event further below.

###### Main

Here is an event lisener within the main context that is attached to the electron app menu file > save button.
```javascript
{
    label: 'Save',
    click: () => {
        context.webContents.send('from:file:save', 'to:file:save');
    },
    accelerator: 'Ctrl+S'
},
```

In the case of saving via file > save from the app menu, the main context makes a round trip. It sends a request to the `from:file:save` channel along with a second parameter specifying the channel to forward on to from the `from:file:save` listener.

The `from:file:save` listener is defined in the web context's IPC handler. It is defined here because saving a file requires access to this context to retrieve the editor content to save, and also the current active file in the case of editing existing files.

```javascript
this.context.receive('from:file:save', (channel) => {
    this.context.send(channel, {
        content: this.instance.getValue(),
        file: this.activeFile
    });
});
```

The listener receives the request from the main context, and forwards it on to `to:file:save`, which is defined in the main context, where we have access to the filesystem.

```javascript
this.ipc.on('to:file:save', (event, { content, file }) => {
    storage.save(context, {
        id: event.sender.id,
        data: content,
        file
    }).then(() => {
        this.resetContextBridgedContent();
    });
});
```

The listener receives the editor content and the file if an existing file is being edited, and invokes the storage handler to save the file.

## Building

With the required build tools and dependencies installed (`npm install`) you can build the application and installer in a single step:

- `npm run build:installer`

This will build the mkeditor application and output an installer to `releases/${platform}/${arch}"`.

If you are running on Windows, it will output an MSI installer, if you are running Linux, it will output a debian package... I haven't added a configuration for MacOS yet.

You can also run each build step seperately:

- `npm run build:mkeditor`: Builds only the mkeditor app, contained to `dist/`
- `npm run build:executable`: Builds both mkeditor and the executable app, without an installer

You can also run the executable app without building the executable, by using the electron CLI, this is useful for development as it takes a while to build executables and installers:

- `npm run dev:execute`

You can also run the HTTP server that is included in dependencies and access mkeditor directly through your browser: 

- `npm run dev:http`
