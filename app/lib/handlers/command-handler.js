import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api'
import { commands, alertblocks, codeblocks } from './mappings/commands' 

class CommandHandler
{
    constructor(instance) {
        this.instance = instance
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
            run: () => $('#settings').modal('show')
        })

        for (const block of alertblocks) {
            this.instance.addAction({
                id: `alert-${block.type}`,
                label: `Insert ${block.type} Alert`,
                keybindings: [
                    KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_L, KeyCode[`KEY_${block.key}`])
                ],
                run: (editor) => {
                    this.alert(block.type.toLowerCase(), editor.getModel().getValueInRange(editor.getSelection()))
                    $('#alertMenuButton').dropdown('hide')
                }
            })
        }

        for (const block of codeblocks) {
            this.instance.addAction({
                id: `codeblock-${block.type}`,
                label: `Insert ${block.type.charAt(0).toUpperCase() + block.type.slice(1)} Codeblock`,
                keybindings: [
                    KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode[`KEY_${block.key}`])
                ],
                run: (editor) => {
                    this.codeblock(block.type.toLowerCase(), editor.getModel().getValueInRange(editor.getSelection()))
                    $('#codeBlockMenuButton').dropdown('hide')
                }
            })
        }
    }

    exec(op) {
        this.replaceSelection(op + this.getSelection() + op)
    }

    unorderedList() {
        this.replaceSelection(this.getSelection().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`))
    }

    orderedList() {
        let i = 0
        this.replaceSelection(this.getSelection().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`))
    }

    orderedListToTaskList() {
        let i = 0
        this.replaceSelection(this.getSelection().replace(/^([0-9]+)\.\s+(?!\[)/gm, (match) => `${++i}. [ ] ${match}`))
    }

    alert(params, content = null) {
        let type = params.dataset ? params.dataset.type : params
        content = content ? content : this.getSelection()
        this.replaceSelection('::: '+type+'\n'+ content + '\n:::')
    }

    codeblock(params, content = null) {
        let language = params.dataset ? params.dataset.language : params
        content = content ? content : this.getSelection()
        this.replaceSelection('```'+language+'\n'+content+'\n```')
    }

    replaceSelection(replacement) {
        this.instance.executeEdits(null, [{
            range: this.instance.getSelection(),
            text: replacement,
            forceMoveMarkers: true
        }])
    }

    getSelection() {
        return this.instance.getModel().getValueInRange(this.instance.getSelection())
    }
}

export default CommandHandler