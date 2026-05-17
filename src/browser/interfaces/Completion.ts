import type { IRange, languages } from 'monaco-editor';

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
