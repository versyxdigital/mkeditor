import { Selection, editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { Bridge } from '../lib/Bridge';
import { Command } from '../lib/Command';
import { Settings } from '../lib/Settings';

export interface EditorSettings {
  autoindent: boolean;
  darkmode: boolean;
  wordwrap: boolean;
  whitespace: boolean;
  minimap: boolean;
}

export interface EditorProviders {
  bridge: Bridge|null;
  command: Command|null;
  settings: Settings|null;
  [key: string]: unknown | null;
}

export interface EditorCommand extends Omit<editor.IActionDescriptor, 'run'> {
  isInline: boolean;
  syntax?: string;
  run?(): void | string | Selection;
}