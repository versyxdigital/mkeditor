import type { EditorSettings, ExportSettings } from './interfaces/Editor';
import { normalizeLanguage } from './i18n';
import { documentDefaults } from '../app/shared/designTokens';

export const config = {};

export const settings: EditorSettings = {
  autoindent: false,
  darkmode: false,
  wordwrap: true,
  whitespace: false,
  minimap: true,
  systemtheme: true,
  scrollsync: true,
  sessionRestore: true,
  assistantAutoOpenFiles: true,
  editorVisible: true,
  locale: normalizeLanguage(navigator.language),
  fileExplorer: { extensions: ['md'] },
  pasteImages: { directory: './assets' },
};

export const exportSettings: ExportSettings = {
  withStyles: true,
  container: 'container',
  ...documentDefaults,
};
