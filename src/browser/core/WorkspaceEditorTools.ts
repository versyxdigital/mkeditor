import type { ToolSpec } from './AssistantTools';
import { WorkspaceToolError } from '../../app/shared/workspacePaths';

export function replaceLineRange(
  content: string,
  startLine: number,
  endLine: number,
  newText: string,
): string {
  const eol = content.includes('\r\n')
    ? '\r\n'
    : content.includes('\r')
      ? '\r'
      : '\n';
  const lines = content.split(/\r\n|\r|\n/);
  if (
    startLine < 1 ||
    startLine > lines.length + 1 ||
    endLine < startLine - 1 ||
    endLine > lines.length
  )
    throw new WorkspaceToolError(
      'invalid_range',
      `Use a 1-based inclusive range within 1–${lines.length}, or endLine=startLine-1 for insertion.`,
    );
  const text = newText.replace(/\r\n|\r|\n/g, eol);
  if (endLine === startLine - 1 && !text) return content;
  const before = lines.slice(0, startLine - 1).join(eol);
  const after = lines.slice(endLine).join(eol);
  const hasBefore = startLine > 1,
    hasAfter = endLine < lines.length;
  // Range boundaries sit between complete lines; preserve the file's EOL style.
  return (
    (hasBefore ? before + eol : '') +
    text +
    (hasAfter && text && !text.endsWith(eol) ? eol : '') +
    after
  );
}

const templates: Record<string, string> = {
  readme:
    '# {{title}}\n\n{{description}}\n\n## Getting started\n\n## Usage\n\n## License\n',
  'blog-post':
    '# {{title}}\n\nDate: {{date}}\nAuthor: {{author}}\n\n{{description}}\n\n## Introduction\n\n## Conclusion\n',
  'meeting-notes':
    '# {{title}}\n\nDate: {{date}}\nAttendees: {{attendees}}\n\n## Agenda\n\n- \n\n## Notes\n\n## Action items\n\n- [ ] \n',
};

export function renderWorkspaceTemplate(
  template: string,
  variables: Record<string, unknown> = {},
): string {
  if (!Object.hasOwn(templates, template))
    throw new WorkspaceToolError(
      'unknown_template',
      `Choose a built-in template: ${Object.keys(templates).join(', ')}.`,
    );
  for (const [key, value] of Object.entries(variables))
    if (typeof value !== 'string')
      throw new WorkspaceToolError(
        'invalid_arguments',
        `Template variable ${key} must be a string.`,
      );
  const values = {
    title:
      template === 'readme'
        ? 'Project'
        : template === 'blog-post'
          ? 'New post'
          : 'Meeting notes',
    date: new Date().toISOString().slice(0, 10),
    description: '',
    author: '',
    attendees: '',
    ...variables,
  };
  return templates[template].replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.hasOwn(values, key)
      ? String(values[key as keyof typeof values])
      : '',
  );
}

export const workspaceEditorTools: Record<string, ToolSpec> = {
  get_open_tabs: {
    description:
      'List open tabs with active and unsaved-change flags. Returns tab identifiers, not file content; diff and untitled tabs are marked. Use get_active_file for content, save_file to persist edits, close_tab to close safely.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    toolClass: 'read',
    async execute(_args, ctx) {
      const fm = ctx.bridge.fileManager,
        snapshot = fm.getSnapshot();
      ctx.workspace.root();
      return {
        operation: 'get_open_tabs',
        tabs: snapshot.tabs.slice(0, 500).map((tab) => ({
          path: tab.path,
          name: tab.name,
          active: tab.path === fm.activeFile,
          unsaved: tab.dirty,
          kind: tab.kind ?? 'file',
        })),
        truncated: snapshot.tabs.length > 500,
      };
    },
  },
  save_file: {
    description:
      'Save an open tab or the active tab when path is omitted. Includes unsaved buffer edits and asks for confirmation. Untitled tabs use the existing Save As dialog; cancellation is reported. Use write_file to replace content rather than merely save.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    prepare: (args, ctx) =>
      ctx.workspace.prepareTab(
        args as object,
        (args as { path?: string }).path,
        'save',
      ),

    execute: (args, ctx) =>
      ctx.workspace.executeTab(
        args as object,
        (args as { path?: string }).path,
        'save',
      ),
  },
  close_tab: {
    description:
      'Close an open tab without deleting its file. Fails on unsaved edits unless discard: true is explicitly provided. Asks for confirmation and rechecks the previewed buffer; save_file first to keep edits.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, discard: { type: 'boolean' } },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    prepare: (args, ctx) => {
      const a = args as { path: string; discard?: boolean };
      return ctx.workspace.prepareTab(
        args as object,
        a.path,
        'close',
        a.discard,
      );
    },

    execute: (args, ctx) => {
      const a = args as { path: string; discard?: boolean };
      return ctx.workspace.executeTab(
        args as object,
        a.path,
        'close',
        a.discard,
      );
    },
  },
  append_to_file: {
    getFullContent: async (args, ctx, side) =>
      ctx.workspace.getTextPreview(args as object, side),
    description:
      'Append text to an existing UTF-8 file, preserving existing content. Uses the open buffer when present, warning that unsaved edits will be saved. Clean files use native append; asks for confirmation. Use create_file for a new file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    prepare: (args, ctx) => {
      const a = args as { path: string; content: string };
      return ctx.workspace.prepareEdit(
        args as object,
        a.path,
        (before) => before + a.content,
        `Append ${a.content.length} characters to ${a.path}.`,
      );
    },

    execute: (args, ctx) => {
      const a = args as { path: string; content: string };
      return ctx.workspace.executeEdit(
        args as object,
        a.path,
        (before) => before + a.content,
        'append_to_file',
      );
    },
  },
  edit_lines: {
    getFullContent: async (args, ctx, side) =>
      ctx.workspace.getTextPreview(args as object, side),
    description:
      'Replace a 1-based inclusive line range in an existing file. For pure insertion before startLine use endLine=startLine-1 (including insertion after the final line). Preserves line endings and unsaved buffer text outside the range. Confirms before saving. Use edit_file for a unique text match.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 0 },
        newText: { type: 'string' },
      },
      required: ['path', 'startLine', 'endLine', 'newText'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    prepare: (args, ctx) => {
      const a = args as {
        path: string;
        startLine: number;
        endLine: number;
        newText: string;
      };
      return ctx.workspace.prepareEdit(
        args as object,
        a.path,
        (before) => replaceLineRange(before, a.startLine, a.endLine, a.newText),
        `Edit lines ${a.startLine}–${a.endLine} in ${a.path}.`,
      );
    },

    execute: (args, ctx) => {
      const a = args as {
        path: string;
        startLine: number;
        endLine: number;
        newText: string;
      };
      return ctx.workspace.executeEdit(
        args as object,
        a.path,
        (before) => replaceLineRange(before, a.startLine, a.endLine, a.newText),
        'edit_lines',
      );
    },
  },
  word_count: {
    description:
      'Count words, Unicode characters and lines in the current file text, preferring unsaved open buffers. Estimated reading time uses 200 words/minute. Does not modify Markdown or open tabs.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const file = await ctx.workspace.read((args as { path: string }).path);
      const words = file.content.trim()
        ? file.content.trim().split(/\s+/u).length
        : 0;
      return {
        operation: 'word_count',
        path: file.path,
        words,
        characters: Array.from(file.content).length,
        lines: file.content.split(/\r\n|\r|\n/).length,
        readingMinutes: Math.ceil(words / 200),
      };
    },
  },
  create_from_template: {
    getFullContent: async (args, ctx, side) =>
      ctx.workspace.getTextPreview(args as object, side),
    description:
      'Create a new UTF-8 Markdown file from readme, blog-post or meeting-notes. Optional variables maps placeholders such as title, description, date, author and attendees to strings. Asks for confirmation and never overwrites an existing file; use write_file for deliberate replacement.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        template: { type: 'string', enum: Object.keys(templates) },
        variables: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['path', 'template'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    async prepare(args, ctx) {
      const a = args as {
        path: string;
        template: string;
        variables?: Record<string, unknown>;
      };
      return ctx.workspace.createTemplate(
        args as object,
        a.path,
        renderWorkspaceTemplate(a.template, a.variables),
        true,
      ) as Promise<import('../../app/interfaces/Assistant').ToolConfirmPreview>;
    },

    execute: (args, ctx) => {
      const a = args as {
        path: string;
        template: string;
        variables?: Record<string, unknown>;
      };
      return ctx.workspace.createTemplate(
        args as object,
        a.path,
        renderWorkspaceTemplate(a.template, a.variables),
      );
    },
  },
};
