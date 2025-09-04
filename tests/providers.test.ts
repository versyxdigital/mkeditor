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
    <div id="app-about"><span id="app-version"></span></div>
    <div id="app-settings"></div>
    <input id="autoindent-setting" />
    <input id="darkmode-setting" />
    <input id="wordwrap-setting" />
    <input id="whitespace-setting" />
    <input id="minimap-setting" />
    <input id="systemtheme-setting" />
    <input id="scrollsync-setting" />
    <input id="recent-items-enabled-setting" />
    <select id="locale-setting" /></select>
    <p id="app-settings-file-info"></p>
    <label id="darkmode-icon"></label>
    <span id="app-build-id"></span>
  `;
  ({ EditorManager } = await import('../src/browser/core/EditorManager'));
  ({ EditorDispatcher } = await import(
    '../src/browser/events/EditorDispatcher'
  ));
  ({ SettingsProvider } = await import(
    '../src/browser/core/providers/SettingsProvider'
  ));
  ({ CompletionProvider } = await import(
    '../src/browser/core/providers/CompletionProvider'
  ));
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

    const settings = new SettingsProvider('web', model!, dispatcher);
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
