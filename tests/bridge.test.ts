let BridgeManager: any;
let EditorDispatcher: any;

describe('Bridge communication', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="editor"></div>
      <div id="preview"></div>
    `;
    ({ BridgeManager } = await import('../src/browser/core/BridgeManager'));
    ({ EditorDispatcher } =
      await import('../src/browser/events/EditorDispatcher'));
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

  it('from:theme:set routes to setOsDarkmode (no persist) even when value is false', async () => {
    // Regression for the system-theme launch bug. The previous handler
    // had `if (shouldUseDarkMode)` and only applied dark — so a user
    // with stored darkmode=true who switched the OS to light stayed
    // in dark mode until they manually toggled the setting. It also
    // called updateSetting, which would have persisted the OS value
    // to disk and overwritten their stored manual preference.
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

    // Stand-in settings provider that records both calls so we can
    // assert routing.
    const setOsDarkmode = jest.fn();
    const updateSetting = jest.fn();
    const settingsStub = {
      setOsDarkmode,
      updateSetting,
      // Methods BridgeListeners might call elsewhere — provided as
      // no-ops so the handler doesn't throw.
      setSettings: jest.fn(),
    };
    bridge.provide('settings', settingsStub);

    handlers['from:theme:set'](false);
    expect(setOsDarkmode).toHaveBeenCalledWith(false);
    expect(updateSetting).not.toHaveBeenCalled();

    handlers['from:theme:set'](true);
    expect(setOsDarkmode).toHaveBeenCalledWith(true);
    expect(updateSetting).not.toHaveBeenCalled();
  });
});
