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
│   ├── app                 # Mkeditor application (renderer)
│   ├── lib                 # Native UI and storage (main)
│   ├── main.js             # Entry point
│   └── preload.js          # Preloader
├── package.json            # NPM dependencies
├── package-lock.json       # NPM dependencies
├── webpack.config.js       # Webpack build config
├── LICENSE                 # The license
└── README.md               # This file
```

The codebase is split into multiple parts:

- `src/app`: The standalone mkeditor application, a web app.
- `src/lib`: Native UI, electron management, storage, IPC.

## MKeditor Application

The mkeditor application is bundled via [webpack](https://webpack.js.org/) and output to `dist/`, once you've built the application, you can run mkeditor directly in the browser:

```sh
npm run serve:web
```


## Electron Application

From the electron application entry point - `src/main.js` - the browser window is created:

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

The mkeditor application is then loaded:

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
        receive: (channel, fn) => {
            if (receiverWhitelist.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => {
                    fn(...args);
                });
            }
        }
    };
};

contextBridge.exposeInMainWorld('executionBridge', contextBridgeChannel());
```

### Context Isolation and ICP

The preloader facilitates [context-isolated](https://www.electronjs.org/docs/latest/tutorial/context-isolation) [communication](https://www.electronjs.org/docs/latest/tutorial/ipc) between the renderer and the main process via [IPC channels](https://www.electronjs.org/docs/latest/tutorial/ipc#ipc-channels).

The IPC handler for the main context, located at `src/lib/ipc.js`, is instantiated from the main process entry point - `src/main.js`:

```javascript
const ipc = new IPC(context, { settings, dialog });
ipc.register();
```

The IPC handler for the renderer context, located at `src/app/handlers/ipc-handler.js`, is instantiated from the web entry point - `src/app/index.js`:

```javascript
// If running within electron app, register IPC handler for communication
// between main and renderer execution contexts.
if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')) {
    // The bi-directional synchronous bridge to the main execution context.
    // Exposed on the window object through the preloader.
    const bridge = window.executionBridge;

    // Create a new IPC handler for the renderer execution context.
    const ipc = new IPCHandler(instance, bridge, dispatcher, true);

    // Attach settings handler to IPC handler.
    ipc.attach('settings', mkeditor.handlers.settings);

    // Attach IPC handler to mkeditor.
    mkeditor.attach('ipc', ipc);
}
```

#### In Practice

IPC is needed due to different requirements in different parts of the application. For example, consider saving a file, multiple things need to happen:

- The save action needs to be performed
- The editor content needs to be retrieved
- The filesystem needs to be accessed
- Checks need to be performed such as whether or not an existing file is beind edited

Let's focus on the first point. The save action can be performed from two locations when using MKEditor:

1. The application menu:
2. The editor toolbar:

The first option is triggered from the main context, while the second option is triggered from the renderer context.

The main context is where we have access to node APIs such as the fs API for working with filesystems, native UI elements etc.

The renderer context is where the editor UI (HTML/CSS) is executed, here we can perform actions and do things such as retrieve the editor content, retrieve DOM elements, values etc.

##### The Renderer Context

The save action using the editor toolbar is fairly simple; because it is performed within the renderer context, we already have access to the editor. 

Here is the listener, located at `src/app/editor.js`:

```javascript
const saveMarkdownButton = document.querySelector('#save-editor-markdown');
if (saveMarkdownButton) {
    saveMarkdownButton.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.handlers.ipc) {
            this.handlers.ipc.saveContentToFile();
        }
    });
}
```

When the editor toolbar button is clicked, the listener uses the renderer context's IPC handler to save the content to file.

Here is the method, located at `src/app/handlers/ipc-handler.js`:

```javascript
saveContentToFile () {
    if (this.activeFile) {
        this.bridge.send('to:file:save', {
            content: this.instance.getValue(),
            file: this.activeFile
        });
    } else {
        this.bridge.send('to:file:saveas', this.instance.getValue());
    }
}
```
This method does the following:

- Checks to see if an active file is being edited
- If so, uses the context bridge to send the content and the active file details to the main process on the `to:file:save` channel.
- Otherwise, uses the context bridge to send the content to the main process on the `to:file:saveas` channel.

Here are the listeners defined in the main context's IPC handler, located at `src/lib/ipc.js`:

```javascript
ipcMain.on('to:file:save', (event, { content, file }) => {
    storage.save(this.context, {
        id: event.sender.id,
        data: content,
        file
    }).then(() => {
        this.resetContextBridgedContent();
    });
});

ipcMain.on('to:file:saveas', (event, data) => {
    storage.save(this.context, {
        id: event.sender.id,
        data
    }).then(() => {
        this.resetContextBridgedContent();
    });
});
```

These listeners receive the data on their respective channels, and then use the storage handler to perform the necesary actions.

##### The Main Context

Saving from the application menu is a slightly more complex process. Because the action is peformed from outside the renderer context, we do not immediately have access to the editor content, we therefore need to make a "trip" into the renderer context to retrieve the data to save.

Here are the event listeners for the application menu options, located at `src/lib/menu.js`:

```javascript
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
```

The listeners are simple, when the Save or Save As button is clicked, an event is sent to the renderer context on the `from:file:save` or `from:file:saveas` channel, along with a payload which is a string containing another channel.

This payload, i.e. this other channel, will be used to _forward_ the event received from the main context back to the main context.

Here are the renderer context listeners for the application menu IPC events, located at `src/app/handlers/ipc-handler.js`:

```javascript
this.bridge.receive('from:file:save', (channel) => {
    this.bridge.send(channel, {
        content: this.instance.getValue(),
        file: this.activeFile
    });
});

this.bridge.receive('from:file:saveas', (channel) => {
    this.bridge.send(channel, this.instance.getValue());
});
```

In summary, in the case of saving using the application menu, i.e. saving from the main context, the following happens:

1. An event is sent from the main context to the renderer context on the `from:file:save` or `from:file:saveas` channel, the payload is another channel, `to:file:save` or `to:file:saveas`.
2. The event is received by the listener defined in the renderer context's IPC handler.
3. The listener, which has access to the editor in the same context, retrieves the content to save and sends an event back to the main context using the payload channel it received in the step above, `to:file:save` or `to:file:saveas`.

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
