import notify from '../utilities/notify'
import { editor } from 'monaco-editor/esm/vs/editor/editor.api'
import SettingsHandler from './settings-handler'

export default class IpcHandler
{
    constructor(mkeditor, instance, context) {
        this.mkeditor = mkeditor
        this.instance = instance
        this.context = context
        this.activeFile = null
        this.loadedSettings = null
    }
    
    /**
     * Register IPC event handlers for transmitting data between the browser window
     * execution context and the node runtime.
     */
    register() {
        // Enable saving from within the browser window execution context
        const saveBtn = document.querySelector('#saveFile')
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                if (this.activeFile) {
                    this.context.send('to:request:save', {
                        content: this.instance.getValue(),
                        file: this.activeFile
                    })
                } else {
                    this.context.send('to:request:saveas', this.instance.getValue())
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
                
                editor.setTheme('vs-dark')
                document.body.setAttribute('data-theme', 'dark')
            }
        });

        // Set settings from stored settings file (%HOME%/.mkeditor/settings.json)
        this.context.receive('from:settings:set', (settings) => {
            this.mkeditor.applySettingsFromIpcStorage(settings);
            
            const handler = new SettingsHandler(this.instance, true, settings);
            handler.register();
        });
        
        // Enable new files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:new', (channel) => {
            this.context.send(channel, {
                content: this.instance.getValue(),
                file: this.activeFile
            })
        })
        
        // Enable saving files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:save', (channel) => {
            this.context.send(channel, {
                content: this.instance.getValue(),
                file: this.activeFile
            })
        })
        
        this.context.receive('from:request:saveas', (channel) => {
            this.context.send(channel, this.instance.getValue())
        })
        
        // Enable opening files from outside of the browser window execution context.
        // Provides access to browser window data and emits it to the ipc channel.
        this.context.receive('from:request:open', ({ content, filename, file }) => {
            this.instance.focus()
            this.instance.setValue(content)
            this.activeFile = file

            // Dispatch contents so the editor can track it.
            // This handler and the editor both reside within the same execution context.
            window.dispatchEvent(new CustomEvent('editor:state', {
                detail: this.instance.getValue()
            }))

            this.trackEditorStateBetweenExecutionContext(content, content)
            
            document.querySelector('#active-file').innerText = filename

            this.context.send('to:set:title', filename)
        })
        
        // Enable access to the monaco editor command palette from outside the browser
        // window execution context.
        this.context.receive('from:command:palette', (command) => {
            this.instance.focus()
            this.instance.trigger(command, 'editor.action.quickCommand')
        })
        
        // Enable ipc notifications.
        this.context.receive('from:notification:display', (event) => {
            notify.send(event.status, event.message)
        })
    }

    trackEditorStateBetweenExecutionContext(original, current) {
        this.context.send('to:editor:state', { original, current })
    }
}