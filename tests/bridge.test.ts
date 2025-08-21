let BridgeManager: any;
let EditorDispatcher: any;

describe('Bridge communication', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="editor"></div>
      <div id="preview"></div>
      <div id="app-about"><span id="app-version"></span></div>
    `;
    ({ BridgeManager } = await import('../src/browser/lib/BridgeManager'));
    ({ EditorDispatcher } = await import(
      '../src/browser/events/EditorDispatcher'
    ));
  });

  it('registers and communicates over bridge', () => {
    const handlers: Record<string, Function> = {};
    const api = {
      send: jest.fn(),
      receive: jest.fn((channel: string, fn: Function) => {
        handlers[channel] = fn;
      }),
    };

    const model = {
      getValue: jest.fn(() => 'content'),
      onDidChangeModelContent: jest.fn(),
      onDidScrollChange: jest.fn(),
      getVisibleRanges: jest.fn(() => [
        { startLineNumber: 1, endLineNumber: 1 },
      ]),
    } as any;

    const dispatcher = new EditorDispatcher();
    const bridge = new BridgeManager(api as any, model, dispatcher);

    expect(api.receive).toHaveBeenCalledWith(
      'from:theme:set',
      expect.any(Function),
    );
    expect(api.receive).toHaveBeenCalledWith(
      'from:settings:set',
      expect.any(Function),
    );
    expect(api.receive).toHaveBeenCalledWith(
      'from:file:new',
      expect.any(Function),
    );
    expect(api.receive).toHaveBeenCalledWith(
      'from:file:save',
      expect.any(Function),
    );

    handlers['from:file:new']('to:file:new');
    expect(api.send).toHaveBeenCalledWith('to:file:new', {
      content: 'content',
      file: null,
    });
  });
});
