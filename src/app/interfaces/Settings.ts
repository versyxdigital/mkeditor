export interface EditorSettings {
  autoindent: boolean;
  darkmode: boolean;
  wordwrap: boolean;
  whitespace: boolean;
  minimap: boolean;
  systemtheme: boolean;
  scrollsync: boolean;
}

export interface ExportSettings {
  withStyles: boolean;
  container: 'container' | 'container-fluid';
  fontSize: number;
  lineSpacing: number;
  background: string;
  fontColor: string;
}

export interface SettingsFile extends EditorSettings {
  exportSettings: ExportSettings;
}
