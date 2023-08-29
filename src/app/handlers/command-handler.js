import { Modal, Dropdown } from 'bootstrap';
import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';
import { commands, alertblocks, codeblocks } from './mappings/commands';

/**
 * Command Handler
 *
 * Provides mapping for editor commands and shortcuts.
 */
class CommandHandler {
    /**
     * Create a new CommandHandler instance.
     *
     * @param {*} instance
     * @param {*} register
     */
    constructor (instance, register = false) {
        this.instance = instance;
        this.settings = new Modal(document.getElementById('settings'));
        this.shortcuts = new Modal(document.getElementById('editor-shortcuts'));
        this.alerts = new Dropdown(document.getElementById('alert-menu-button'));
        this.codeblocks = new Dropdown(document.getElementById('codeblock-menu-button'));

        if (register) {
            this.register();
        }
    }

    /**
     * Register all commands
     *
     * @return
     */
    register () {
        this.instance.onKeyDown((e) => {
            if (e.ctrlKey && e.keyCode === 42 /* L */) {
                this.alerts.toggle();
            }

            if (e.ctrlKey && e.keyCode === 41 /* K */) {
                this.codeblocks.toggle();
            }

            this.instance.focus();
        });

        for (const cmd in commands) {
            if (Object.prototype.hasOwnProperty.call(commands[cmd], 'syntax')) {
                // If command has "syntax", then it is inline e.g single-line, bold, italic.
                //
                // Inline commands are performed by passing the relevant syntax into this class'
                // inline method, which in turn grabs the editor value within range and executes
                // the edit.
                commands[cmd].run = () => this.inline(commands[cmd].syntax);
            } else {
                // Otherwise it is fenced e.g. multi-line, list, codeblock.
                //
                // Fenced commands have their own renderer functions defined in this class,
                // for example, unorderedList, orderedList etc.
                commands[cmd].run = () => this[cmd]();
            }

            this.instance.addAction(commands[cmd]);
        }

        this.instance.addAction({
            id: 'settings',
            label: 'Open Settings Dialog',
            keybindings: [KeyMod.CtrlCmd | KeyCode.Semicolon],
            run: () => {
                this.settings.toggle();
            }
        });

        for (const block of alertblocks) {
            this.instance.addAction({
                id: `alert-${block.type}`,
                label: `Insert ${block.type} Alert`,
                keybindings: [KeyMod.chord(
                    KeyMod.CtrlCmd | KeyCode.KeyL,
                    KeyCode[`Key${block.key}`]
                )],
                run: () => {
                    this.alert(block.type.toLowerCase());
                    this.alerts.hide();
                }
            });
        }

        for (const block of codeblocks) {
            this.instance.addAction({
                id: `codeblock-${block.type}`,
                label: `Insert ${block.type.charAt(0).toUpperCase() + block.type.slice(1)} Codeblock`,
                keybindings: [KeyMod.chord(
                    KeyMod.CtrlCmd | KeyCode.KeyK,
                    KeyCode[`Key${block.key}`]
                )],
                run: () => {
                    this.codeblock(block.type.toLowerCase());
                    this.codeblocks.hide();
                }
            });
        }

        // Map editor commands to editor UI buttons (e.g. bold, alertblock etc.)
        const toolbarButtons = document.getElementById('editor-functions').querySelectorAll('button');
        if (toolbarButtons) {
            for (const btn of toolbarButtons) {
                btn.addEventListener('click', (event) => {
                    const target = event.currentTarget || event.target;
                    if (Object.prototype.hasOwnProperty.call(target.dataset, 'cmd')) {
                        const { cmd } = target.dataset;
                        target.dataset.syntax && !(commands[cmd] instanceof Function)
                            // If function contains data-syntax then execute the command,
                            // passing the markdown syntax to be used (inline)
                            ? this.inline(target.dataset.syntax)
                            // Otherwise if there is no syntax provided then call the
                            // defined renderer function instead (fenced)
                            : this[cmd](target);

                        this.instance.focus();
                    }
                });
            }
        }
    }

    /**
     * Execute inline command
     *
     * @param {string} syntax
     */
    inline (syntax) {
        this.execute(syntax + this.model() + syntax);
    }

    /**
     * Perform editor changes from executed command
     *
     * @param {string} text
     */
    execute (text) {
        this.instance.executeEdits(null, [{
            range: this.instance.getSelection(),
            text,
            forceMoveMarkers: true
        }]);
    }

    /**
     * Fetch the editor model content
     *
     * @returns
     */
    model () {
        return this.instance.getModel().getValueInRange(this.instance.getSelection());
    }

    /**
     * Create an unordered list (fenced)
     *
     * @returns
     */
    unorderedList () {
        this.execute(this.model().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`));
    }

    /**
     * Create an ordered list (fenced)
     *
     * @returns
     */
    orderedList () {
        let i = 0;
        this.execute(this.model().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`));
    }

    /**
     * Convert an ordered list to a task list (fenced)
     *
     * @returns
     */
    orderedListToTaskList () {
        let i = 0;
        this.execute(this.model().replace(
            /^([0-9]+)\.\s+(?!\[)/gm,
            (match) => `${++i}. [ ] ${match.replace(/^([0-9]+)\.\s+(?!\[)/, '')}`)
        );
    }

    /**
     * Create an alert (fenced)
     *
     * @param {*} params
     * @param {*} content
     */
    alert (params, content = null) {
        const type = params.dataset ? params.dataset.type : params;
        content = content || this.model();
        this.execute('::: ' + type + '\n' + content + '\n:::');
    }

    /**
     * Create a codeblock (fenced)
     *
     * @param {*} params
     * @param {*} content
     */
    codeblock (params, content = null) {
        const language = params.dataset ? params.dataset.language : params;
        content = content || this.model();
        this.execute('```' + language + '\n' + content + '\n```');
    }
}

export default CommandHandler;
