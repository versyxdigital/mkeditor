import type { EditorSettings, ExportSettings } from './interfaces/Editor';

export const config = {};

export const settings: EditorSettings = {
  autoindent: false,
  darkmode: false,
  wordwrap: true,
  whitespace: false,
  minimap: true,
  systemtheme: true,
};

export const exportSettings: ExportSettings = {
  withStyles: true,
  container: 'container-fluid',
  fontSize: 16,
  lineSpacing: 1.5,
  background: '#ffffff',
  fontColor: '#212529',
};
