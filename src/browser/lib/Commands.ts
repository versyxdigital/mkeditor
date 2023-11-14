import { editor, KeyCode, KeyMod } from 'monaco-editor/esm/vs/editor/editor.api';
import { Modal, Dropdown } from 'bootstrap';
import { ModalProviders, ValidModal, ValidCommand, DropdownProviders } from '../interfaces/Providers';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { commands, alertblocks, codeblocks } from '../mappings/commands';
import { getOSPlatform } from '../util';
import { dom } from '../dom';

export class Commands {

  private mode: 'web' | 'desktop' = 'web';

  private model: editor.IStandaloneCodeEditor;

  private dispatcher: EditorDispatcher;

  private dropdowns: DropdownProviders;

  private modals: ModalProviders;

  private toolbar = dom.commands.toolbar;

  constructor (
    mode: 'web' | 'desktop' = 'web',
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher
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
      codeblocks: new Dropdown(dom.commands.dropdowns.codeblocks)
    };

    this.register();
  }

  setAppMode (mode: 'web' | 'desktop') {
    this.mode = mode;
  }

  register () {
    this.model.onKeyDown((e) => {
      const holdKey = getOSPlatform() !== 'MacOS' ? e.ctrlKey : e.metaKey;
      if (holdKey && e.keyCode === 42 /* L */) this.dropdowns.alertblocks.toggle();
      if (holdKey && e.keyCode === 41 /* K */) this.dropdowns.codeblocks.toggle();
      this.model.focus();
    });

    this.model.addAction({
      id: 'settings',
      label: 'Open Settings Dialog',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Semicolon],
      run: () => this.modals.settings.toggle()
    });

    this.model.addAction({
      id: 'shortcuts',
      label: 'Open Shortcuts Help',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Backquote],
      run: () => this.modals.shortcuts.toggle()
    });

    this.model.addAction({
      id: 'About',
      label: 'Open About Information',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Slash],
      run: () => this.modals.about.toggle()
    });

    // Map editor commands to actions
    for (const cmd in commands) {
      if (commands[cmd].isInline && commands[cmd].syntax) {
        // Inline commands are performed by passing the relevant syntax into this class'
        // inline method, which in turn grabs the editor value within range and executes
        // the edit.
        commands[cmd].run = () => this.inline(<string>commands[cmd].syntax);
      } else {
        if (cmd in this && typeof this[cmd as ValidCommand] === 'function') {
          // Fenced commands have their own renderer functions defined in this class,
          // for example, unorderedList, orderedList etc.
          commands[cmd].run = () => (this[cmd as ValidCommand] as Function)();
        }
      }

      this.model.addAction(
        <editor.IActionDescriptor>commands[cmd]
      );
    }

    // Map editor commands to editor UI buttons (e.g. bold, alertblock etc.)
    const toolbarButtons = this.toolbar.querySelectorAll('button');
    if (toolbarButtons) {
      for (const btn of toolbarButtons) {
        btn.addEventListener('click', (event) => {
          const target = event.currentTarget || event.target;
          if (target && target instanceof HTMLElement && target.dataset.cmd) {
            const { cmd, syntax } = target.dataset;
            if (commands[cmd] && commands[cmd].isInline && syntax) {
              // If function contains data-syntax then execute the command, passing the
              // markdown syntax to be used (inline)
              this.inline(syntax);
            } else {
              // Otherwise if there is no syntax provided then call the renderer function
              // defined in this class instead (fenced).
              (this[cmd as ValidCommand] as Function)(target);
            }
            this.model.focus();
          }
        });
      }
    }

    for (const block of alertblocks) {
      // The reason we use keyof typeof KeyCode instead of just as keyof KeyCode is due
      // to the fact that enum values are not guaranteed to be keys. Enum values can be
      // any string or numeric literal, and they are not automatically treated as keys
      // of the enum type.
      const binding = (`Key${block.key}` as keyof typeof KeyCode);
      this.model.addAction({
        id: `alert-${block.type}`,
        label: `Insert ${block.type} Alert`,
        keybindings: [KeyMod.chord(
          KeyMod.CtrlCmd | KeyCode.KeyL,
          KeyCode[binding]
        )],
        run: () => {
          this.alert(block.type.toLowerCase());
          this.dropdowns.alertblocks.hide();
        }
      });
    }

    for (const block of codeblocks) {
      const binding = (`Key${block.key}` as keyof typeof KeyCode);
      this.model.addAction({
        id: `codeblock-${block.type}`,
        label: `Insert ${block.type.charAt(0).toUpperCase() + block.type.slice(1)} Codeblock`,
        keybindings: [KeyMod.chord(
          KeyMod.CtrlCmd | KeyCode.KeyK,
          KeyCode[binding]
        )],
        run: () => {
          this.codeblock(block.type.toLowerCase());
          this.dropdowns.codeblocks.hide();
        }
      });
    }
  }

  inline (syntax: string) {
    this.execute(syntax + this.getModel() + syntax);
  }

  execute (str: string) {
    this.model.executeEdits(null, [{
      range: this.getRange(),
      text: str,
      forceMoveMarkers: true
    }]);
  }

  getModal (key: ValidModal) {
    return this.modals[key] as Modal;
  }

  getModel () {
    const model = this.model.getModel()?.getValueInRange(
      this.getRange()
    ) ?? ' ';

    return model;
  }

  getRange() {
    return this.model.getSelection() ?? {
      startLineNumber: 0,
      startColumn: 0,
      endLineNumber: 0,
      endColumn: 0
    };
  }

  alert (params: HTMLElement | string, content?: string) {
    const alert = params instanceof HTMLElement ? params.dataset.type : params;
    content = content || this.getModel();
    this.execute('::: ' + alert + '\n' + content + '\n:::');
  }

  codeblock (params: HTMLElement | string, content?: string) {
    const language = params instanceof HTMLElement ? params.dataset.language : params;
    content = content || this.getModel();
    this.execute('```' + language + '\n' + content + '\n```');
  }

  unorderedList () {
    this.execute(this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`));
  }

  orderedList () {
    let i = 0;
    this.execute(this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`));
  }
}