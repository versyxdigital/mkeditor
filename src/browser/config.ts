import type { EditorSettings, ExportSettings } from './interfaces/Editor';
import { normalizeLanguage } from './i18n';

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
  locale: normalizeLanguage(navigator.language),
  fileExplorer: { extensions: ['md'] },
};

/**
 * Curated set of file extensions the sidebar will surface beyond `.md`.
 * Main process / WebFileBridge always send the full curated set; the
 * funnel UI narrows further on the renderer side. Grouped here so the
 * filter dropdown can render section headings without duplicating the
 * lists across components.
 */
export const FILE_EXPLORER_EXTENSION_GROUPS: ReadonlyArray<{
  /** i18n key suffix under `sidebar:filter_section_*`. */
  key: 'markdown' | 'images' | 'documents';
  /** Extensions in this group (lower-case, no dot). */
  extensions: ReadonlyArray<string>;
}> = [
  { key: 'markdown', extensions: ['md'] },
  { key: 'images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
  { key: 'documents', extensions: ['html', 'pdf', 'txt'] },
] as const;

/** Flat list of every curated extension — what main/WebFileBridge surface. */
export const FILE_EXPLORER_CURATED_EXTENSIONS: ReadonlyArray<string> =
  FILE_EXPLORER_EXTENSION_GROUPS.flatMap((g) => g.extensions);

export const exportSettings: ExportSettings = {
  withStyles: true,
  container: 'container-fluid',
  fontSize: 16,
  lineSpacing: 1.5,
  background: '#ffffff',
  fontColor: '#212529',
};
