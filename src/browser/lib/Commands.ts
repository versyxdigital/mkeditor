import {
  editor,
  KeyCode,
  KeyMod,
} from 'monaco-editor/esm/vs/editor/editor.api';
import { Modal, Dropdown } from 'bootstrap';
import {
  ModalProviders,
  ValidModal,
  ValidCommand,
  DropdownProviders,
} from '../interfaces/Providers';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { commands, alertblocks, codeblocks } from '../mappings/commands';
import { getOSPlatform } from '../util';
import { dom } from '../dom';

export class Commands {
  /** Execution mode */
  private mode: 'web' | 'desktop' = 'web';

  /** Editor model instance */
  private model: editor.IStandaloneCodeEditor;

  /** Editor event dispatcher */
  private dispatcher: EditorDispatcher;

  /** Editor command dropdown triggers */
  private dropdowns: DropdownProviders;

  /** Editor command modal triggers */
  private modals: ModalProviders;

  /** Editor command toolbar */
  private toolbar = dom.commands.toolbar;

  /**
   * Create a new mkeditor command handler.
   *
   * Responsible for creating a command handler and handling editor commands.
   *
   * @param mode  - the execution mode
   * @param model - the editor model instance
   * @param dispatcher - the editor event dispatcher
   */
  public constructor(
    mode: 'web' | 'desktop' = 'web',
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
  ) {
    this.mode = mode;
    this.model = model;
    this.dispatcher = dispatcher;

    this.modals = {
      about: new Modal(dom.about.modal),
      settings: new Modal(dom.settings.modal),
      shortcuts: new Modal(dom.shortcuts.modal),
    };

    this.dropdowns = {
      alertblocks: new Dropdown(dom.commands.dropdowns.alertblocks),
      codeblocks: new Dropdown(dom.commands.dropdowns.codeblocks),
      tables: new Dropdown(dom.commands.dropdowns.tables),
    };

    this.register();
  }

  /**
   * Sets the app execution mode.
   *
   * @param mode - the execution mode
   */
  public setAppMode(mode: 'web' | 'desktop') {
    this.mode = mode;
  }

  /**
   * Register editor commands.
   */
  public register() {
    // Register command keybinding for displaying settings modal action
    this.model.addAction({
      id: 'settings',
      label: 'Open Settings Dialog',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Semicolon],
      run: () => this.modals.settings.toggle(),
    });

    // Register command keybinding for displaying shortcuts modal action
    this.model.addAction({
      id: 'shortcuts',
      label: 'Open Shortcuts Help',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Backquote],
      run: () => this.modals.shortcuts.toggle(),
    });

    // Register command keybinding for displaying about modal action
    this.model.addAction({
      id: 'About',
      label: 'Open About Information',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Slash],
      run: () => this.modals.about.toggle(),
    });

    // Register separate keybindings for displaying alertblocks and codeblocks dropdowns.
    // The reason for this is because alertblocks and codeblocks are "2-stage" commands.
    // For example, the user presses Ctrl+K, to display the codeblocks dropdown, and then
    // presses J to insert a Javascript codeblock.
    this.model.onKeyDown((e) => {
      console.log(e);
      const holdKey = getOSPlatform() !== 'MacOS' ? e.ctrlKey : e.metaKey;
      if (holdKey && e.keyCode === 42 /* L */) {
        this.dropdowns.alertblocks.toggle();
      }
      if (holdKey && e.keyCode === 41 /* K */) {
        this.dropdowns.codeblocks.toggle();
      }
      if (holdKey && e.keyCode === 50 /* T */) {
        console.log(this.dropdowns.tables);
        this.dropdowns.tables.toggle();
      }
      this.model.focus();
    });

    // Register command keybindings for editor actions i.e. bold, italic, strikethrough.
    // These commands are mapped from their own file in mappings/commands.ts
    for (const cmd in commands) {
      if (commands[cmd].isInline && commands[cmd].syntax) {
        // Inline edits are performed by passing the command's syntax into this class' inline()
        // method, which in turn grabs the text selection within range and executes the edit, i.e.
        // for bold, the attached syntax is "**", therefore the edit will be **<text>**.
        commands[cmd].run = () => this.editInline(<string>commands[cmd].syntax);
      } else {
        if (cmd in this && typeof this[cmd as ValidCommand] === 'function') {
          // Fenced blocks have their own renderer functions explicitly defined in this class,
          // for example, alert(), codeblock(), unorderedList(), orderedList(). Fenced blocks
          // are edits that begin with their own syntax on the first line, and then end with
          // their own syntax on the last line, with the text occupying the lines in-between.
          // For examle, codeblocks (```).
          commands[cmd].run = () =>
            (this[cmd as ValidCommand] as (...args: any[]) => void)();
        }
      }

      this.model.addAction(<editor.IActionDescriptor>commands[cmd]);
    }

    // Map editor commands to editor UI buttons
    const toolbarButtons = this.toolbar.querySelectorAll('button');
    if (toolbarButtons) {
      for (const btn of toolbarButtons) {
        btn.addEventListener('click', (event) => {
          const target = event.currentTarget || event.target;
          if (target && target instanceof HTMLElement && target.dataset.cmd) {
            const { cmd, syntax } = target.dataset;
            if (commands[cmd] && commands[cmd].isInline && syntax) {
              // Same inline edit functionality explained in the loop above.
              this.editInline(syntax);
            } else {
              // Same fenced block edit functionality explained in the loop above.
              (this[cmd as ValidCommand] as (t: HTMLElement) => any)(target);
            }
            this.model.focus();
          }
        });
      }
    }

    for (const block of alertblocks) {
      // Register command keybindings for each alertblock type.
      const binding = `Key${block.key}` as keyof typeof KeyCode;
      this.model.addAction({
        id: `alert-${block.type}`,
        label: `Insert ${block.type} Alert`,
        keybindings: [
          KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyL, KeyCode[binding]),
        ],
        run: () => {
          this.alert(block.type.toLowerCase());
          this.dropdowns.alertblocks.hide();
        },
      });
    }

    for (const block of codeblocks) {
      // Register command keybinding for each codeblock language.
      const binding = `Key${block.key}` as keyof typeof KeyCode;
      this.model.addAction({
        id: `codeblock-${block.type}`,
        label: `Insert ${
          block.type.charAt(0).toUpperCase() + block.type.slice(1)
        } Codeblock`,
        keybindings: [
          KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode[binding]),
        ],
        run: () => {
          this.codeblock(block.type.toLowerCase());
          this.dropdowns.codeblocks.hide();
        },
      });
    }
  }

  /**
   * get an editor modal triggered by a command.
   *
   * @param key - the modal key
   * @returns
   */
  public getModal(key: ValidModal) {
    return this.modals[key] as Modal;
  }

  /**
   * Execute an inline edit command on the model.
   *
   * @param syntax - the markdown syntax (i.e. ** or __)
   */
  private editInline(syntax: string) {
    this.executeEdit(syntax + this.getModel() + syntax);
  }

  /**
   * Execute edit commands on the model.
   *
   * @param content - the content to manipulate
   */
  private executeEdit(content: string) {
    this.model.executeEdits(null, [
      {
        range: this.getRange(),
        text: content,
        forceMoveMarkers: true,
      },
    ]);
  }

  /**
   * Get the editor model instance.
   *
   * @returns
   */
  private getModel() {
    const model =
      this.model.getModel()?.getValueInRange(this.getRange()) ?? ' ';

    return model;
  }

  /**
   * Get the editor content range for command execution.
   *
   * @returns
   */
  private getRange() {
    return (
      this.model.getSelection() ?? {
        startLineNumber: 0,
        startColumn: 0,
        endLineNumber: 0,
        endColumn: 0,
      }
    );
  }

  /**
   * Insert an alert.
   *
   * @param params - alert parameters
   * @param content - the content to insert
   */
  private alert(params: HTMLElement | string, content?: string) {
    const alert = params instanceof HTMLElement ? params.dataset.type : params;
    content = content || this.getModel();
    this.executeEdit('::: ' + alert + '\n' + content + '\n:::');
  }

  /**
   * Insert a codeblock.
   *
   * @param params - codeblock parameters
   * @param content - the content to insert
   */
  private codeblock(params: HTMLElement | string, content?: string) {
    const language =
      params instanceof HTMLElement ? params.dataset.language : params;
    content = content || this.getModel();
    this.executeEdit('```' + language + '\n' + content + '\n```');
  }

  /**
   * Create an unordered list.
   */
  private unorderedList() {
    this.executeEdit(
      this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`),
    );
  }

  /**
   * Create an ordered list.
   */
  private orderedList() {
    let i = 0;
    this.executeEdit(
      this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`),
    );
  }
}
