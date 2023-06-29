import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import taskLists from './extensions/task-lists'
import codeBlocks from './extensions/code-blocks'
import alertBlocks from './extensions/alert-blocks'
import tableStyles from './extensions/table-styles'
import lineNumbers from './extensions/line-numbers'
import { wordCount, characterCount } from './extensions/word-count'
import { scrollPreviewToEditorVisibleRange } from './extensions/scroll-sync'
import { editor } from 'monaco-editor/esm/vs/editor/editor.api'

const md = new MarkdownIt({
    code: false
})

md.use(alertBlocks)
md.use(lineNumbers)
md.use(taskLists, {labelClass: 'ml-2'})
md.use(tableStyles, {tableClass: ['table', 'table-sm', 'table-bordered', 'table-striped']})

class Editor
{
    constructor(editor, preview) {
        // Active editor
        this.instance = null

        // Editor and preview DOM
        this.editor = editor
        this.preview = preview

        // Access to handlers
        this.commandHandler = null
        this.settingsHandler = null
        this.ipcHandler = null

        // Track initial editor value for comparison to current value
        this.loadedInitialEditorValue = null

        // Fetch stored editor settings.
        this.savedConfig = JSON.parse(localStorage.getItem('settings'))
        
        // Set editor settings to either defaults or saved settings
        this.wordWrap = 'on'
        this.autoIndent = 'none'
        this.whitespace = 'none'
        if (this.savedConfig) {
            this.wordWrap = this.savedConfig.toggleWordWrap ? 'on' : 'off'
            this.autoIndent = this.savedConfig.toggleAutoIndent ? 'advanced' : 'none'
            this.whitespace = this.savedConfig.toggleWhitespace ? 'all' : 'none'
        }
    }

    init(options = {watch: false}) {
        try {
            this.instance = editor.create(this.editor, {
                value: '# Write some stuff...',
                language: 'markdown',
                wordBasedSuggestions: false,
                autoIndent: this.autoIndent,
                wordWrap: this.wordWrap,
                renderWhitespace: this.whitespace,
                renderLineHighlight: 'gutter',
                smoothScrolling: 'true',
                roundedSelection: false,
                accessibilityPageSize: 1000
            })

            this.loadedInitialEditorValue = this.instance.getValue()
            window.addEventListener('editor:state', (event) => {
                this.loadedInitialEditorValue = event.detail
            })

            window.onresize = () => this.instance.layout()
            this.preview.onresize = () => this.instance.layout()

            this.render()

            if (options.watch) {
                this.watch()
            }
        } catch (error) {
            this.instance = null
            console.log(error)
        }

        return this.instance
    }

    watch() {
        this.instance.onDidChangeModelContent(() => {
            if (this.ipcHandler) {
                this.ipcHandler.trackEditorStateBetweenExecutionContext(
                    this.loadedInitialEditorValue,
                    this.instance.getValue()
                )
            }

            this.render()
        })

        this.instance.onDidScrollChange(() => {
            const visibleRange = this.instance.getVisibleRanges()[0]
            if (visibleRange) {
                scrollPreviewToEditorVisibleRange(visibleRange.startLineNumber, this.preview)
            }
        })

        this.instance.onKeyDown((e) => {
            if (e.ctrlKey && e.keyCode === 42 /* L */) {
                this.commandHandler.alerts.toggle()
            }

            if (e.ctrlKey && e.keyCode === 41 /* K */) {
                this.commandHandler.codeblocks.toggle()
            }

            this.instance.focus()
        })
    }

    render() {
        this.preview.innerHTML = md.render(this.instance.getValue())
        
        this.preview.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block)
        })
        codeBlocks()

        wordCount(this.preview)
        characterCount(this.preview)
    }

    registerCommandHandler(handler) {
        this.commandHandler = handler
    }

    registerSettingsHandler(handler) {
        this.settingsHandler = handler
    }

    registerIpcHandler(handler) {
        this.ipcHandler = handler
    }
}

export default Editor
