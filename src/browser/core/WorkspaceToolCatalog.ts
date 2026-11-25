import type { ToolSpec } from './AssistantTools';
import { workspaceEditorTools } from './WorkspaceEditorTools';
import { workspaceFeatureTools } from './WorkspaceFeatureTools';
import type {
  PathOperationInput,
  WorkspacePathInfo,
} from '../../app/interfaces/WorkspaceTools';

const pathOperations = {
  move_path: {
    operation: 'move',
    description:
      'Move a file or whole folder to an exact destination, creating missing parent folders. Use this instead of copying and deleting. Always asks for confirmation; preserves open unsaved buffers at their new paths. Fails on collisions unless overwrite is true.',
    properties: {
      source: { type: 'string' },
      destination: { type: 'string' },
      overwrite: { type: 'boolean' },
      updateLinks: { type: 'boolean' },
    },
    required: ['source', 'destination'],
  },
  rename_path: {
    operation: 'rename',
    description:
      'Rename a file or folder in place. newName must be a bare filename, not a path; use move_path for another directory. Always asks for confirmation and preserves open unsaved buffers.',
    properties: {
      path: { type: 'string' },
      newName: { type: 'string' },
      updateLinks: { type: 'boolean' },
    },
    required: ['path', 'newName'],
  },
  copy_path: {
    operation: 'copy',
    description:
      'Copy a file or a folder recursively to an exact destination. Use move_path when originals should go away. Save unsaved source tabs first; this tool refuses to copy stale disk content. Always confirms and never overwrites unless overwrite is true.',
    properties: {
      source: { type: 'string' },
      destination: { type: 'string' },
      overwrite: { type: 'boolean' },
    },
    required: ['source', 'destination'],
  },
  delete_path: {
    operation: 'delete',
    description:
      'Send a file or folder to the OS trash/recycle bin after explicit confirmation. Non-empty folders require recursive: true. Refuses unsaved tabs and the workspace root; use close_tab to close a tab without deleting its file.',
    properties: { path: { type: 'string' }, recursive: { type: 'boolean' } },
    required: ['path'],
  },
} as const;

const pathCatalog: Record<string, ToolSpec> = Object.fromEntries(
  Object.entries(pathOperations).map(([name, definition]) => {
    const input = (args: unknown): PathOperationInput => {
      const values = args as Record<string, unknown>;
      return {
        operation: definition.operation,
        source: (values.source ?? values.path) as string,
        destination: values.destination as string | undefined,
        newName: values.newName as string | undefined,
        overwrite: values.overwrite as boolean | undefined,
        recursive: values.recursive as boolean | undefined,
      };
    };
    return [
      name,
      {
        description: definition.description,
        parameters: {
          type: 'object',
          properties: definition.properties,
          required: [...definition.required],
          additionalProperties: false,
        },
        toolClass: 'write',
        alwaysConfirm: true,
        prepare: (args, ctx) =>
          ctx.workspace.preparePath(
            args as object,
            input(args),
            (args as { updateLinks?: boolean }).updateLinks !== false,
          ),
        execute: (args, ctx) =>
          ctx.workspace.executePath(
            args as object,
            input(args),
            (args as { updateLinks?: boolean }).updateLinks !== false,
          ),
      } satisfies ToolSpec,
    ];
  }),
);

export const workspaceToolCatalog: Record<string, ToolSpec> = {
  ...pathCatalog,
  ...workspaceEditorTools,
  ...workspaceFeatureTools,
  path_info: {
    description:
      'Check whether a workspace path exists and get its file/folder type, size in bytes, modified time, and immediate item count for folders. Use this for existence checks, not read_file on a directory. Does not open tabs.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const info = await ctx.workspace.request<WorkspacePathInfo>({
        action: 'info',
        path: (args as { path: string }).path,
      });
      return {
        operation: 'path_info',
        ...info,
        summary: info.exists
          ? `${info.type}: ${info.path}`
          : `Path does not exist: ${info.path}`,
      };
    },
  },
  search_files: {
    description:
      'Search UTF-8 workspace file contents, including unsaved open buffers and collapsed folders. Returns bounded file/line/snippet matches. Use list_files for filenames and read_file for exact content. Binary files and files larger than 4 MiB are skipped.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        regex: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        subpath: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    toolClass: 'read',
    execute: (args, ctx) =>
      ctx.workspace.search(args as Parameters<typeof ctx.workspace.search>[0]),
  },
  find_and_replace: {
    description:
      'Plan text replacement across UTF-8 workspace files or an explicit paths array. Defaults to dryRun: true (no writes). Set dryRun: false to request explicit confirmation showing file and match counts; includes and saves unsaved buffer edits. Use edit_file for one unique exact replacement.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string' },
        replace: { type: 'string' },
        regex: { type: 'boolean' },
        paths: { type: 'array', items: { type: 'string' } },
        dryRun: { type: 'boolean' },
      },
      required: ['find', 'replace'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    classifyArgs: (args) =>
      (args as { dryRun?: boolean }).dryRun === false ? 'write' : 'read',
    prepare: (args, ctx) =>
      ctx.workspace.replace(
        args as object,
        args as Parameters<typeof ctx.workspace.replace>[1],
        true,
      ) as Promise<import('../../app/interfaces/Assistant').ToolConfirmPreview>,
    execute: (args, ctx) =>
      ctx.workspace.replace(
        args as object,
        args as Parameters<typeof ctx.workspace.replace>[1],
      ),
  },
  update_links: {
    description:
      'Repair relative Markdown links and images after a file/folder was moved from oldPath to newPath. Handles inline and reference-style destinations, preserves anchors and external URLs, and ignores code blocks. Defaults to a dry run; dryRun: false always asks for confirmation. move_path/rename_path update links automatically by default.',
    parameters: {
      type: 'object',
      properties: {
        oldPath: { type: 'string' },
        newPath: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
      required: ['oldPath', 'newPath'],
      additionalProperties: false,
    },
    toolClass: 'write',
    alwaysConfirm: true,
    classifyArgs: (args) =>
      (args as { dryRun?: boolean }).dryRun === false ? 'write' : 'read',
    prepare: (args, ctx) => {
      const a = args as { oldPath: string; newPath: string; dryRun?: boolean };
      return ctx.workspace.links(
        args as object,
        a.oldPath,
        a.newPath,
        a.dryRun,
        true,
      ) as Promise<import('../../app/interfaces/Assistant').ToolConfirmPreview>;
    },
    execute: (args, ctx) => {
      const a = args as { oldPath: string; newPath: string; dryRun?: boolean };
      return ctx.workspace.links(
        args as object,
        a.oldPath,
        a.newPath,
        a.dryRun,
      );
    },
  },
  check_links: {
    description:
      'Report broken relative Markdown links, missing images and heading anchors in the workspace or subpath. Checks local files only, ignores external URLs and code blocks; no network requests or writes. Results capped at 500.',
    parameters: {
      type: 'object',
      properties: { subpath: { type: 'string' } },
      additionalProperties: false,
    },
    toolClass: 'read',
    execute: (args, ctx) =>
      ctx.workspace.checkLinks((args as { subpath?: string }).subpath),
  },
  get_outline: {
    description:
      'Read document headings with levels, line numbers and conventional Markdown heading anchors. Includes ATX and Setext headings, excludes code blocks. Use read_file for the actual text.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const file = await ctx.workspace.read((args as { path: string }).path);
      const { parseWorkspaceMarkdown } = await import('./workspaceMarkdown');
      const headings = parseWorkspaceMarkdown(file.content).headings;
      return {
        operation: 'get_outline',
        path: file.path,
        headings: headings.slice(0, 500),
        truncated: headings.length > 500,
      };
    },
  },
};
