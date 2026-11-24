import type { ToolSpec } from './AssistantTools';
import type { EditorSettings } from '../interfaces/Editor';
import { WORKSPACE_EXTENSIONS } from '../../app/shared/fileExtensions';
import { supportedLocales } from '../i18n';
import {
  resolveAgentPath,
  WorkspaceToolError,
} from '../../app/shared/workspacePaths';

export function validateAgentSetting(
  key: string,
  value: unknown,
  root: string | null,
): keyof EditorSettings {
  if (
    [
      'autoindent',
      'darkmode',
      'wordwrap',
      'whitespace',
      'minimap',
      'systemtheme',
      'scrollsync',
      'sessionRestore',
    ].includes(key)
  ) {
    if (typeof value === 'boolean') return key as keyof EditorSettings;
  } else if (key === 'locale') {
    if (typeof value === 'string' && supportedLocales.includes(value))
      return key;
  } else if (
    key === 'fileExplorer' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const settings = value as Record<string, unknown>;
    if (
      Object.keys(settings).length === 1 &&
      Array.isArray(settings.extensions) &&
      settings.extensions.length > 0 &&
      settings.extensions.every(
        (extension) =>
          typeof extension === 'string' &&
          WORKSPACE_EXTENSIONS.includes(extension),
      )
    )
      return key;
  } else if (
    key === 'pasteImages' &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const settings = value as Record<string, unknown>;
    if (
      Object.keys(settings).length === 1 &&
      typeof settings.directory === 'string' &&
      settings.directory &&
      !/^(?:[a-z]:|\/|\\)/i.test(settings.directory)
    ) {
      resolveAgentPath(root, settings.directory);
      return key;
    }
  }
  throw new WorkspaceToolError(
    'invalid_setting',
    `Unknown setting or invalid value: ${key}`,
  );
}

export const workspaceFeatureTools: Record<string, ToolSpec> = {
  get_settings: {
    description:
      'Read current editor and document/export settings. Does not expose AI provider secrets or change settings. Use set_setting to change one validated editor setting.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    toolClass: 'read',
    async execute(_args, ctx) {
      return {
        operation: 'get_settings',
        editor: ctx.bridge.providers.settings?.getSettings() ?? null,
        export: ctx.bridge.providers.exportSettings?.getSettings() ?? null,
      };
    },
  },
  set_setting: {
    description:
      'Change one known editor setting after confirmation. Accepts autoindent, darkmode, wordwrap, whitespace, minimap, systemtheme, scrollsync, sessionRestore (booleans), locale (supported language code), fileExplorer ({extensions:[known extensions]}) or pasteImages ({directory:workspace-relative path}). Use get_settings to inspect current values; never accepts arbitrary config keys or API keys.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {} },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    async prepare(args, ctx) {
      const a = args as { key: string; value: unknown };
      validateAgentSetting(
        a.key,
        a.value,
        ctx.bridge.fileTreeManager.getSnapshot().treeRoot,
      );
      return {
        kind: 'operation',
        after: '',
        summary: `Set ${a.key} to ${JSON.stringify(a.value)}.`,
      };
    },
    async execute(args, ctx) {
      const a = args as { key: string; value: unknown };
      const key = validateAgentSetting(
          a.key,
          a.value,
          ctx.bridge.fileTreeManager.getSnapshot().treeRoot,
        ),
        settings = ctx.bridge.providers.settings;
      if (!settings)
        throw new WorkspaceToolError(
          'unavailable',
          'Settings provider is not ready.',
        );
      settings.updateSetting(key, a.value as EditorSettings[typeof key]);
      return {
        operation: 'set_setting',
        key,
        value: a.value,
        summary: `Updated ${key}.`,
      };
    },
  },
  export_html: {
    description:
      'Export a workspace Markdown document (or the active file) through MKEditor’s existing HTML export pipeline. Includes unsaved text and current document styling; withStyles overrides styling for this export only. Asks for confirmation, then opens the native Save dialog. Returns the selected output path after saving, or a cancellation error. Use read_file for Markdown content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, withStyles: { type: 'boolean' } },
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    async prepare(args, ctx) {
      const a = args as { path?: string; withStyles?: boolean };
      const input = a.path ?? ctx.bridge.fileManager.getActiveEditablePath();
      if (!input)
        throw new WorkspaceToolError('not_found', 'No active workspace file.');
      const path = await ctx.workspace.pinPath(args as object, input);
      return {
        kind: 'operation',
        path,
        after: '',
        summary: `Export ${path} to HTML${a.withStyles === false ? ' without styles' : ''}. You will choose the output in the Save dialog; unsaved buffer text is included.`,
      };
    },
    async execute(args, ctx) {
      const a = args as { path?: string; withStyles?: boolean },
        input = a.path ?? ctx.bridge.fileManager.getActiveEditablePath();
      if (!input)
        throw new WorkspaceToolError('not_found', 'No active workspace file.');
      const path = await ctx.workspace.pinnedPath(args as object, input);
      const file = await ctx.workspace.read(path),
        settings = ctx.bridge.providers.exportSettings?.getSettings();
      if (!settings)
        throw new WorkspaceToolError(
          'unavailable',
          'Export settings are not ready.',
        );
      const [{ Markdown }, { HTMLExporter }] = await Promise.all([
        import('./Markdown'),
        import('./HTMLExporter'),
      ]);
      const wrapper = document.createElement('div');
      wrapper.id = 'preview-content';
      wrapper.className = settings.container;
      wrapper.innerHTML = Markdown.render(file.content);
      const content = await HTMLExporter.prepareHTML(wrapper.outerHTML, {
        ...settings,
        withStyles: a.withStyles ?? settings.withStyles,
      });
      const result = await ctx.workspace.request<{ path: string }>({
        action: 'export-html',
        content,
      });
      return {
        operation: 'export_html',
        source: file.path,
        path: result.path,
        summary: `Exported HTML to ${result.path}.`,
      };
    },
  },
};
