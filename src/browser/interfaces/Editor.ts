import type { Selection, editor } from 'monaco-editor/esm/vs/editor/editor.api';

export interface EditorSettings {
  autoindent: boolean;
  darkmode: boolean;
  wordwrap: boolean;
  whitespace: boolean;
  minimap: boolean;
  systemtheme: boolean;
  scrollsync: boolean;
  locale: string;
  stateEnabled: boolean;
}

export interface ExportSettings {
  withStyles: boolean;
  container: 'container' | 'container-fluid';
  fontSize: number;
  lineSpacing: number;
  background: string;
  fontColor: string;
}

export interface SettingsFile extends EditorSettings {
  exportSettings: ExportSettings;
}

export interface EditorCommand extends Omit<editor.IActionDescriptor, 'run'> {
  isInline: boolean;
  syntax?: string;
  run?(): void | string | Selection;
}

export type ValidSetting = keyof EditorSettings;
