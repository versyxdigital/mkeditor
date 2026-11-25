import { SettingsProvider } from '../src/browser/core/providers/SettingsProvider';
import { ExportSettingsProvider } from '../src/browser/core/providers/ExportSettingsProvider';
import { settings, exportSettings } from '../src/browser/config';
import type { editor } from 'monaco-editor';

const makeEditor = () =>
  ({ updateOptions: jest.fn() }) as unknown as editor.IStandaloneCodeEditor;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="preview-content"></div>';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('settings storage resilience', () => {
  it('flushes pending export preferences before the debounce during shutdown', () => {
    jest.useFakeTimers();
    const provider = new ExportSettingsProvider('desktop');
    const persist = jest.fn();
    provider.setPersistHandler(persist);
    provider.updateSetting('fontSize', 28);
    provider.flushPersist();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      exportSettings: expect.objectContaining({ fontSize: 28 }),
    });
    jest.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('loads both providers when browser storage is blocked', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const editorSettings = new SettingsProvider('web', makeEditor());
    const exports = new ExportSettingsProvider('web');
    expect(editorSettings.getSetting('wordwrap')).toBe(settings.wordwrap);
    expect(exports.getSettings()).toEqual(exportSettings);
    expect(() => editorSettings.updateSetting('wordwrap', false)).not.toThrow();
    expect(editorSettings.getSnapshot().wordwrap).toBe(false);
  });

  it('repairs missing nested settings and invalid primitive types', () => {
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify({
        wordwrap: false,
        minimap: 'false',
        locale: 12,
        fileExplorer: {},
        pasteImages: null,
      }),
    );
    const provider = new SettingsProvider('web', makeEditor());
    expect(provider.getSetting('wordwrap')).toBe(false);
    expect(provider.getSetting('minimap')).toBe(settings.minimap);
    expect(provider.getSetting('locale')).toBe(settings.locale);
    expect(provider.getSetting('fileExplorer')).toEqual(settings.fileExplorer);
    expect(provider.getSetting('pasteImages')).toEqual(settings.pasteImages);
  });

  it('does not let one provider or a default-settings caller mutate shared nested defaults', () => {
    const first = new SettingsProvider('desktop', makeEditor());
    first.getSettings().fileExplorer.extensions.push('pdf');
    first.getDefaultSettings().pasteImages.directory = 'other';
    const second = new SettingsProvider('desktop', makeEditor());
    expect(second.getSetting('fileExplorer').extensions).toEqual(['md']);
    expect(second.getSetting('pasteImages').directory).toBe('./assets');
  });

  it.each([
    'null',
    '[]',
    '42',
    '{"fontSize":22}',
    '{"fontSize":null,"lineSpacing":0}',
  ])('repairs invalid or incomplete export preferences %s', (stored) => {
    localStorage.setItem('mkeditor-export-settings', stored);
    const provider = new ExportSettingsProvider('web');
    expect(provider.getSnapshot().lineSpacing).toBe(exportSettings.lineSpacing);
    expect(provider.getSnapshot().fontSize).toBe(
      stored === '{"fontSize":22}' ? 22 : exportSettings.fontSize,
    );
  });

  it('does not require preview DOM during provider construction', () => {
    document.body.innerHTML = '';
    expect(() => new ExportSettingsProvider('desktop')).not.toThrow();
  });

  it('can retry a debounced export write after quota failure without losing in-memory preferences', () => {
    jest.useFakeTimers();
    const provider = new ExportSettingsProvider('web');
    const write = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('quota');
      });
    provider.updateSetting('fontSize', 24);
    expect(() => jest.advanceTimersByTime(250)).not.toThrow();
    expect(provider.getSnapshot().fontSize).toBe(24);
    provider.updateSetting('fontSize', 24);
    jest.advanceTimersByTime(250);
    expect(write).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(localStorage.getItem('mkeditor-export-settings')!).fontSize,
    ).toBe(24);
  });

  it('does not dedupe a desktop export write that had no persist handler', () => {
    jest.useFakeTimers();
    const provider = new ExportSettingsProvider('desktop');
    provider.updateSetting('fontSize', 24);
    jest.advanceTimersByTime(250);
    const persist = jest.fn();
    provider.setPersistHandler(persist);
    provider.updateSetting('fontSize', 24);
    jest.advanceTimersByTime(250);
    expect(persist).toHaveBeenCalledWith({
      exportSettings: expect.objectContaining({ fontSize: 24 }),
    });
  });
});
