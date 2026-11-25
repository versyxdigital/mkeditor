import { editor } from 'monaco-editor';
import { darkPalette, lightPalette } from '../../app/shared/designTokens';

/** Override editor surfaces while inheriting Monaco's language token colours. */
export function applyEditorTheme(dark: boolean): void {
  const palette = dark ? darkPalette : lightPalette;
  const name = dark ? 'mkeditor-dark' : 'mkeditor-light';
  editor.defineTheme(name, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': palette['bg-editor'],
      'editor.foreground': palette['text-primary'],
      'editorGutter.background': palette['bg-editor'],
      'editorLineNumber.foreground': palette['text-secondary'],
      'editorLineNumber.activeForeground': palette['text-primary'],
      'editorCursor.foreground': palette['accent-primary'],
      'editor.selectionBackground': palette['bg-active'],
      'editor.inactiveSelectionBackground': palette['accent-subtle'],
      'editor.lineHighlightBackground': palette['bg-editor'],
      'editor.lineHighlightBorder': palette['bg-editor'],
      'editorWidget.background': palette['bg-elevated'],
      'editorWidget.border': palette['border-default'],
      'editorSuggestWidget.background': palette['bg-elevated'],
      'editorSuggestWidget.border': palette['border-default'],
      'editorSuggestWidget.selectedBackground': palette['bg-active'],
      focusBorder: palette['accent-primary'],
      'scrollbarSlider.background': palette['text-muted'],
      'scrollbarSlider.hoverBackground': palette['text-secondary'],
      'scrollbarSlider.activeBackground': palette['accent-primary'],
    },
  });
  editor.setTheme(name);
}
