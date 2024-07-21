import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorCommand } from '../interfaces/Editor';

export const alertblocks = [
  { type: 'Primary', key: 'P' },
  { type: 'Secondary', key: 'E' },
  { type: 'Info', key: 'I' },
  { type: 'Success', key: 'S' },
  { type: 'Warning', key: 'W' },
  { type: 'Danger', key: 'D' },
  { type: 'Light', key: 'L' },
  { type: 'Dark', key: 'R' },
];

export const codeblocks = [
  { type: 'Sh', key: 'S' },
  { type: 'Javascript', key: 'J' },
  { type: 'Typescript', key: 'T' },
  { type: 'CSharp', key: 'C' },
  { type: 'PHP', key: 'P' },
  { type: 'Python', key: 'Y' },
  { type: 'JSON', key: 'O' },
  { type: 'YAML', key: 'M' },
  { type: 'SQL', key: 'Q' },
  { type: 'XML', key: 'X' },
];

export const commands: Record<string, EditorCommand> = {
  bold: {
    id: 'bold',
    label: 'Make Text Bold',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyB],
    isInline: true,
    syntax: '**',
  },
  italic: {
    id: 'italic',
    label: 'Make Text Italic',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 2,
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyI],
    isInline: true,
    syntax: '_',
  },
  strikethrough: {
    id: 'strikethrough',
    label: 'Make Text Strikethrough',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 3,
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyG],
    isInline: true,
    syntax: '~~',
  },
  unorderedList: {
    id: 'unordered-list',
    label: 'Convert To Unordered List',
    contextMenuGroupId: 'cutcopypaste',
    contextMenuOrder: 4,
    keybindings: [KeyMod.CtrlCmd | KeyCode.Digit2], // todo find an available accelerator
    isInline: false,
  },
  orderedList: {
    id: 'ordered-list',
    label: 'Convert To Ordered List',
    contextMenuGroupId: 'cutcopypaste',
    contextMenuOrder: 5,
    keybindings: [KeyMod.CtrlCmd | KeyCode.Digit3], // todo find an available accelerator
    isInline: false,
  },
};
