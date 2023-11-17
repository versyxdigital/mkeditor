import { IRange, languages } from 'monaco-editor/esm/vs/editor/editor.api';

export interface CompletionItem {
  label: string;
  kind: languages.CompletionItemKind.Function;
  documentation: string;
  insertText: string;
  range: IRange;
}

export interface Matcher {
  regex: RegExp;
  proposals: (range: IRange) => CompletionItem[];
}
