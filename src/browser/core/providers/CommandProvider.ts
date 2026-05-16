import { type editor, KeyCode, KeyMod } from 'monaco-editor';
import type { ValidCommand } from '../../interfaces/Providers';
import { commands, alertblocks, codeblocks } from '../mappings/editorCommands';
import { openModalExternal } from '../../react/contexts/ModalsContext';
import { getOSPlatform } from '../../util';

export type ToolbarDropdownKey = 'alertblocks' | 'codeblocks' | 'tables';

export class CommandProvider {
  /** Editor instance */
  private mkeditor: editor.IStandaloneCodeEditor;

  /**
   * Bridge to <EditorToolbar>'s dropdown open state. Registered by the
   * toolbar component on mount; lets Monaco keybindings and chord
   * actions open/close the React-managed shadcn dropdowns without
   * reaching for the DOM.
   */
  private openDropdown: ((key: ToolbarDropdownKey | null) => void) | null =
    null;

  /**
   * Create a new mkeditor command handler.
   *
   * @param mkeditor - the editor instance
   */
  public constructor(mkeditor: editor.IStandaloneCodeEditor) {
    this.mkeditor = mkeditor;
    this.register();
  }

  /**
   * Register the dropdown-open callback supplied by <EditorToolbar>.
   * Pass null to clear (e.g., on unmount).
   */
  public setOpenDropdown(
    handler: ((key: ToolbarDropdownKey | null) => void) | null,
  ) {
    this.openDropdown = handler;
  }

  /**
   * Register editor commands.
   */
  public register() {
    // Register command keybinding for displaying settings modal action
    this.mkeditor.addAction({
      id: 'settings',
      label: 'Open Settings Dialog',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Semicolon],
      run: () => openModalExternal('settings'),
    });

    // Register command keybinding for displaying shortcuts modal action
    this.mkeditor.addAction({
      id: 'shortcuts',
      label: 'Open Shortcuts Help',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Backquote],
      run: () => openModalExternal('shortcuts'),
    });

    // Register command keybinding for displaying about modal action
    this.mkeditor.addAction({
      id: 'About',
      label: 'Open About Information',
      keybindings: [KeyMod.CtrlCmd | KeyCode.Slash],
      run: () => openModalExternal('about'),
    });

    // Two-stage chord shortcuts: a bare Ctrl+L / Ctrl+K / Ctrl+T opens
    // the corresponding shadcn dropdown so the user can either click an
    // item or press the second chord key. The dropdown open state lives
    // in <EditorToolbar>; we call into it via the registered callback.
    //
    // We must NOT call `mkeditor.focus()` after opening a dropdown:
    // Radix's dismissable layer (under Popover) listens for focusin
    // events outside the popover content and fires `onOpenChange(false)`
    // when it sees one. Re-focusing Monaco in the same tick that the
    // popover renders causes the popover to flash open and immediately
    // close. Early-return after opening to skip the refocus.
    this.mkeditor.onKeyDown((e) => {
      const holdKey = getOSPlatform() !== 'MacOS' ? e.ctrlKey : e.metaKey;
      if (!holdKey) return;
      if (e.keyCode === KeyCode.KeyL) {
        this.openDropdown?.('alertblocks');
        return;
      }
      if (e.keyCode === KeyCode.KeyK) {
        this.openDropdown?.('codeblocks');
        return;
      }
      if (e.keyCode === KeyCode.KeyT) {
        this.openDropdown?.('tables');
        return;
      }
      this.mkeditor.focus();
    });

    // Register command keybindings for editor actions i.e. bold, italic, strikethrough.
    // These commands are mapped from their own file in mappings/editorCommands.ts
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

      this.mkeditor.addAction(<editor.IActionDescriptor>commands[cmd]);
    }

    // Phase 7 moved the build-version chip into <BottomToolbarRight>;
    // its onClick now opens the React About modal via ModalsContext.
    // No DOM listener is registered from here anymore.

    for (const block of alertblocks) {
      // Register command keybindings for each alertblock type.
      const binding = `Key${block.key}` as keyof typeof KeyCode;
      this.mkeditor.addAction({
        id: `alert-${block.type}`,
        label: `Insert ${block.type} Alert`,
        keybindings: [
          KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyL, KeyCode[binding]),
        ],
        run: () => {
          this.alert(block.type.toLowerCase());
          this.openDropdown?.(null);
        },
      });
    }

    for (const block of codeblocks) {
      // Register command keybinding for each codeblock language.
      const binding = `Key${block.key}` as keyof typeof KeyCode;
      this.mkeditor.addAction({
        id: `codeblock-${block.type}`,
        label: `Insert ${
          block.type.charAt(0).toUpperCase() + block.type.slice(1)
        } Codeblock`,
        keybindings: [
          KeyMod.chord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode[binding]),
        ],
        run: () => {
          this.codeblock(block.type.toLowerCase());
          this.openDropdown?.(null);
        },
      });
    }
  }

  /**
   * Execute an inline edit command on the model. Public so the React
   * <EditorToolbar> can invoke it directly for bold/italic/strikethrough/
   * link buttons.
   */
  public editInline(syntax: string) {
    const selected = this.getModel();
    let edit: string;
    // Handle inline links
    if (syntax === '[]()') {
      const text = selected && selected.trim().length > 0 ? selected : 'link';
      edit = `[${text}](#)`;
    } else {
      edit = syntax + this.getModel() + syntax;
    }

    this.executeEdit(edit);
  }

  /**
   * Execute edit commands on the model.
   *
   * @param content - the content to manipulate
   */
  private executeEdit(content: string) {
    this.mkeditor.executeEdits(null, [
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
      this.mkeditor.getModel()?.getValueInRange(this.getRange()) ?? ' ';

    return model;
  }

  /**
   * Get the editor content range for command execution.
   *
   * @returns
   */
  private getRange() {
    return (
      this.mkeditor.getSelection() ?? {
        startLineNumber: 0,
        startColumn: 0,
        endLineNumber: 0,
        endColumn: 0,
      }
    );
  }

  /**
   * Insert an alert. Public so <EditorToolbar>'s alertblocks DropdownMenu
   * can call it directly. Accepts a Monaco keybinding string (used by
   * chord actions) or undefined (uses currently-selected text).
   */
  public alert(alertType: string, content?: string) {
    content = content || this.getModel();
    this.executeEdit('::: ' + alertType + '\n' + content + '\n:::');
  }

  /**
   * Insert a codeblock. Public so <EditorToolbar>'s codeblocks
   * DropdownMenu can call it directly.
   */
  public codeblock(language: string, content?: string) {
    content = content || this.getModel();
    this.executeEdit('```' + language + '\n' + content + '\n```');
  }

  /**
   * Insert a markdown table with the given dimensions. Public so
   * <EditorToolbar>'s tables Popover can pass the form values directly.
   * Previously read `dom.commands.forms.tables.{rows,cols}.value`;
   * Phase 6 routes the form values through React state instead.
   */
  public table(numCols: number, numRows: number) {
    const makeRow = (cells: string[]) => `| ${cells.join(' | ')} |`;

    const header = makeRow(Array(numCols).fill('Header'));
    const separator = makeRow(Array(numCols).fill('---'));
    const body = Array(numRows)
      .fill(makeRow(Array(numCols).fill('Cell')))
      .join('\n');

    this.executeEdit(`${header}\n${separator}\n${body}\n`);
  }

  /**
   * Create an unordered list. Public so <EditorToolbar> can call it.
   */
  public unorderedList() {
    this.executeEdit(
      this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `- ${match}`),
    );
  }

  /**
   * Create an ordered list. Public so <EditorToolbar> can call it.
   */
  public orderedList() {
    let i = 0;
    this.executeEdit(
      this.getModel().replace(/^[a-zA-Z]+?/gm, (match) => `${++i}. ${match}`),
    );
  }
}
