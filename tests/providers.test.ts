let BridgeManager: any;
let EditorManager: any;
let EditorDispatcher: any;
let SettingsProvider: any;
let CompletionProvider: any;

jest.mock('../src/browser/assets/intro', () => ({
  welcomeMarkdown: '# Welcome',
}));

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="editor"></div>
    <div id="preview"><div id="preview-content" class="container-fluid"></div></div>
  `;
  ({ EditorManager } = await import('../src/browser/core/EditorManager'));
  ({ EditorDispatcher } =
    await import('../src/browser/events/EditorDispatcher'));
  ({ SettingsProvider } =
    await import('../src/browser/core/providers/SettingsProvider'));
  ({ CompletionProvider } =
    await import('../src/browser/core/providers/CompletionProvider'));
  ({ BridgeManager } = await import('../src/browser/core/BridgeManager'));
});

describe('Providers', () => {
  it('initialize and attach to mkeditor', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const model = mkeditor.getMkEditor();
    expect(model).not.toBeNull();

    const settings = new SettingsProvider('web', model!);
    const completion = new CompletionProvider(model!, dispatcher);
    mkeditor.provide('settings', settings);
    mkeditor.provide('completion', completion);

    const api = { send: jest.fn(), receive: jest.fn() };
    const bridge = new BridgeManager(api as any, model!, dispatcher);
    bridge.provide('settings', settings);
    bridge.provide('completion', completion);
    mkeditor.provide('bridge', bridge);

    expect(mkeditor.providers.settings).toBe(settings);
    expect(mkeditor.providers.completion).toBe(completion);
    expect(mkeditor.providers.bridge).toBe(bridge);
    expect(bridge.providers.settings).toBe(settings);
    expect(bridge.providers.completion).toBe(completion);
  });
});

describe('SettingsProvider.loadSettingsFromLocalStorage (web)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fills in missing keys from defaults and persists the upgraded shape', () => {
    // Simulate a pre-v3.8 stored settings blob with no sessionRestore.
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        autoindent: true,
        darkmode: false,
        wordwrap: false,
        whitespace: true,
        minimap: false,
        systemtheme: false,
        scrollsync: true,
        locale: 'en',
      }),
    );

    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const provider = new SettingsProvider('web', mkeditor.getMkEditor()!);

    // The user's explicit choices win, but `sessionRestore` falls back
    // to its default (true) instead of being undefined.
    expect(provider.getSetting('autoindent')).toBe(true);
    expect(provider.getSetting('wordwrap')).toBe(false);
    expect(provider.getSetting('sessionRestore')).toBe(true);

    // The merged shape was persisted back so subsequent loads are
    // consistent (sessionRestore now present in storage).
    const upgraded = JSON.parse(
      localStorage.getItem('mkeditor-settings') as string,
    );
    expect(upgraded.sessionRestore).toBe(true);
    expect(upgraded.autoindent).toBe(true);
  });

  it('skips re-persisting when stored already has every key', () => {
    const full = {
      autoindent: false,
      darkmode: false,
      wordwrap: true,
      whitespace: false,
      minimap: true,
      systemtheme: false,
      scrollsync: true,
      sessionRestore: false,
      locale: 'en',
    };
    localStorage.setItem('mkeditor-settings', JSON.stringify(full));

    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    new SettingsProvider('web', mkeditor.getMkEditor()!);

    // No upgrade-persist write should have fired.
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('falls back to defaults on corrupted stored value', () => {
    localStorage.setItem('mkeditor-settings', '"just a string"');

    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const provider = new SettingsProvider('web', mkeditor.getMkEditor()!);

    expect(provider.getSetting('sessionRestore')).toBe(true);
    expect(provider.getSetting('wordwrap')).toBe(true);
  });
});
