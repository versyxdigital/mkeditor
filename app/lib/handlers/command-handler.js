import { Modal, Dropdown } from 'bootstrap'
import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api'
import { commands, alertblocks, codeblocks } from './mappings/commands'

class CommandHandler
{
    constructor(instance) {
        this.instance = instance
        this.settings = new Modal(document.getElementById('settings'))
        this.alerts = new Dropdown(document.getElementById('alertMenuButton'))
        this.codeblocks = new Dropdown(document.getElementById('codeBlockMenuButton'))
    }

    register() {
        for (const cmd in commands) {
            if (Object.prototype.hasOwnProperty.call(commands[cmd], 'op')) {
                commands[cmd].run = () => this.exec(commands[cmd].op)
            } else {
                commands[cmd].run = () => this[cmd]()
            }
            
            this.instance.addAction(commands[cmd])
        }

        this.instance.addAction({
            id: 'settings',
            label: 'Open Settings Dialog',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.US_SEMICOLON ],
            run: () => {
                this.settings.toggle()
            }
        })

        for (const block of alertblocks) {
            this.instance.addAction({
                id: `alert-${block.type}`,
                label: `Insert ${block.type} Alert`,
                keybindings: [KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_L, KeyCode[`KEY_${block.key}`])],
                run: () => {
                    this.alert(block.type.toLowerCase())
                    this.alerts.hide()
                }
            })
        }

        for (const block of codeblocks) {
            this.instance.addAction({
                id: `codeblock-${block.type}`,
                label: `Insert ${block.type.charAt(0).toUpperCase() + block.type.slice(1)} Codeblock`,
                keybindings: [KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode[`KEY_${block.key}`])],
                run: () => {
                    this.codeblock(block.type.toLowerCase())
                    this.codeblocks.hide()
                }
            })
        }
    }

    exec(op) {
        this.do(op + this.model() + op)
    }

    unorderedList() {
        this.do(this.model().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`))
    }

    orderedList() {
        let i = 0
        this.do(this.model().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`))
    }

    orderedListToTaskList() {
        let i = 0
        this.do(this.model().replace(/^([0-9]+)\.\s+(?!\[)/gm, (match) => `${++i}. [ ] ${match}`))
    }

    alert(params, content = null) {
        const type = params.dataset ? params.dataset.type : params
        content = content ? content : this.model()
        this.do('::: '+type+'\n'+ content + '\n:::')
    }

    codeblock(params, content = null) {
        const language = params.dataset ? params.dataset.language : params
        content = content ? content : this.model()
        this.do('```'+language+'\n'+content+'\n```')
    }

    do(replacement) {
        this.instance.executeEdits(null, [{
            range: this.instance.getSelection(),
            text: replacement,
            forceMoveMarkers: true
        }])
    }

    model() {
        return this.instance.getModel()
            .getValueInRange(this.instance.getSelection())
    }
}

export default CommandHandler