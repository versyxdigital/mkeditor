const create = jest.fn((element, options) => {
  return {
    getValue: jest.fn(() => options.value || ''),
    layout: jest.fn(),
    onDidChangeModelContent: jest.fn(),
    onDidScrollChange: jest.fn(),
    getVisibleRanges: jest.fn(() => [{ startLineNumber: 1, endLineNumber: 1 }]),
    updateOptions: jest.fn(),
  };
});

const setTheme = jest.fn();

const languages = {
  registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  CompletionItemKind: { Function: 0 },
};

module.exports = { editor: { create, setTheme }, languages };
