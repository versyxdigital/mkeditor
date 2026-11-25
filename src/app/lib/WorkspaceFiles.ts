import { promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join } from 'path';
import { randomUUID } from 'crypto';
import { shell, type BrowserWindow } from 'electron';
import { AppStorage } from './AppStorage';
import { runWorkspaceRegex } from './workspaceRegex';
import type {
  PathOperationInput,
  PathOperationPlan,
  WorkspaceOperationResult,
  WorkspacePathInfo,
  WorkspaceRequest,
  WorkspaceTextChange,
} from '../interfaces/WorkspaceTools';
import {
  resolveAgentPath,
  validateWorkspaceName,
  withinWorkspacePath,
  workspacePathKey,
  WorkspaceToolError,
} from '../shared/workspacePaths';

interface PreparedPath {
  root: string;
  input: PathOperationInput;
  plan: PathOperationPlan;
  sourceStamp: string;
  destinationStamp: string;
  expires: number;
}

/** Native half of workspace tools, reached only through sender-scoped AppBridge. */
export class WorkspaceFiles {
  private readonly plans = new Map<string, PreparedPath>();
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly context: BrowserWindow) {}

  async resolve(input: string): Promise<string> {
    const root = AppStorage.getWorkspaceRoot();
    let path: string;
    try {
      path = resolveAgentPath(root, input);
    } catch (error) {
      if (
        !(error instanceof WorkspaceToolError) ||
        error.code !== 'outside_workspace' ||
        !isAbsolute(input)
      )
        throw error;
      // An absolute Windows 8.3 alias may spell the authorised root differently.
      // Resolve it through the filesystem boundary before the lexical check.
      let canonical: string;
      try {
        canonical = await AppStorage.assertInWorkspace(input, {
          mustExist: false,
        });
      } catch {
        throw error;
      }
      path = resolveAgentPath(root, canonical);
    }
    const safe = await AppStorage.assertInWorkspace(path, { mustExist: false });
    if (root !== AppStorage.getWorkspaceRoot())
      throw new WorkspaceToolError(
        'workspace_changed',
        'Workspace changed while resolving a path.',
      );
    return safe;
  }

  async request(request: WorkspaceRequest): Promise<unknown> {
    if (!request || typeof request !== 'object')
      throw new WorkspaceToolError(
        'invalid_arguments',
        'Invalid workspace request.',
      );
    switch (request.action) {
      case 'export-html': {
        if (
          typeof request.content !== 'string' ||
          !request.content.startsWith('<!DOCTYPE html>') ||
          request.content.length > 16 * 1024 * 1024
        )
          throw new WorkspaceToolError(
            'invalid_arguments',
            'Invalid HTML export.',
          );
        const result = await AppStorage.saveFile(this.context, {
          id: this.context.webContents.id,
          data: request.content,
          encoding: 'utf-8',
        });
        if (!result.ok)
          throw new WorkspaceToolError(
            result.cancelled ? 'cancelled' : 'export_failed',
            result.error ?? 'Export was cancelled.',
          );
        return result;
      }
      case 'resolve':
        return this.resolve(request.path);
      case 'info':
        return this.info(request.path);
      case 'read-text':
        return this.readText(request.path);
      case 'regex-text':
        return runWorkspaceRegex(request);
      case 'append-text': {
        const next = this.mutation.then(async () => {
          const file = await this.readText(request.path);
          if (file.content !== request.expected)
            throw new WorkspaceToolError(
              'stale_plan',
              'File changed since append preview.',
            );
          if (
            typeof request.content !== 'string' ||
            request.content.includes('\0') ||
            request.content.length > 4 * 1024 * 1024
          )
            throw new WorkspaceToolError(
              'invalid_arguments',
              'Invalid append text.',
            );
          await fs.appendFile(file.path, request.content, 'utf8');
          return {
            paths: [file.path],
            summary: `Appended ${request.content.length} characters.`,
          };
        });
        this.mutation = next.catch(() => undefined);
        return next;
      }
      case 'write-batch': {
        const next = this.mutation.then(() => this.writeBatch(request.changes));
        this.mutation = next.catch(() => undefined);
        return next;
      }
      case 'prepare-path':
        return this.prepare(request.input);
      case 'execute-path': {
        const next = this.mutation.then(() => this.execute(request.id));
        this.mutation = next.catch(() => undefined);
        return next;
      }
      default:
        throw new WorkspaceToolError(
          'invalid_arguments',
          'Unknown workspace action.',
        );
    }
  }

  private async stat(path: string) {
    try {
      return await fs.lstat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async readText(input: string): Promise<{ path: string; content: string }> {
    const path = await this.resolve(input);
    const stat = await fs.stat(path);
    if (!stat.isFile())
      throw new WorkspaceToolError('not_file', `Not a file: ${path}`);
    if (stat.size > 4 * 1024 * 1024)
      throw new WorkspaceToolError(
        'file_too_large',
        `Text tools are limited to 4 MiB per file: ${path}`,
      );
    const bytes = await fs.readFile(path);
    if (bytes.includes(0))
      throw new WorkspaceToolError(
        'binary_file',
        `Binary files cannot be edited as text: ${path}`,
      );
    let content: string;
    try {
      content = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new WorkspaceToolError(
        'binary_file',
        `File is not UTF-8 text: ${path}`,
      );
    }
    return { path, content };
  }

  private async writeBatch(
    changes: WorkspaceTextChange[],
  ): Promise<{ paths: string[]; summary: string }> {
    if (!Array.isArray(changes) || changes.length > 500)
      throw new WorkspaceToolError(
        'invalid_arguments',
        'A batch may contain at most 500 files.',
      );
    const root = AppStorage.getWorkspaceRoot();
    const prepared: Array<WorkspaceTextChange & { staged?: string }> = [];
    const seen = new Set<string>();
    let bytes = 0;
    for (const change of changes) {
      if (
        !change ||
        typeof change.content !== 'string' ||
        (change.expected !== null && typeof change.expected !== 'string')
      )
        throw new WorkspaceToolError(
          'invalid_arguments',
          'Invalid text change.',
        );
      bytes +=
        Buffer.byteLength(change.content) +
        Buffer.byteLength(change.expected ?? '');
      if (bytes > 32 * 1024 * 1024 || change.content.includes('\0'))
        throw new WorkspaceToolError(
          'batch_too_large',
          'Text batches are limited to 32 MiB and cannot contain binary data.',
        );
      const path = await this.resolve(change.path);
      if (change.expected === null)
        for (const name of path
          .slice(root!.length)
          .split(/[\\/]/)
          .filter(Boolean))
          validateWorkspaceName(name);
      if (workspacePathKey(path) === workspacePathKey(root!))
        throw new WorkspaceToolError(
          'not_file',
          'Cannot write to the workspace root.',
        );
      if (seen.has(workspacePathKey(path)))
        throw new WorkspaceToolError(
          'invalid_arguments',
          `Duplicate path in batch: ${path}`,
        );
      seen.add(workspacePathKey(path));
      const current = await this.stat(path);
      if (change.expected === null && current)
        throw new WorkspaceToolError(
          'destination_exists',
          `Destination exists: ${path}`,
        );
      if (
        change.expected !== null &&
        (!current || (await this.readText(path)).content !== change.expected)
      )
        throw new WorkspaceToolError(
          'stale_plan',
          `File changed since preview: ${path}`,
        );
      prepared.push({ ...change, path });
    }
    const written: typeof prepared = [];
    try {
      for (const change of prepared) {
        await fs.mkdir(dirname(change.path), { recursive: true });
        await this.resolve(change.path);
        change.staged = join(
          dirname(change.path),
          `.mkeditor-write-${randomUUID()}`,
        );
        await fs.writeFile(change.staged, change.content, {
          flag: 'wx',
          encoding: 'utf8',
          ...(change.expected === null
            ? {}
            : { mode: (await fs.stat(change.path)).mode }),
        });
      }
      for (const change of prepared) {
        if (root !== AppStorage.getWorkspaceRoot())
          throw new WorkspaceToolError(
            'workspace_changed',
            'Workspace changed during the batch.',
          );
        await this.resolve(change.path);
        const current = await this.stat(change.path);
        if (
          change.expected === null
            ? current !== null
            : !current ||
              (await this.readText(change.path)).content !== change.expected
        )
          throw new WorkspaceToolError(
            'stale_plan',
            `File changed during the batch: ${change.path}`,
          );
        if (change.expected === null) {
          await fs.link(change.staged!, change.path); // Atomic create without overwriting a concurrent new file.
          await fs.unlink(change.staged!);
        } else await fs.rename(change.staged!, change.path);
        change.staged = undefined;
        written.push(change);
      }
    } catch (error) {
      const notRestored: string[] = [];
      for (const change of written.reverse()) {
        try {
          // Never roll back over a concurrent external edit.
          if ((await this.readText(change.path)).content !== change.content)
            throw new Error('File changed externally.', { cause: error });
          if (change.expected === null) await fs.unlink(change.path);
          else await AppStorage.writeTextFile(change.path, change.expected);
        } catch {
          notRestored.push(change.path);
        }
      }
      if (notRestored.length)
        throw new WorkspaceToolError(
          'partial_failure',
          `Batch failed; rollback could not restore: ${notRestored.join(', ')}. Other files were restored. ${String(error)}`,
        );
      throw error;
    } finally {
      for (const change of prepared)
        if (change.staged) await fs.rm(change.staged, { force: true });
    }
    for (const parent of new Set(
      prepared.map((change) => dirname(change.path)),
    )) {
      try {
        this.context.webContents.send('from:folder:opened', {
          path: parent,
          tree: await AppStorage.readDirectory(parent),
        });
      } catch {
        /* A later explorer refresh can recover. */
      }
    }
    return {
      paths: prepared.map((change) => change.path),
      summary: `Updated ${prepared.length} file(s).`,
    };
  }

  /** Also refuses directory symlinks in destructive recursive operations. */
  private async stamp(path: string): Promise<{ stamp: string; files: number }> {
    const entries: string[] = [];
    let files = 0;
    const visit = async (target: string): Promise<void> => {
      await this.resolve(target);
      const stat = await this.stat(target);
      if (!stat) {
        entries.push(`${target}:missing`);
        return;
      }
      if (stat.isSymbolicLink())
        throw new WorkspaceToolError(
          'symbolic_link',
          `Recursive operations do not follow symbolic links: ${target}`,
        );
      if (!stat.isFile() && !stat.isDirectory())
        throw new WorkspaceToolError(
          'unsupported_file',
          `Unsupported filesystem entry: ${target}`,
        );
      entries.push(
        `${target}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
      );
      if (stat.isFile()) files++;
      else
        for (const name of (await fs.readdir(target)).sort())
          await visit(join(target, name));
    };
    await visit(path);
    return { stamp: entries.join('\n'), files };
  }

  async info(input: string): Promise<WorkspacePathInfo> {
    const path = await this.resolve(input);
    const stat = await this.stat(path);
    if (!stat) return { path, exists: false };
    return {
      path,
      exists: true,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modified: stat.mtime.toISOString(),
      ...(stat.isDirectory() ? { items: (await fs.readdir(path)).length } : {}),
    };
  }

  async prepare(input: PathOperationInput): Promise<PathOperationPlan> {
    if (
      !input ||
      !['move', 'rename', 'copy', 'delete'].includes(input.operation)
    )
      throw new WorkspaceToolError(
        'invalid_arguments',
        'Unknown path operation.',
      );
    for (const flag of ['overwrite', 'recursive'] as const)
      if (input[flag] !== undefined && typeof input[flag] !== 'boolean')
        throw new WorkspaceToolError(
          'invalid_arguments',
          `${flag} must be boolean.`,
        );
    const root = AppStorage.getWorkspaceRoot();
    const source = await this.resolve(input.source);
    const sourceEntry = await this.stat(resolveAgentPath(root, input.source));
    if (sourceEntry?.isSymbolicLink())
      throw new WorkspaceToolError(
        'symbolic_link',
        'Path mutations do not follow symbolic links.',
      );
    const stat = await this.stat(source);
    if (!stat)
      throw new WorkspaceToolError('not_found', `Path not found: ${source}`);
    if (workspacePathKey(source) === workspacePathKey(root!))
      throw new WorkspaceToolError(
        'workspace_root',
        'The workspace root cannot be moved, renamed, copied or deleted.',
      );
    let destination: string | undefined;
    if (input.operation !== 'delete') {
      if (input.operation === 'rename')
        validateWorkspaceName(input.newName ?? '');
      destination = await this.resolve(
        input.operation === 'rename'
          ? join(dirname(source), input.newName!)
          : (input.destination ?? ''),
      );
      validateWorkspaceName(basename(destination));
      for (const name of destination
        .slice(root!.length)
        .split(/[\\/]/)
        .filter(Boolean))
        validateWorkspaceName(name);
      if (workspacePathKey(source) === workspacePathKey(destination))
        throw new WorkspaceToolError(
          'same_path',
          'Source and destination are the same.',
        );
      if (
        withinWorkspacePath(destination, source) ||
        withinWorkspacePath(source, destination)
      )
        throw new WorkspaceToolError(
          'nested_destination',
          'Source and destination must not contain one another.',
        );
      if ((await this.stat(destination)) && !input.overwrite)
        throw new WorkspaceToolError(
          'destination_exists',
          `Destination exists: ${destination}`,
        );
    } else if (
      stat.isDirectory() &&
      !input.recursive &&
      (await fs.readdir(source)).length
    )
      throw new WorkspaceToolError(
        'not_empty',
        'The folder is not empty. Set recursive: true to trash its contents.',
      );
    const src = await this.stamp(source);
    const dst = destination
      ? await this.stamp(destination)
      : { stamp: '', files: 0 };
    const id = randomUUID();
    const summary = `${input.operation} ${source}${destination ? ` → ${destination}` : ' to the OS trash'}; ${src.files} file(s) affected${dst.files ? `; replace ${dst.files} destination file(s)` : ''}.`;
    const plan: PathOperationPlan = {
      id,
      operation: input.operation,
      source,
      destination,
      files: src.files,
      overwrittenFiles: dst.files,
      summary,
    };
    for (const [key, value] of this.plans)
      if (value.expires < Date.now()) this.plans.delete(key);
    if (this.plans.size >= 100)
      throw new WorkspaceToolError(
        'too_many_plans',
        'Too many pending operations.',
      );
    this.plans.set(id, {
      root: root!,
      input: { ...input },
      plan,
      sourceStamp: src.stamp,
      destinationStamp: dst.stamp,
      expires: Date.now() + 10 * 60_000,
    });
    return plan;
  }

  private async execute(id: string): Promise<WorkspaceOperationResult> {
    const prepared = this.plans.get(id);
    this.plans.delete(id);
    if (!prepared || prepared.expires < Date.now())
      throw new WorkspaceToolError(
        'stale_plan',
        'Request a new operation preview.',
      );
    if (prepared.root !== AppStorage.getWorkspaceRoot())
      throw new WorkspaceToolError(
        'workspace_changed',
        'The workspace changed after preview.',
      );
    const { plan, input } = prepared;
    const { source, destination } = plan;
    if (
      (await this.stamp(source)).stamp !== prepared.sourceStamp ||
      (destination &&
        (await this.stamp(destination)).stamp !== prepared.destinationStamp)
    )
      throw new WorkspaceToolError(
        'stale_plan',
        'Files changed after preview. Request a new tool call.',
      );
    // Staging/backup are siblings on the same volume so the final rename is atomic.
    let backup: string | undefined;
    let staged: string | undefined;
    let committed = false;
    try {
      if (input.operation === 'delete') await shell.trashItem(source);
      else {
        await fs.mkdir(dirname(destination!), { recursive: true });
        await this.resolve(destination!);
        if (input.operation === 'copy') {
          staged = join(
            dirname(destination!),
            `.mkeditor-copy-${randomUUID()}`,
          );
          await fs.cp(source, staged, {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
        if (await this.stat(destination!)) {
          if (!input.overwrite)
            throw new WorkspaceToolError(
              'destination_exists',
              `Destination exists: ${destination}`,
            );
          backup = join(
            dirname(destination!),
            `.mkeditor-backup-${randomUUID()}`,
          );
          await fs.rename(destination!, backup);
        }
        try {
          await fs.rename(staged ?? source, destination!);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'EXDEV' ||
            input.operation === 'copy'
          )
            throw error;
          staged = join(
            dirname(destination!),
            `.mkeditor-move-${randomUUID()}`,
          );
          await fs.cp(source, staged, {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
          if ((await this.stamp(source)).stamp !== prepared.sourceStamp)
            throw new WorkspaceToolError(
              'stale_plan',
              'Source changed during cross-device copy.',
            );
          await fs.rename(staged, destination!);
          staged = undefined;
          try {
            await shell.trashItem(source);
          } catch (error) {
            await fs.rm(destination!, { recursive: true, force: true });
            throw error;
          }
        }
        staged = undefined;
      }
      committed = true;
    } catch (error) {
      if (backup) {
        try {
          await fs.rename(backup, destination!);
          backup = undefined;
        } catch {
          throw new WorkspaceToolError(
            'partial_failure',
            `Operation failed; original destination remains at ${backup}. Source: ${source}. ${String(error)}`,
          );
        }
      }
      throw error;
    } finally {
      if (staged) await fs.rm(staged, { recursive: true, force: true });
      if (committed) await this.refresh(plan);
    }
    if (backup) {
      // Keep replacement recovery available in the trash too.
      try {
        await shell.trashItem(backup);
      } catch {
        return {
          operation: plan.operation,
          source,
          destination,
          files: plan.files,
          summary: `${plan.summary} Original destination retained at ${backup}; trash failed.`,
        };
      }
    }
    return {
      operation: plan.operation,
      source,
      destination,
      files: plan.files,
      summary: plan.summary,
      ...(input.operation === 'delete' ? { deletion: 'trash' as const } : {}),
    };
  }

  private async refresh(plan: PathOperationPlan): Promise<void> {
    if (plan.destination && ['move', 'rename'].includes(plan.operation)) {
      AppStorage.moveFileAuthorization(
        this.context,
        plan.source,
        plan.destination,
      );
    }
    if (plan.destination && plan.overwrittenFiles > 0)
      this.context.webContents.send('from:path:deleted', {
        path: plan.destination,
      });
    if (plan.operation === 'delete')
      this.context.webContents.send('from:path:deleted', { path: plan.source });
    else if (plan.operation !== 'copy')
      this.context.webContents.send('from:path:renamed', {
        oldPath: plan.source,
        newPath: plan.destination,
        name: basename(plan.destination!),
      });
    const root = AppStorage.getWorkspaceRoot();
    for (const parent of new Set([
      dirname(plan.source),
      ...(plan.destination ? [dirname(plan.destination)] : []),
      ...(root ? [root] : []),
    ])) {
      try {
        this.context.webContents.send('from:folder:opened', {
          path: parent,
          tree: await AppStorage.readDirectory(parent),
        });
      } catch {
        /* Mutation succeeded; a later tree refresh can recover. */
      }
    }
  }
}
