import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api'

class CommandHandler
{
    constructor(instance) {
        this.instance = instance
    }

    registerAll() {
        this.instance.addAction({
            id: 'settings',
            label: 'Open Settings Dialog',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.US_SEMICOLON ],
            run: () => $('#settings').modal('show')
        })

        this.instance.addAction({
            id: 'bold',
            label: 'Make Text Bold',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_B ],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1,
            run: (editor) => this.bold(editor.getModel().getValue())
        })

        this.instance.addAction({
            id: 'italic',
            label: 'Make Text Italic',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_I ],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 2,
            run: (editor) => this.italic(editor.getModel().getValue())
        })

        this.instance.addAction({
            id: 'strikethrough',
            label: 'Make Text Strikethrough',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_G ],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 3,
            run: (editor) => this.strikethrough(editor.getModel().getValue())
        })

        this.instance.addAction({
            id: 'unordered-list',
            label: 'Convert To Unordered List',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_1 ],
            contextMenuGroupId: 'cutcopypaste',
            contextMenuOrder: 4,
            run: (editor) => this.unorderedList(editor.getModel().getValueInRange(editor.getSelection()))
        })

        this.instance.addAction({
            id: 'ordered-list',
            label: 'Convert To Ordered List',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_2 ],
            contextMenuGroupId: 'cutcopypaste',
            contextMenuOrder: 5,
            run: (editor) => this.orderedList(editor.getModel().getValueInRange(editor.getSelection()))
        })

        this.instance.addAction({
            id: 'replace-steps',
            label: 'Convert Ordered List To Task List',
            keybindings: [ KeyMod.CtrlCmd | KeyCode.KEY_3 ],
            contextMenuGroupId: 'cutcopypaste',
            contextMenuOrder: 6,
            run: (editor) => this.replaceStepsCmd(editor.getModel().getValueInRange(editor.getSelection()))
        })

        let blockAlerts = [
            {type: 'Primary', key: 'P'},
            {type: 'Secondary', key: 'E'},
            {type: 'Info', key: 'I'},
            {type: 'Success', key: 'S'},
            {type: 'Warning', key: 'W'},
            {type: 'Danger', key: 'D'},
            {type: 'Light', key: 'L'},
            {type: 'Dark', key: 'R'},
        ]

        blockAlerts.forEach((block) => {
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
        })

        let codeBlocks = [
            {type: 'Powershell', key: 'P'},
            {type: 'CLI', key: 'L'},
            {type: 'CSharp', key: 'C'},
            {type: 'FSharp', key: 'F'},
            {type: 'Visual-Basic', key: 'V'},
            {type: 'Python', key: 'Y'},
            {type: 'SQL', key: 'S'},
            {type: 'XML', key: 'X'},
            {type: 'JSON', key: 'J'}
        ]

        codeBlocks.forEach((block) => {
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
        })

        this.instance.onKeyDown((event) => {
            if(event.ctrlKey && event.code === 'KeyK') {
                $('#codeBlockMenuButton').dropdown('toggle')
            }

            if(event.ctrlKey && event.code === 'KeyL') {
                $('#alertMenuButton').dropdown('toggle')
            }

            this.instance.focus()
        })
    }

    bold() {
        this.replaceSelection('**' + this.getSelectionValue() + '**')
    }

    italic() {
        this.replaceSelection('_' + this.getSelectionValue() + '_')
    }

    strikethrough() {
        this.replaceSelection('~~' + this.getSelectionValue() + '~~')
    }

    unorderedList() {
        this.replaceSelection(this.getSelectionValue().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`))
    }

    orderedList() {
        let i = 0
        this.replaceSelection(this.getSelectionValue().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`))
    }

    replaceSteps() {
        let i = 0
        this.replaceSelection(this.getSelectionValue().replace(/^([0-9]+)\.\s+(?!\[)/gm, (match) => `${++i}. [ ] ${match}`))
    }

    alert(params, content = null) {
        let type = params.dataset ? params.dataset.type : params
        content = content ? content : this.getSelectionValue()
        this.replaceSelection('::: '+type+'\n'+ content + '\n:::')
    }

    codeblock(params, content = null) {
        let language = params.dataset ? params.dataset.language : params
        content = content ? content : this.getSelectionValue()
        this.replaceSelection('```'+language+'\n'+content+'\n```')
    }

    displayMedia(alt, uri) {
        this.replaceSelection(`![${alt}](${uri})`)
    }

    replaceStepsCmd(content) {
        this.replaceSelection(content.replace(/^([0-9]+)\.\s+(?!\[)/gm, '$1. [ ] '))
    }

    replaceSelection(replacement) {
        this.instance.executeEdits(null, [{
            range: this.instance.getSelection(),
            text: replacement,
            forceMoveMarkers: true
        }])
    }

    getSelectionValue() {
        return this.instance.getModel().getValueInRange(this.instance.getSelection())
    }
}

export default CommandHandler