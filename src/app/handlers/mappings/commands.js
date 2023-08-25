import { KeyMod, KeyCode } from 'monaco-editor/esm/vs/editor/editor.api';

export const alertblocks = [
    { type: 'Primary', key: 'P' },
    { type: 'Secondary', key: 'E' },
    { type: 'Info', key: 'I' },
    { type: 'Success', key: 'S' },
    { type: 'Warning', key: 'W' },
    { type: 'Danger', key: 'D' },
    { type: 'Light', key: 'L' },
    { type: 'Dark', key: 'R' }
];

export const codeblocks = [
    { type: 'Sh', key: 'S' },
    { type: 'Javascript', key: 'J' },
    { type: 'CSharp', key: 'C' },
    { type: 'Python', key: 'P' },
    { type: 'SQL', key: 'Q' },
    { type: 'XML', key: 'X' }
];

export const commands = {
    bold: {
        id: 'bold',
        label: 'Make Text Bold',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KeyB],
        syntax: '**'
    },
    italic: {
        id: 'italic',
        label: 'Make Text Italic',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KeyI],
        syntax: '_'
    },
    strikethrough: {
        id: 'strikethrough',
        label: 'Make Text Strikethrough',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KeyG],
        syntax: '~~'
    },
    unorderedList: {
        id: 'unordered-list',
        label: 'Convert To Unordered List',
        contextMenuGroupId: 'cutcopypaste',
        contextMenuOrder: 4,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_2]
    },
    orderedList: {
        id: 'ordered-list',
        label: 'Convert To Ordered List',
        contextMenuGroupId: 'cutcopypaste',
        contextMenuOrder: 5,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_3]
    },
    orderedListToTaskList: {
        id: 'ordered-list-to-task-list',
        label: 'Convert Ordered List To Task List',
        contextMenuGroupId: 'cutcopypaste',
        contextMenuOrder: 6,
        keybindings: [KeyMod.CtrlCmd | KeyCode.KEY_4]
    }
};
