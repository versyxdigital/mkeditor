import { KeyMod, KeyCode } from 'monaco-editor';
import type { EditorCommand } from '../../interfaces/Editor';

// Re-export the pure-data block mappings so existing CommandProvider
// imports (`alertblocks`, `codeblocks` from this file) keep working.
// The new home `editorBlocks.ts` carries no Monaco dependency, so
// React surface that only needs the data lists (see <EditorToolbar>)
// can import from there without pulling Monaco into the main chunk.
export { alertblocks, codeblocks } from './editorBlocks';
export type { BlockMapping } from './editorBlocks';

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
  mdLinkAdd: {
    id: 'md-link-add',
    label: 'Insert a link',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 4,
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyH],
    isInline: true,
    syntax: '[]()',
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
