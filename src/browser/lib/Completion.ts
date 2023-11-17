import { IRange, Position, editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorDispatcher } from '../events/EditorDispatcher';

interface CompletionItem {
  label: string;
  kind: languages.CompletionItemKind.Function;
  documentation: string;
  insertText: string;
  range: IRange;
}

export class Completion
{
  private dispatcher: EditorDispatcher;

  constructor (dispatcher: EditorDispatcher) {
    this.dispatcher = dispatcher; // TODO use the dispatcher to update registered completion provider on-the-fly
    
    this.registerCompletionProvider(new RegExp(/^:::\s/m), this.alertBlockProposals);
  }

  registerCompletionProvider(regex: RegExp, proposeAt: (range: IRange) => CompletionItem[]) {
    languages.registerCompletionItemProvider('markdown', {
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        const textUntilPosition = this.getTextUntilPosition(model, position);
        const match = textUntilPosition.match(regex);
        
        if (! match) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);

        return { 
          suggestions: proposeAt(this.getRange(word, position))
        };
      }
    });
  }

  getTextUntilPosition (model: editor.ITextModel, position: Position) {
    return model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    });
  }

  getRange (word: editor.IWordAtPosition, position: Position): IRange {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
  }

  alertBlockProposals (range: IRange) {
    const alerts = [
      'success',
      'info',
      'warning',
      'danger',
      'primary',
      'secondary',
      'light',
      'dark'
    ];

    const proposals: CompletionItem[] = [];
    for (const alert of alerts) {
      proposals.push({
        label: `::: ${alert}`,
        kind: languages.CompletionItemKind.Function,
        documentation: `${alert} alertblock`,
        insertText: `${alert}\n<your text here>\n:::`,
        range
      });
    }

    return proposals;
  }

  codeBlockProposals (range: IRange) {
    const langs = [
      'json',
      'javascript',
      'typescript',
      'csharp',
      'php',
      'sql',
      'shell',
      'xml'
    ];

    const proposals: CompletionItem[] = [];
    for (const lang of langs) {
      proposals.push({
        label: '"``` '+lang+'"',
        kind: languages.CompletionItemKind.Function,
        documentation: `${lang} code block`,
        insertText: lang+'\n<your code here>\n```',
        range
      });
    }

    return proposals;
  }
}