import type { Selection, editor } from 'monaco-editor/esm/vs/editor/editor.api';

export interface EditorSettings {
  autoindent: boolean;
  darkmode: boolean;
  wordwrap: boolean;
  whitespace: boolean;
  minimap: boolean;
  systemtheme: boolean;
}
export interface EditorCommand extends Omit<editor.IActionDescriptor, 'run'> {
  isInline: boolean;
  syntax?: string;
  run?(): void | string | Selection;
}

export type ValidSetting = keyof EditorSettings;
