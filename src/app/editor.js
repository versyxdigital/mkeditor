import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import taskLists from './extensions/task-lists'
import codeBlocks from './extensions/code-blocks'
import alertBlocks from './extensions/alert-blocks'
import tableStyles from './extensions/table-styles'
import lineNumbers from './extensions/line-numbers'
import { wordCount, characterCount } from './extensions/word-count'
import { getEditorLineNumberForPreviewOffset, scrollPreviewToEditorVisibleRange } from './extensions/scroll-sync'
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
        this.instance = null
        this.editor = editor
        this.preview = preview
        this.commands = null
        this.settings = null
        this.ipc = null
        this.original = null

        // Fetch stored editor settings.
        this.savedConfig = JSON.parse(localStorage.getItem('settings'))
        
        // Set editor settings to either defaults or saved settings.
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

            this.original = this.instance.getValue()
            window.addEventListener('editor:state', (event) => {
                this.original = event.detail
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

    handlePreviewScroll(event) {
        event.stopPropagation()

        const line = getEditorLineNumberForPreviewOffset(
            this.instance.getModel().getLineCount(),
            event.target
        )

        this.instance.revealRangeAtTop({
            startColumn: 0,
            endColumn: 100,
            startLineNumber: Math.floor(line),
            endLineNumber: Math.floor(line) + 1
        }, 0)
    }

    watch() {
        this.instance.onDidChangeModelContent(() => {
            if (this.ipc) {
                this.ipc.trackEditorStateBetweenExecutionContext(
                    this.original,
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
                this.commands.alerts.toggle()
            }

            if (e.ctrlKey && e.keyCode === 41 /* K */) {
                this.commands.codeblocks.toggle()
            }

            this.instance.focus()
        })
    }

    render() {
        // Render source markdown
        this.preview.innerHTML = md.render(this.instance.getValue())

        // Highlight codeblocks and provide copy func
        this.preview.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block)
        })
        codeBlocks()

        // Do character and word counts
        wordCount(this.preview)
        characterCount(this.preview)
    }

    registerCommandHandler(handler) {
        this.commands = handler
    }

    registerSettingsHandler(handler) {
        this.settings = handler
    }

    registerIpcHandler(handler) {
        this.ipc = handler
    }
}

export default Editor
