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

```
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
/**
 * The contextBridge module provides a safe, bi-directional, synchronous
 * bridge across isolated contexts.
 */
const { contextBridge } = require('electron')

/**
 * contextBridgeChannel utilises the ipcRenderer module to provide methods for
 * sending synchronous and asynchronous messages accross different execution contexts
 */
const { contextBridgeChannel } = require('./lib/context-bridge')


contextBridge.exposeInMainWorld('api', contextBridgeChannel())
```

### Context Isolation and ICP

The preloader facilitates [context-isolated](https://www.electronjs.org/docs/latest/tutorial/context-isolation) [communication](https://www.electronjs.org/docs/latest/tutorial/ipc) between the renderer and the main process via [IPC channels](https://www.electronjs.org/docs/latest/tutorial/ipc#ipc-channels).

The IPC handler is instantiated from the entry point - `src/main.js`:

```javascript
const ipcHandler = new IpcHandler(ipcMain)
ipcHandler.register(context)
```

The IPC handler  - `lib/ipc-handler.js` - registers event listeners to listen to events fired from the renderer process.

For example, here is an event listener within the mkeditor application that is attached to the "save" HTML button.

```javascript
saveBtn.addEventListener('click', () => {
    if (this.activeFile) {
        this.context.send('to:request:save', {
            content: this.app.getValue(),
            file: this.activeFile
        })
    } else {
        this.context.send('to:request:saveas', this.app.getValue())
    }
})
```

`this.context` is the IPC renderer process which is exposed to the browser window as `window.api` through the preloader.

When the save button is clicked, a check is performed to see if the user is editing an existing file, if so, the IPC renderer triggers a `to:request:save` event, otherwise it triggers a `to:request:saveas` event.

The IPC handler contains listeners for these events:

```javascript
this.ipc.on('to:request:save', (event, { content, file }) => {
    storage.save(context, {
        id: event.sender.id,
        data: content,
        file
    })
})

this.ipc.on('to:request:saveas', (event, data) => {
    storage.save(context, {
        id: event.sender.id,
        data,
    })
})
```

`this.ipc` is the IPC main process which communicates asynchronously to renderer processes.

As you can see, both events triggered from the renderer process are handled by the main process. In this instance, the IPC handler facilitates the passage of data from the renderer - id, editor content and in the case of exsting files, destination file - to our node storage access logic.

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
