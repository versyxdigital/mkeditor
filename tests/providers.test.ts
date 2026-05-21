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
    // `fileExplorer` is a newer field — pre-existing settings get the
    // markdown-only default rather than `undefined`, so the React
    // filter bar doesn't crash trying to read `extensions` off undef.
    expect(provider.getSetting('fileExplorer')).toEqual({
      extensions: ['md'],
    });

    // The merged shape was persisted back so subsequent loads are
    // consistent (sessionRestore now present in storage).
    const upgraded = JSON.parse(
      localStorage.getItem('mkeditor-settings') as string,
    );
    expect(upgraded.sessionRestore).toBe(true);
    expect(upgraded.autoindent).toBe(true);
    expect(upgraded.fileExplorer).toEqual({ extensions: ['md'] });
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
      fileExplorer: { extensions: ['md'] },
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

describe('SettingsProvider system-theme tracking', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads OS darkmode separately from the stored manual preference', () => {
    // User's manual preference (would normally be applied when
    // systemtheme is off). Stored on disk; should never be touched by
    // OS-theme pushes.
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        autoindent: false,
        darkmode: true,
        wordwrap: true,
        whitespace: false,
        minimap: true,
        systemtheme: true,
        scrollsync: true,
        sessionRestore: true,
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

    // Stored preference reads as `true` (dark).
    expect(provider.getSetting('darkmode')).toBe(true);
    // OS hasn't reported yet.
    expect(provider.getOsDarkmode()).toBeNull();

    // OS reports light. Should NOT clobber the stored preference.
    provider.setOsDarkmode(false);
    expect(provider.getOsDarkmode()).toBe(false);
    expect(provider.getSetting('darkmode')).toBe(true);

    // Document body reflects effective (OS) theme, not stored.
    expect(document.body.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to stored darkmode when systemtheme is off', () => {
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        autoindent: false,
        darkmode: true,
        wordwrap: true,
        whitespace: false,
        minimap: true,
        systemtheme: false,
        scrollsync: true,
        sessionRestore: true,
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

    // OS push lands but systemtheme is off — stored preference wins.
    provider.setOsDarkmode(false);
    expect(document.body.getAttribute('data-theme')).toBe('dark');
    expect(provider.getSetting('darkmode')).toBe(true);
  });

  it('flips the rendered theme when systemtheme is toggled, preserving stored darkmode', () => {
    // Regression for the launch bug: stored darkmode=true, OS is
    // light. The user toggles systemtheme on while the app is open —
    // the rendered theme must follow the OS without overwriting the
    // stored preference.
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        autoindent: false,
        darkmode: true,
        wordwrap: true,
        whitespace: false,
        minimap: true,
        systemtheme: false,
        scrollsync: true,
        sessionRestore: true,
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

    // OS push lands first (boot order).
    provider.setOsDarkmode(false);
    // systemtheme off → stored wins → dark.
    expect(document.body.getAttribute('data-theme')).toBe('dark');

    // Toggle systemtheme on — rendered theme flips to OS (light).
    provider.updateSetting('systemtheme', true);
    expect(document.body.getAttribute('data-theme')).toBe('light');

    // Stored darkmode preserved.
    expect(provider.getSetting('darkmode')).toBe(true);

    // Toggle systemtheme back off — rendered theme restores to stored
    // (dark). This is the "preserve manual preference" semantic.
    provider.updateSetting('systemtheme', false);
    expect(document.body.getAttribute('data-theme')).toBe('dark');
  });

  it('setOsDarkmode is a silent cache when systemtheme is off (no emit)', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const provider = new SettingsProvider('web', mkeditor.getMkEditor()!);
    // default systemtheme is true — flip to false so emit shouldn't fire.
    provider.updateSetting('systemtheme', false);

    const listener = jest.fn();
    provider.subscribe(listener);

    // OS push with systemtheme off: cache updates silently, no emit.
    provider.setOsDarkmode(true);
    expect(provider.getOsDarkmode()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setOsDarkmode emits when systemtheme is on (so React subscribers re-render)', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });
    const provider = new SettingsProvider('web', mkeditor.getMkEditor()!);
    // systemtheme is true by default.

    const listener = jest.fn();
    provider.subscribe(listener);

    provider.setOsDarkmode(true);
    expect(listener).toHaveBeenCalled();
  });

  it('snapshot exposes effectiveDarkmode for UI consumers that visualise the rendered theme', () => {
    // The bottom-toolbar moon icon needs to show the rendered theme
    // (which may differ from `settings.darkmode` while systemtheme is
    // on and the OS doesn't match the stored preference). The
    // snapshot carries `effectiveDarkmode` so consumers don't need to
    // re-derive it.
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        autoindent: false,
        darkmode: true,
        wordwrap: true,
        whitespace: false,
        minimap: true,
        systemtheme: true,
        scrollsync: true,
        sessionRestore: true,
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
    // Stored is dark; OS hasn't reported → fallback to stored.
    expect(provider.getSnapshot().darkmode).toBe(true);
    expect(provider.getSnapshot().effectiveDarkmode).toBe(true);

    // OS reports light. Stored stays dark; effective flips.
    provider.setOsDarkmode(false);
    expect(provider.getSnapshot().darkmode).toBe(true);
    expect(provider.getSnapshot().effectiveDarkmode).toBe(false);
  });
});
