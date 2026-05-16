import { KeyMod, KeyCode } from 'monaco-editor';
import type { EditorCommand } from '../../interfaces/Editor';

/**
 * Editor block mappings.
 *
 * - `type` is the lowercase identifier passed to
 *   `CommandProvider.alert/codeblock` (e.g. "primary", "csharp").
 * - `key` is the second-stage chord letter for the Monaco keybinding
 *   (Ctrl+L → key for alerts, Ctrl+K → key for codeblocks).
 * - `label` (optional) is the human-readable display name shown in the
 *   <EditorToolbar> dropdown. Defaults to `type` when omitted. The
 *   first character of `label` matching `key` (case-insensitive) is
 *   underlined in the React dropdown via `highlightChord()`.
 */
export interface BlockMapping {
  type: string;
  key: string;
  label?: string;
}

export const alertblocks: BlockMapping[] = [
  { type: 'Primary', key: 'P' },
  { type: 'Secondary', key: 'E' },
  { type: 'Info', key: 'I', label: 'Information' },
  { type: 'Success', key: 'S' },
  { type: 'Warning', key: 'W' },
  { type: 'Danger', key: 'D' },
  { type: 'Light', key: 'L' },
  { type: 'Dark', key: 'R' },
];

export const codeblocks: BlockMapping[] = [
  { type: 'Sh', key: 'S', label: 'Shell' },
  { type: 'Javascript', key: 'J' },
  { type: 'Typescript', key: 'T' },
  { type: 'CSharp', key: 'C', label: 'C' },
  { type: 'PHP', key: 'P' },
  { type: 'Python', key: 'Y' },
  { type: 'Rust', key: 'R' },
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
