import notify from '../utilities/notify'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

export default class IpcHandler
{
    constructor(app, context) {
        this.app = app
        this.context = context
        this.activeFile = null
    }
    
    /**
     * Register IPC (Inter-process communication) event handlers for transmitting
     * data between the browser window execution context and the node runtime.
     */
    register() {
        // Enable saving from within the browser window execution context
        // (i.e. the DOM). Provides access to broser window data and emits
        // it to the ipc channel.
        const saveBtn = document.querySelector('#saveFile')
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (this.activeFile) {
                    this.context.send('to:request:save', {
                        content: this.app.getValue(),
                        filepath: this.activeFile
                    })
                } else {
                    this.context.send('to:request:saveas', this.app.getValue())
                }
            })
        }
        
        // Set the theme according to the user's system theme
        this.context.receive('from:theme:set', (shouldUseDarkMode) => {
            if (shouldUseDarkMode) {
                const icon = document.querySelector('#darkModeIcon')
                icon.classList.remove('text-dark')
                icon.classList.add('text-warning')
                
                const toggle = document.querySelector('#toggleDarkMode')
                toggle.checked = true
                
                monaco.editor.setTheme('vs-dark')
                document.body.setAttribute('data-theme', 'dark')
            }
        })
        
        // Enable new files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:new', (context) => {
            this.context.send(context, {
                content: this.app.getValue(),
                filepath: this.activeFile
            })
        })
        
        // Enable saving files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:save', (context) => {
            this.context.send(context, {
                content: this.app.getValue(),
                filepath: this.activeFile
            })
        })
        
        this.context.receive('from:request:saveas', (context) => {
            this.context.send(context, this.app.getValue())
        })
        
        // Enable opening files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:open', (response) => {
            this.app.focus()
            this.app.setValue(response.content)
            this.activeFile = response.filepath
            document.querySelector('#active-file').innerText = response.filename
        })
        
        // Enable access to the monaco editor command palette from outside the browser
        // window execution context.
        this.context.receive('from:command:palette', (command) => {
            this.app.focus()
            this.app.trigger(command, 'editor.action.quickCommand')
        })
        
        // Enable ipc notifications.
        this.context.receive('from:notification:display', (event) => {
            notify.send(event.status, event.message)
        })
    }
}