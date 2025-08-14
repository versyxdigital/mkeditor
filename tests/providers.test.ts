let Editor: any;
let EditorDispatcher: any;
let Settings: any;
let Completion: any;
let Bridge: any;

jest.mock('../src/browser/assets/intro', () => ({
  welcomeMarkdown: '# Welcome',
}));

beforeEach(async () => {
  document.body.innerHTML = `
    <div id="editor"></div>
    <div id="preview"></div>
    <div id="app-about"><span id="app-version"></span></div>
    <div id="app-settings"></div>
    <input id="autoindent-setting" />
    <input id="darkmode-setting" />
    <input id="wordwrap-setting" />
    <input id="whitespace-setting" />
    <input id="minimap-setting" />
    <input id="systemtheme-setting" />
    <p id="app-settings-file-info"></p>
    <label id="darkmode-icon"></label>
  `;
  ({ Editor } = await import('../src/browser/lib/Editor'));
  ({ EditorDispatcher } = await import(
    '../src/browser/events/EditorDispatcher'
  ));
  ({ Settings } = await import('../src/browser/lib/Settings'));
  ({ Completion } = await import('../src/browser/lib/Completion'));
  ({ Bridge } = await import('../src/browser/lib/Bridge'));
});

describe('Providers', () => {
  it('initialize and attach to mkeditor', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new Editor('web', dispatcher);
    mkeditor.create({ watch: false });
    const model = mkeditor.getModel();
    expect(model).not.toBeNull();

    const settings = new Settings('web', model!, dispatcher);
    const completion = new Completion(model!, dispatcher);
    mkeditor.provide('settings', settings);
    mkeditor.provide('completion', completion);

    const api = { send: jest.fn(), receive: jest.fn() };
    const bridge = new Bridge(api as any, model!, dispatcher);
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
