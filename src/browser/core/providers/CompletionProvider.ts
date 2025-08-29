import {
  type IDisposable,
  type IRange,
  type Position,
  type editor,
  languages,
} from 'monaco-editor/esm/vs/editor/editor.api';
import { CircularBuffer } from 'circle-buffer';
import type { CompletionItem, Matcher } from '../../interfaces/Completion';
import { autoCompleteFencedConfig } from '../completion/fencedBlocks';
import { autoContinueListMarkers } from '../completion/listMarkers';
import { logger } from '../../util';

export class CompletionProvider {
  /** Editor instance */
  private mkeditor: editor.IStandaloneCodeEditor;

  /** Disposable completion provider */
  private provider: IDisposable | null;

  /** Buffer to track a fixed-size state of the editor */
  private buffer: CircularBuffer;

  /** Completion provider matching criteria */
  private matchers: Record<string, Matcher>;

  /** Flag to gate auto list continuation logic */
  public shouldHandleEnterList = false;

  /** Guard to prevent recursive content-change handling */
  public isAutoListInProgress = false;

  /**
   * Create a new mkeditor completion provider.
   *
   * Responsible for creating a completion provider and providing completion
   * auto-suggestions.
   *
   * @param mkeditor - the editor instance
   */
  public constructor(mkeditor: editor.IStandaloneCodeEditor) {
    this.mkeditor = mkeditor;

    // Use alertblocks to initalise the first completion provider. New providers will be
    // registered afterwards depending on what the user types.
    this.provider = this.registerCompletionProvider(
      autoCompleteFencedConfig.alertblocks.regex,
      this.alertBlockProposals,
    );

    // Define matchers that will be used to match the editor value and provide
    // proposed auto-completions.
    this.matchers = {
      alertblocks: {
        regex: autoCompleteFencedConfig.alertblocks.regex,
        proposals: this.alertBlockProposals,
      },
      codeblocks: {
        regex: autoCompleteFencedConfig.codeblocks.regex,
        proposals: this.codeBlockProposals,
      },
    };

    // Create a new buffer instance to track the model content to match
    // against a "matchers" regex.
    this.buffer = new CircularBuffer({
      limit: 3,
    });
  }

  /**
   * Auto-continue list-markers.
   *
   * @param event - the model content change event
   */
  public autoContinueListMarkers(changes: editor.IModelContentChange[]) {
    // Auto-continue list markers when Enter was pressed
    if (
      this.shouldHandleEnterList &&
      !this.isAutoListInProgress &&
      changes.some((c) => c.text.includes('\n'))
    ) {
      this.isAutoListInProgress = true;
      try {
        autoContinueListMarkers(this.mkeditor);
      } catch (err) {
        logger?.error(
          'CompletionProvider.autoContinueListMarkers',
          JSON.stringify(err),
        );
      } finally {
        this.shouldHandleEnterList = false;
        this.isAutoListInProgress = false;
      }
    }
  }

  /**
   * Change the providre when a valid completion proposal is detected.
   *
   * @param value - tracking value to detect
   */
  public async suggestOnValidInput(value: string) {
    // Fetch potential auto-completions proposal.
    const proposal = this.trackBufferContents(value);
    // Update the provider to provide matching auto-completions.
    if (proposal === autoCompleteFencedConfig.alertblocks.literal) {
      await this.updateCompletionProvider('alertblocks');
    } else if (proposal === autoCompleteFencedConfig.codeblocks.literal) {
      await this.updateCompletionProvider('codeblocks');
    }
  }

  /**
   * Update the completion provider.
   *
   * @param type - the type of provider for the matching criteria
   */
  public async updateCompletionProvider(type: keyof typeof this.matchers) {
    try {
      // Remove the existing provider (otherwise you get duplicates).
      await this.disposeCompletionProvider();

      // Register the new provider, passing the pattern to match and proposals
      // to suggest.
      this.provider = this.registerCompletionProvider(
        this.matchers[type].regex,
        this.matchers[type].proposals,
      );

      this.mkeditor.trigger('completion', 'editor.action.triggerSuggest', {});
    } catch {
      logger?.error(
        'CompletionProvider.updateCompletionProvider',
        `Failed to update completion provider for type: ${type}`,
      );
    }
  }

  /**
   * Dispose the current completion provider.
   */
  private async disposeCompletionProvider() {
    this.provider?.dispose();
    this.provider = null;
  }

  /**
   * Register a completion provider against the model instance.
   *
   * @param regex - the matching regex
   * @param proposeAt - the range to propose for insertion
   * @returns
   */
  private registerCompletionProvider(
    regex: RegExp,
    proposeAt: (range: IRange) => CompletionItem[],
  ) {
    return languages.registerCompletionItemProvider('markdown', {
      provideCompletionItems: (
        model: editor.ITextModel,
        position: Position,
      ) => {
        // Get the text within range
        const textUntilPosition = this.getTextUntilPosition(model, position);
        // Match the auto-completion trigger
        const match = textUntilPosition?.match(new RegExp(regex));
        if (!match) {
          return { suggestions: [] };
        }

        // Get the word under the position
        const word = model.getWordUntilPosition(position);

        // Propose the associated auto-completions
        return {
          suggestions: proposeAt(this.getRange(word, position)),
        };
      },
    });
  }

  /**
   * Track values in the buffer.
   *
   * @param value - the value to track
   * @returns
   */
  private trackBufferContents(value: string) {
    if (value === '\n') {
      // If the value is a newline then do nothing
      return this.buffer.current();
    }

    if (value === '' && this.buffer.current() !== '') {
      // if it's a backspace and the buffer is not empty then remove the last
      // value added to the buffer
      this.buffer.rewind();
    } else {
      // Add the latest value to the buffer
      this.buffer.forward(value);
    }

    // Return the current buffer contents
    return this.buffer.current();
  }

  /**
   * Get editor text until the specified position is reached.
   *
   * @param model - the editor model instance
   * @param position - the specified position
   * @returns
   */
  private getTextUntilPosition(model: editor.ITextModel, position: Position) {
    return model
      .getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      .split('\n')
      .pop();
  }

  /**
   * Get the range for the completion.
   *
   * @param word - the word at the position
   * @param position - the position
   * @returns
   */
  private getRange(word: editor.IWordAtPosition, position: Position): IRange {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
  }

  /**
   * Create a new alert block completion proposal.
   *
   * @param range - the editor range for completion
   * @returns
   */
  private alertBlockProposals(range: IRange) {
    const proposals: CompletionItem[] = [];
    for (const alert of autoCompleteFencedConfig.alertblocks.types) {
      proposals.push({
        label: `${autoCompleteFencedConfig.alertblocks.literal} ${alert}`,
        kind: languages.CompletionItemKind.Function,
        documentation: `${alert} alert block`,
        insertText: `${alert}\n<your text here>\n${autoCompleteFencedConfig.alertblocks.literal}`,
        range,
      });
    }

    return proposals;
  }

  /**
   * Create a new code block completion proposal.
   *
   * @param range - the editor range for completion
   * @returns
   */
  private codeBlockProposals(range: IRange) {
    const proposals: CompletionItem[] = [];
    for (const lang of autoCompleteFencedConfig.codeblocks.types) {
      proposals.push({
        label: autoCompleteFencedConfig.codeblocks.literal + lang,
        kind: languages.CompletionItemKind.Function,
        documentation: `${lang} code block`,
        insertText: `${lang}\n<your code here>\n${autoCompleteFencedConfig.codeblocks.literal}`,
        range,
      });
    }

    return proposals;
  }
}
