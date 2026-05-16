const create = jest.fn((element, options) => {
  return {
    getValue: jest.fn(() => options.value || ''),
    layout: jest.fn(),
    onDidChangeModelContent: jest.fn(),
    onDidScrollChange: jest.fn(),
    onKeyDown: jest.fn(),
    getVisibleRanges: jest.fn(() => [{ startLineNumber: 1, endLineNumber: 1 }]),
    updateOptions: jest.fn(),
    addAction: jest.fn(),
    focus: jest.fn(),
  };
});

const setTheme = jest.fn();

const languages = {
  registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
  CompletionItemKind: { Function: 0 },
};

// KeyMod / KeyCode constants used by editorCommands.ts.
// Values mirror the small subset Monaco actually exports — we only need
// the constants to exist so the bitwise-OR / chord builders don't crash.
const KeyMod = { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256 };
KeyMod.chord = (firstPart, secondPart) =>
  (firstPart & 0xffff) | ((secondPart & 0xffff) << 16);

const KeyCode = new Proxy(
  {},
  {
    get(_t, name) {
      if (typeof name !== 'string') return undefined;
      // Stable integer per key name — value doesn't matter so long as
      // the same name returns the same number across the run.
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
      }
      return hash;
    },
  },
);

module.exports = { editor: { create, setTheme }, languages, KeyMod, KeyCode };
