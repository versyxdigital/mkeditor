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
     * Register IPC event handlers for transmitting data between the browser window
     * execution context and the node runtime.
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
                        file: this.activeFile
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
        this.context.receive('from:request:new', (channel) => {
            this.context.send(channel, {
                content: this.app.getValue(),
                file: this.activeFile
            })
        })
        
        // Enable saving files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:save', (channel) => {
            this.context.send(channel, {
                content: this.app.getValue(),
                file: this.activeFile
            })
        })
        
        this.context.receive('from:request:saveas', (channel) => {
            this.context.send(channel, this.app.getValue())
        })
        
        // Enable opening files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:open', ({ content, filename, file }) => {
            this.app.focus()
            this.app.setValue(content)
            this.activeFile = file
            
            document.querySelector('#active-file').innerText = filename
            this.context.send('to:set:title', filename)
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