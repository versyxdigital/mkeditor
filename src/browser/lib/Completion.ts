import { IDisposable, IRange, Position, editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { CompletionItem, Matcher } from '../interfaces/Completion';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { CircularBuffer } from './Buffer';
import { completion } from '../mappings/completion';

export class Completion {

  private model: editor.IStandaloneCodeEditor;

  private dispatcher: EditorDispatcher;

  private provider: IDisposable | null;

  private buffer: CircularBuffer;

  private matchers: Record<string, Matcher>;

  constructor (model: editor.IStandaloneCodeEditor, dispatcher: EditorDispatcher) {

    this.model = model;

    this.dispatcher = dispatcher;
    
    // Use alertblocks to initalise the first completion provider. New providers will be
    // registered afterwards depending on what the user types.
    this.provider = this.registerCompletionProvider(
      completion.alertblocks.regex,
      this.alertBlockProposals
    );

    // Define matchers that will be used to match the editor value and provide
    // proposed auto-completions.
    this.matchers = {
      alertblocks: {
        regex: completion.alertblocks.regex,
        proposals: this.alertBlockProposals
      },
      codeblocks: {
        regex: completion.codeblocks.regex,
        proposals: this.codeBlockProposals
      },
    };

    // Create a new buffer instance to track the model content to match
    // against a "matchers" regex.
    this.buffer = new CircularBuffer({
      limit: 3
    });

    // Event listener to load auto-completions from elsewhere in the application
    // i.e. storage, or the bridge.
    this.dispatcher.addEventListener('editor:completion:load', (event) => {
      const key = event.message as keyof typeof this.matchers;
      this.updateCompletionProvider(key);
    });
  }

  async changeOnValidProposal (value: string) {
    // Fetch potential auto-completions proposal.
    const proposal = this.trackBufferContents(value);
    // Update the provider to provide matching auto-completions.
    if (proposal === completion.alertblocks.literal) {
      await this.updateCompletionProvider('alertblocks');
    } else if (proposal === completion.codeblocks.literal) {
      await this.updateCompletionProvider('codeblocks');
    }
  }

  async updateCompletionProvider (type: keyof typeof this.matchers) {
    // Remove the existing provider (otherwise you get duplicates).
    await this.disposeCompletionProvider();

    // Register the new provider, passing the pattern to match and proposals
    // to suggest.
    this.provider = this.registerCompletionProvider(
      this.matchers[type].regex,
      this.matchers[type].proposals
    );

    this.model.trigger('completion', 'editor.action.triggerSuggest', {});

    console.log(`Registered new completion provider for ${type}`);
  }

  async disposeCompletionProvider () {
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
      console.log('Disposed completion provider...');
    }
  }

  registerCompletionProvider (regex: RegExp, proposeAt: (range: IRange) => CompletionItem[]) {
    return languages.registerCompletionItemProvider('markdown', {
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        // Get the text within range
        const textUntilPosition = this.getTextUntilPosition(model, position);
        // Match the auto-completion trigger
        const match = textUntilPosition?.match(new RegExp(regex));
        if (! match) {
          return { suggestions: [] };
        }

        // Get the word under the position
        const word = model.getWordUntilPosition(position);

        // Propose the associated auto-completions
        return { 
          suggestions: proposeAt(this.getRange(word, position))
        };
      }
    });
  }

  trackBufferContents (value: string) {
    if (value === '\n') {
      // If the value is a newline then do nothing
      return this.buffer.get();
    }
    
    if (value === '' && this.buffer.get() !== '') {
      // if it's a backspace and the buffer is not empty then remove the last
      // value added to the buffer
      this.buffer.rewind();
    } else {
      // Add the latest value to the buffer
      this.buffer.forward(value);
    }

    // Return the buffered contents
    return this.buffer.get();
  }

  getTextUntilPosition (model: editor.ITextModel, position: Position) {
    return model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    }).split('\n').pop();
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
    const proposals: CompletionItem[] = [];
    for (const alert of completion.alertblocks.types) {
      proposals.push({
        label: `${completion.alertblocks.literal} ${alert}`,
        kind: languages.CompletionItemKind.Function,
        documentation: `${alert} alert block`,
        insertText: `${alert}\n<your text here>\n${completion.alertblocks.literal}`,
        range
      });
    }

    return proposals;
  }

  codeBlockProposals (range: IRange) {
    const proposals: CompletionItem[] = [];
    for (const lang of completion.codeblocks.types) {
      proposals.push({
        label: completion.codeblocks.literal + lang,
        kind: languages.CompletionItemKind.Function,
        documentation: `${lang} code block`,
        insertText: `${lang}\n<your code here>\n${completion.codeblocks.literal}`,
        range
      });
    }

    return proposals;
  }
}