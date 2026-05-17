/**
 * Pure-data block mappings consumed by both `<EditorToolbar>` (which
 * renders the alert/code dropdowns) and `CommandProvider` (which
 * registers the chord keybindings). Kept in this file — separate from
 * `editorCommands.ts` — so the React toolbar can import the data
 * without transitively pulling `monaco-editor`'s `KeyMod` / `KeyCode`
 * (and the rest of the Monaco bundle) into the main entry chunk.
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
