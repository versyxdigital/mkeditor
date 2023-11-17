import { IDisposable, IRange, Position, editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { CompletionItem, Matcher } from '../interfaces/Completion';
import { EditorDispatcher } from '../events/EditorDispatcher';

export class Completion
{
  private dispatcher: EditorDispatcher;

  private provider: IDisposable | null;

  private matchers: Record<string, Matcher> = {};

  constructor (dispatcher: EditorDispatcher) {
    // TODO use the dispatcher to update registered completion provider on-the-fly
    this.dispatcher = dispatcher;
    
    // Use alertblocks to initalise the first completion provider. New providers will be registered
    // afterwards depending on what the user types.
    this.provider = this.registerCompletionProvider(
      new RegExp(/^:::\s/m),
      this.alertBlockProposals
    );

    this.matchers = {
      alertblocks: {
        regex: new RegExp(/^:::\s/m),
        proposals: this.alertBlockProposals
      },
      codeblocks: {
        regex: new RegExp(/^```\s/m),
        proposals: this.codeBlockProposals
      },
    };

    this.dispatcher.addEventListener('editor:completions:load', (event) => {
      const key = event.message as keyof typeof this.matchers;
      this.updateCompletionProvider(key);
    });
  }

  async disposeCompletionProvider () {
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
    }
  }

  async updateCompletionProvider (type: keyof typeof this.matchers) {
    if (this.provider) {
      await this.disposeCompletionProvider();
    }

    this.registerCompletionProvider(
      this.matchers[type].regex,
      this.matchers[type].proposals
    );
  }

  registerCompletionProvider (regex: RegExp, proposeAt: (range: IRange) => CompletionItem[]) {
    return languages.registerCompletionItemProvider('markdown', {
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