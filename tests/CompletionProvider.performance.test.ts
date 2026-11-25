import { languages } from 'monaco-editor';
import type { editor } from 'monaco-editor';
import { CompletionProvider } from '../src/browser/core/providers/CompletionProvider';

describe('completion provider lifecycle and large documents', () => {
  const register = languages.registerCompletionItemProvider as jest.Mock;

  beforeEach(() => {
    register.mockClear();
  });

  it('disposes every superseded registration during simultaneous provider switches', async () => {
    const completion = new CompletionProvider({
      trigger: jest.fn(),
    } as unknown as editor.IStandaloneCodeEditor);
    await Promise.all([
      completion.updateCompletionProvider('codeblocks'),
      completion.updateCompletionProvider('alertblocks'),
    ]);
    expect(register).toHaveBeenCalledTimes(3);
    const registrations = register.mock.results.map((result) => result.value);
    expect(registrations[0].dispose).toHaveBeenCalledTimes(1);
    expect(registrations[1].dispose).toHaveBeenCalledTimes(1);
    expect(registrations[2].dispose).not.toHaveBeenCalled();
    completion.dispose();
    expect(registrations[2].dispose).toHaveBeenCalledTimes(1);
  });

  it('reads only the current line instead of copying the document prefix for completion', () => {
    new CompletionProvider({
      trigger: jest.fn(),
    } as unknown as editor.IStandaloneCodeEditor);
    const provider = register.mock.calls[0][1];
    const model = {
      getValueInRange: jest.fn(() => ':::'),
      getWordUntilPosition: jest.fn(() => ({
        word: '',
        startColumn: 4,
        endColumn: 4,
      })),
    };
    const result = provider.provideCompletionItems(model, {
      lineNumber: 100000,
      column: 4,
    });
    expect(model.getValueInRange).toHaveBeenCalledWith({
      startLineNumber: 100000,
      startColumn: 1,
      endLineNumber: 100000,
      endColumn: 4,
    });
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
