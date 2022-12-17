import './bootstrap'
import Split from 'split.js'
import notify from './lib/utilities/notify'
import Editor from './lib/editor'
import CommandHandler from './lib/handlers/command-handler'
import SettingsHandler from './lib/handlers/settings-handler'

const editor = document.getElementById('editor')
const preview = document.getElementById('preview')

let instance
let activeFile

if (editor && preview) {
    // Create a new Editor instance.
    const mkeditor = new Editor(editor, preview)

    // Initialise the underlying monaco editor instance and watch for changes
    // to enable live preview rendering.
    instance = mkeditor.init({ watch: true })

    if (instance) {
        // Ensure windows are split 50,50
        Split(['#editor', '#preview'], {
            sizes: [50,50]
        })

        // Register new command handler for the monaco editor instance to provide
        // and handle editor commands and actions (e.g. bold, alertblock etc.)
        const commands = new CommandHandler(instance)
        commands.register()

        // Register new settings handler for the monaco editor instance to provide
        // local settings with persistence.
        const settings = new SettingsHandler(instance, true)
        settings.register()

        // Map monaco editor commands to editor UI buttons (e.g. bold, alertblock etc.)
        const ops = document.getElementById('editor-functions').querySelectorAll('a')
        if (ops) {
            ops.forEach((op) => {
                op.addEventListener('click', (event) => {
                    const target = event.currentTarget
                    if (Object.prototype.hasOwnProperty.call(target.dataset, 'op')) {
                        target.dataset.ch && !commands[target.dataset.op]
                            ? commands.exec(target.dataset.ch)
                            : commands[target.dataset.op](target)

                        instance.focus()
                    }
                })
            })
        }

        // IPC (Inter-process communication) event handlers for transmitting
        // data between the browser window execution context and the node runtime.
        document.addEventListener('DOMContentLoaded', () => {
            if (!Object.prototype.hasOwnProperty.call(window, 'api')) {
                notify.send('error', 'An error has occurred, please restart the application.')
            } else {
                // Enable saving from within the browser window execution context
                // (i.e. the DOM). Provides access to broser window data and emits
                // it to the ipc channel.
                const saveBtn = document.querySelector('#saveFile')
                if (saveBtn) {
                    saveBtn.addEventListener('click', () => {
                        if (activeFile) {
                            window.api.send('to:request:save', {
                                content: instance.getValue(),
                                filepath: activeFile
                            })
                        } else {
                            window.api.send('to:request:saveas', instance.getValue())
                        }
                    })
                }

                // Enable saving files from outside of the browser window execution context.
                // Provides access to browser window data and emits it to the ipc channel.
                window.api.receive('from:request:save', (context) => {
                    window.api.send(context, {
                        content: instance.getValue(),
                        filepath: activeFile
                    })
                })
                window.api.receive('from:request:saveas', (context) => {
                    window.api.send(context, instance.getValue())
                })

                // Enable opening files from outside of the browser window execution context.
                // Provides access to browser window data and emits it to the ipc channel.
                window.api.receive('from:request:open', (response) => {
                    instance.focus()
                    activeFile = response.filepath
                    document.querySelector('#active-file').innerText = response.filename
                    instance.setValue(response.content)
                })
                
                // Enable access to the monaco editor command palette from outside the browser
                // window execution context.
                window.api.receive('from:command:palette', (command) => {
                    instance.focus()
                    instance.trigger(command, 'editor.action.quickCommand')
                })

                // Enable ipc notifications.
                window.api.receive('from:notification:display', (event) => {
                    notify.send(event.status, event.message)
                })
            }
        })
    }
}
