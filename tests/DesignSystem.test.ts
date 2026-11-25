import { editor } from 'monaco-editor';
import {
  lightPalette,
  darkPalette,
  type ThemePalette,
} from '../src/app/shared/designTokens';
import { applyEditorTheme } from '../src/browser/core/editorTheme';
import { SettingsProvider } from '../src/browser/core/providers/SettingsProvider';
import { ExportSettingsProvider } from '../src/browser/core/providers/ExportSettingsProvider';
import { fade } from '../src/browser/splash';
import { designSystemStylesheet } from '../src/browser/designSystem';

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

it('reserves accent-foreground for hover text rather than filled-button labels', () => {
  expect(designSystemStylesheet).not.toContain('--accent-foreground:');
  expect(designSystemStylesheet).toContain('--text-on-accent:');
});

describe.each([
  ['light', lightPalette],
  ['dark', darkPalette],
] as const)('%s design system', (name, palette: ThemePalette) => {
  it('keeps normal text, links, button labels and control boundaries readable', () => {
    for (const surface of [
      'bg-app',
      'bg-sidebar',
      'bg-editor',
      'bg-elevated',
      'bg-active',
    ] as const) {
      expect(
        contrast(palette['text-primary'], palette[surface]),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(palette['text-secondary'], palette[surface]),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(palette['accent-primary'], palette['bg-preview']),
    ).toBeGreaterThanOrEqual(4.5);
    expect(palette['text-on-accent']).toBe('#FFFFFF');
    for (const fill of ['accent-fill', 'accent-fill-hover'] as const) {
      expect(
        contrast(palette[fill], palette['text-on-accent']),
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of ['bg-app', 'bg-sidebar', 'bg-elevated'] as const) {
      expect(
        contrast(palette['border-control'], palette[surface]),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('themes Monaco surfaces while inheriting language highlighting', () => {
    applyEditorTheme(name === 'dark');
    expect(editor.defineTheme).toHaveBeenCalledWith(
      `mkeditor-${name}`,
      expect.objectContaining({
        base: name === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [],
        colors: expect.objectContaining({
          'editor.background': palette['bg-editor'],
          'editorCursor.foreground': palette['accent-primary'],
        }),
      }),
    );
    expect(editor.setTheme).toHaveBeenCalledWith(`mkeditor-${name}`);
    const applied = (editor.defineTheme as jest.Mock).mock.calls.at(-1)![1];
    expect(
      contrast(
        applied.colors['editorLineNumber.foreground'],
        palette['bg-editor'],
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(
        applied.colors['scrollbarSlider.background'],
        palette['bg-editor'],
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});

it('preserves saved appearance choices and the system-theme override', () => {
  localStorage.setItem(
    'mkeditor-export-settings',
    JSON.stringify({
      fontSize: 22,
      lineSpacing: 1.25,
      container: 'container-fluid',
      background: '#ffeedd',
      fontColor: '#334455',
      withStyles: false,
    }),
  );
  const exports = new ExportSettingsProvider('web');
  expect(exports.getSettings()).toEqual({
    fontSize: 22,
    lineSpacing: 1.25,
    container: 'container-fluid',
    background: '#ffeedd',
    fontColor: '#334455',
    withStyles: false,
  });
  const settings = new SettingsProvider('desktop', {
    updateOptions: jest.fn(),
  } as never);
  settings.updateSetting('darkmode', false);
  settings.setOsDarkmode(true);
  expect(editor.setTheme).toHaveBeenLastCalledWith('mkeditor-dark');
  settings.updateSetting('systemtheme', false);
  expect(editor.setTheme).toHaveBeenLastCalledWith('mkeditor-light');
});

it('reveals the interface immediately when reduced motion is requested', () => {
  const original = window.matchMedia;
  window.matchMedia = jest.fn(() => ({ matches: true })) as never;
  try {
    const target = document.createElement('div');
    const callback = jest.fn();
    fade(target, 'out', 500, callback);
    expect(target.style.display).toBe('none');
    expect(callback).toHaveBeenCalledTimes(1);
    fade(target, 'in', 500);
    expect(target.style.display).toBe('');
    expect(target.style.opacity).toBe('1');
  } finally {
    window.matchMedia = original;
  }
});
