import { IDisposable, IRange, Position, editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { CompletionItem, Matcher } from '../interfaces/Completion';
import { EditorDispatcher } from '../events/EditorDispatcher';

export class Completion {

  private dispatcher: EditorDispatcher;

  private provider: IDisposable | null;

  private matchers: Record<string, Matcher> = {};

  public modelTrackValues: Array<string> = [];

  constructor (dispatcher: EditorDispatcher) {

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
        regex: new RegExp(/\u0060\u0060\u0060/),
        proposals: this.codeBlockProposals
      },
    };

    this.dispatcher.addEventListener('editor:completion:load', (event) => {
      const key = event.message as keyof typeof this.matchers;
      this.updateCompletionProvider(key);
    });
  }

  changeOnValidProposal (value: string) {
    const availableProposal = this.trackValuesUntilProposalAvailable(value);
    if (availableProposal === '```') {
      this.updateCompletionProvider('codeblocks');
    } else if (availableProposal === ':::') {
      this.updateCompletionProvider('alertblocks');
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

  async disposeCompletionProvider () {
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
    }
  }

  registerCompletionProvider (regex: RegExp, proposeAt: (range: IRange) => CompletionItem[]) {
    console.log(this);
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

  trackValuesUntilProposalAvailable (value: string) {
    if (this.modelTrackValues.length > 5) {
      this.modelTrackValues = [];
    }

    if (value === '') {
      this.modelTrackValues.pop();
    } else {
      this.modelTrackValues.push(value);
    }

    return this.modelTrackValues.slice(
      Math.max(this.modelTrackValues.length - 3, 1)
    ).join('');
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
        label: '``` '+lang,
        kind: languages.CompletionItemKind.Function,
        documentation: `${lang} code block`,
        insertText: lang+'\n<your code here>\n```',
        range
      });
    }

    return proposals;
  }
}