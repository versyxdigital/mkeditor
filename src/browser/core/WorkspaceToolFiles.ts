import type { BridgeManager } from './BridgeManager';
import type {
  PathOperationInput,
  PathOperationPlan,
  WorkspaceOperationResult,
  WorkspaceRequest,
  WorkspaceTextChange,
} from '../../app/interfaces/WorkspaceTools';
import type { ToolConfirmPreview } from '../../app/interfaces/Assistant';
import {
  resolveAgentPath,
  withinWorkspacePath,
  WorkspaceToolError,
} from '../../app/shared/workspacePaths';

interface TextPlan {
  root: string;
  changes: Array<
    WorkspaceTextChange & { before: string; originalPath: string }
  >;
  matches: number;
}

/** Buffer-aware renderer side of the existing native filesystem bridge. */
export class WorkspaceToolFiles {
  private readonly pathPlans = new WeakMap<
    object,
    { plan: PathOperationPlan; dirty: string[]; links?: TextPlan }
  >();
  private readonly textPlans = new WeakMap<object, TextPlan>();
  private readonly editorTargets = new WeakMap<
    object,
    { path: string; model: unknown; value: string; root: string }
  >();
  private readonly pinnedPaths = new WeakMap<
    object,
    { path: string; root: string }
  >();
  constructor(
    readonly bridge: BridgeManager,
    private readonly formatPreview: (text: string) => string,
  ) {}

  async pinPath(args: object, path: string): Promise<string> {
    const resolved = await this.resolve(path);
    this.pinnedPaths.set(args, { path: resolved, root: this.root() });
    return resolved;
  }

  async pinnedPath(args: object, fallback: string): Promise<string> {
    const pinned = this.pinnedPaths.get(args);
    this.pinnedPaths.delete(args);
    if (!pinned) return this.resolve(fallback);
    if (pinned.root !== this.root())
      throw new WorkspaceToolError(
        'workspace_changed',
        'Workspace changed after preview.',
      );
    return pinned.path;
  }

  getTextPreview(args: object, side: 'before' | 'after'): string | undefined {
    const change = this.textPlans.get(args)?.changes[0];
    return change
      ? side === 'before'
        ? change.before
        : change.content
      : undefined;
  }

  root(): string {
    const root = this.bridge.fileTreeManager.getSnapshot().treeRoot;
    if (!root)
      throw new WorkspaceToolError(
        'no_workspace',
        'Open a workspace folder first.',
      );
    return root;
  }

  async request<T>(request: WorkspaceRequest): Promise<T> {
    if (!window.mked?.workspaceOperation)
      throw new WorkspaceToolError(
        'unavailable',
        'Workspace tools require the desktop filesystem bridge.',
      );
    const result = await window.mked.workspaceOperation(request);
    if (!result.ok) throw new WorkspaceToolError(result.error, result.message);
    return result.value as T;
  }

  async resolve(path: string): Promise<string> {
    return this.request<string>({
      action: 'resolve',
      path: resolveAgentPath(this.root(), path),
    });
  }

  dirtyUnder(path: string): string[] {
    return this.bridge.fileManager
      .getSnapshot()
      .tabs.filter((tab) => tab.dirty && withinWorkspacePath(tab.path, path))
      .map((tab) => tab.path);
  }

  async preparePath(
    args: object,
    input: PathOperationInput,
    updateLinks = true,
  ): Promise<ToolConfirmPreview> {
    const plan = await this.request<PathOperationPlan>({
      action: 'prepare-path',
      input,
    });
    const dirty = this.dirtyUnder(plan.source);
    if (plan.operation === 'copy' && dirty.length)
      throw new WorkspaceToolError(
        'unsaved_changes',
        `Save unsaved source tabs before copying: ${dirty.join(', ')}`,
      );
    if (plan.operation === 'delete' && dirty.length)
      throw new WorkspaceToolError(
        'unsaved_changes',
        `Save or close unsaved tabs before deleting: ${dirty.join(', ')}`,
      );
    if (plan.destination && this.dirtyUnder(plan.destination).length)
      throw new WorkspaceToolError(
        'unsaved_changes',
        `The destination contains unsaved tabs: ${plan.destination}`,
      );
    const links =
      updateLinks &&
      plan.destination &&
      ['move', 'rename'].includes(plan.operation)
        ? await this.planLinks(plan.source, plan.destination)
        : undefined;
    this.pathPlans.set(args, { plan, dirty, links });
    return {
      kind: 'operation',
      after: '',
      summary:
        plan.summary +
        (links
          ? ` Update ${links.matches} link(s) in ${links.changes.length} file(s).`
          : ''),
      detail:
        (dirty.length
          ? `Unsaved edits in ${dirty.length} open tab(s) will be preserved${plan.operation === 'copy' ? ' in the source tabs; copies use disk content' : ' at the new paths'}: ${dirty.join(', ')}`
          : `${plan.files} source file(s); ${plan.overwrittenFiles} destination file(s) replaced.`) +
        (links ? this.textDetail(links) : ''),
      path: plan.source,
    };
  }

  async executePath(
    args: object,
    input: PathOperationInput,
    updateLinks = true,
  ): Promise<WorkspaceOperationResult> {
    if (!this.pathPlans.has(args))
      await this.preparePath(args, input, updateLinks);
    const { plan, links } = this.pathPlans.get(args)!;
    this.pathPlans.delete(args);
    if (
      (['delete', 'copy'].includes(plan.operation) &&
        this.dirtyUnder(plan.source).length) ||
      (plan.destination && this.dirtyUnder(plan.destination).length)
    )
      throw new WorkspaceToolError(
        'unsaved_changes',
        'An affected tab has unsaved changes. Save it before retrying.',
      );
    if (links) await this.verifyBuffers(links);
    const result = await this.request<WorkspaceOperationResult>({
      action: 'execute-path',
      id: plan.id,
    });
    if (links?.changes.length) {
      try {
        await this.applyTextPlan(links, true);
      } catch (error) {
        throw new WorkspaceToolError(
          'partial_failure',
          `${result.summary} The path operation completed, but link updates failed: ${String(error)}. Retry update_links with oldPath=${plan.source} and newPath=${plan.destination}.`,
        );
      }
    }
    // Native rename/deletion notifications update tabs and references. Notify the
    // inventory too even when affected folders were never loaded in the tree.
    this.bridge.fileTreeManager.workspaceFilesChanged(
      plan.source,
      ...(plan.destination ? [plan.destination] : []),
    );
    return {
      ...result,
      ...(links
        ? {
            updatedFiles: links.changes.map((change) => change.path),
            updatedLinks: links.matches,
          }
        : {}),
    };
  }

  async read(path: string): Promise<{ path: string; content: string }> {
    path = await this.resolve(path);
    const model = this.bridge.fileManager.models.get(path);
    return model
      ? { path, content: model.getValue() }
      : this.request({ action: 'read-text', path });
  }

  async list(subpath?: string): Promise<string[]> {
    const root = this.root();
    const scope = subpath ? await this.resolve(subpath) : root;
    return (await this.bridge.fileTreeManager.listWorkspaceFiles(true)).filter(
      (path) => withinWorkspacePath(path, scope),
    );
  }

  private async makeTextPlan(
    transform: (
      content: string,
      path: string,
    ) =>
      | { content: string; matches: number; path?: string }
      | Promise<{ content: string; matches: number; path?: string }>,
    paths?: string[],
  ): Promise<TextPlan> {
    const root = this.root();
    const listing = paths
      ? await Promise.all(paths.map((path) => this.resolve(path)))
      : await this.list();
    const plan: TextPlan = { root, changes: [], matches: 0 };
    let total = 0;
    for (const path of [...new Set(listing)]) {
      let disk: { path: string; content: string };
      try {
        disk = await this.request({ action: 'read-text', path });
      } catch (error) {
        if (
          ['binary_file', 'file_too_large'].includes(
            (error as WorkspaceToolError).code,
          ) &&
          !paths
        )
          continue;
        throw error;
      }
      const model = this.bridge.fileManager.models.get(disk.path);
      const before = model?.getValue() ?? disk.content;
      const result = await transform(before, disk.path);
      const eol = model?.getEOL?.();
      if (eol) result.content = result.content.replace(/\r\n|\r|\n/g, eol);
      if (result.content === before) continue;
      total += before.length + result.content.length;
      if (plan.changes.length >= 500 || total > 12 * 1024 * 1024)
        throw new WorkspaceToolError(
          'batch_too_large',
          'Narrow the operation to at most 500 files and 12 MiB of text. No files were changed.',
        );
      plan.changes.push({
        path: await this.resolve(result.path ?? disk.path),
        originalPath: disk.path,
        expected: disk.content,
        before,
        content: result.content,
      });
      plan.matches += result.matches;
    }
    if (root !== this.root())
      throw new WorkspaceToolError(
        'workspace_changed',
        'Workspace changed while preparing the operation.',
      );
    return plan;
  }

  private textDetail(plan: TextPlan): string {
    const dirty = plan.changes
      .filter((change) => this.dirtyUnder(change.originalPath).length)
      .map((change) => change.originalPath);
    return ` ${plan.changes.length} file(s), ${plan.matches} match(es).${dirty.length ? ` Includes unsaved edits that will be saved in ${dirty.length} tab(s): ${dirty.join(', ')}.` : ''}`;
  }

  private async verifyBuffers(plan: TextPlan, moved = false): Promise<void> {
    if (this.root() !== plan.root)
      throw new WorkspaceToolError(
        'workspace_changed',
        'Workspace changed after preview.',
      );
    for (const change of plan.changes) {
      const model = this.bridge.fileManager.models.get(
        moved ? change.path : change.originalPath,
      );
      if (model && model.getValue() !== change.before)
        throw new WorkspaceToolError(
          'stale_plan',
          `Unsaved buffer changed after preview: ${change.originalPath}`,
        );
    }
  }

  private async applyTextPlan(
    plan: TextPlan,
    moved = false,
  ): Promise<{ paths: string[]; summary: string }> {
    await this.verifyBuffers(plan, moved);
    const result = await this.request<{ paths: string[]; summary: string }>({
      action: 'write-batch',
      changes: plan.changes.map(({ path, expected, content }) => ({
        path,
        expected,
        content,
      })),
    });
    this.updateBuffers(plan);
    this.bridge.fileTreeManager.workspaceFilesChanged(...result.paths);
    return result;
  }

  private async planLinks(
    oldPath: string,
    newPath: string,
    alreadyMoved = false,
  ): Promise<TextPlan> {
    const { rewriteWorkspaceLinks, remapWorkspacePath } =
      await import('./workspaceMarkdown');
    return this.makeTextPlan(
      (content, path) =>
        rewriteWorkspaceLinks(
          content,
          alreadyMoved ? remapWorkspacePath(path, newPath, oldPath) : path,
          oldPath,
          newPath,
        ),
      (await this.list()).filter(
        (path) =>
          /\.(?:md|markdown|mdown)$/i.test(path) &&
          (alreadyMoved || !withinWorkspacePath(path, newPath)),
      ),
    );
  }

  async links(
    args: object,
    oldPath: string,
    newPath: string,
    dryRun = true,
    prepare = false,
  ): Promise<unknown> {
    const oldResolved = await this.resolve(oldPath),
      newResolved = await this.resolve(newPath);
    let plan = this.textPlans.get(args);
    if (!plan) plan = await this.planLinks(oldResolved, newResolved, true);
    // Standalone update_links is used AFTER a move. The workspace's current
    // document locations are authoritative; do not move files from this tool.
    for (const change of plan.changes) change.path = change.originalPath;
    this.textPlans.set(args, plan);
    if (prepare)
      return {
        kind: 'operation',
        after: '',
        summary: `Update relative links from ${oldResolved} to ${newResolved}.`,
        detail: this.textDetail(plan),
        path: oldResolved,
      };
    if (dryRun) return this.planResult('update_links', plan);
    this.textPlans.delete(args);
    return {
      operation: 'update_links',
      ...(await this.applyTextPlan(plan)),
      matches: plan.matches,
    };
  }

  private planResult(operation: string, plan: TextPlan) {
    return {
      operation,
      dryRun: true,
      files: plan.changes.map((change) => ({
        path: change.path,
        before: change.before.slice(0, 600),
        after: change.content.slice(0, 600),
      })),
      matches: plan.matches,
      truncated: plan.changes.some(
        (change) => change.before.length > 600 || change.content.length > 600,
      ),
      summary: `${plan.changes.length} file(s), ${plan.matches} match(es); no files changed.`,
    };
  }

  async replace(
    args: object,
    options: {
      find: string;
      replace: string;
      regex?: boolean;
      paths?: string[];
      dryRun?: boolean;
    },
    prepare = false,
  ): Promise<unknown> {
    if (!options.find)
      throw new WorkspaceToolError(
        'invalid_arguments',
        'find must not be empty.',
      );
    let expression: RegExp;
    try {
      expression = new RegExp(
        options.regex
          ? options.find
          : options.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'g',
      );
    } catch {
      throw new WorkspaceToolError(
        'invalid_regex',
        'Invalid regular expression.',
      );
    }
    let plan = this.textPlans.get(args);
    if (!plan)
      plan = await this.makeTextPlan(async (content) => {
        if (options.regex) {
          const result = await this.request<{ content: string; count: number }>(
            {
              action: 'regex-text',
              content,
              query: options.find,
              replacement: options.replace,
            },
          );
          return { content: result.content, matches: result.count };
        }
        let matches = 0;
        const next = content.replace(expression, () => {
          matches++;
          return options.replace;
        });
        return { content: next, matches };
      }, options.paths);
    this.textPlans.set(args, plan);
    if (prepare)
      return {
        kind: 'operation',
        after: '',
        summary: `Replace ${JSON.stringify(options.find)} with ${JSON.stringify(options.replace)} across workspace files.`,
        detail: this.textDetail(plan),
      };
    if (options.dryRun !== false)
      return this.planResult('find_and_replace', plan);
    this.textPlans.delete(args);
    return {
      operation: 'find_and_replace',
      ...(await this.applyTextPlan(plan)),
      matches: plan.matches,
    };
  }

  async search(options: {
    query: string;
    regex?: boolean;
    caseSensitive?: boolean;
    subpath?: string;
    maxResults?: number;
  }): Promise<unknown> {
    if (!options.query)
      throw new WorkspaceToolError(
        'invalid_arguments',
        'query must not be empty.',
      );
    const maxResults = Math.min(500, Math.max(1, options.maxResults ?? 100));
    let expression: RegExp;
    try {
      expression = new RegExp(
        options.regex
          ? options.query
          : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options.caseSensitive ? 'g' : 'gi',
      );
    } catch {
      throw new WorkspaceToolError(
        'invalid_regex',
        'Invalid regular expression.',
      );
    }
    const matches: Array<{ file: string; line: number; snippet: string }> = [];
    let skipped = 0;
    for (const path of await this.list(options.subpath)) {
      let content: string;
      try {
        content = (await this.read(path)).content;
      } catch (error) {
        if (
          ['binary_file', 'file_too_large'].includes(
            (error as WorkspaceToolError).code,
          )
        ) {
          skipped++;
          continue;
        }
        throw error;
      }
      const lines = content.split(/\r\n|\r|\n/);
      if (options.regex) {
        const found = await this.request<{
          matches: Array<{ index: number; text: string }>;
          truncated: boolean;
        }>({
          action: 'regex-text',
          content,
          query: options.query,
          caseSensitive: options.caseSensitive ?? false,
          limit: maxResults - matches.length + 1,
        });
        let line = 0,
          offset = 0;
        for (const match of found.matches) {
          while (
            line < lines.length - 1 &&
            offset + lines[line].length < match.index
          ) {
            offset += lines[line].length;
            offset += content.slice(offset, offset + 2) === '\r\n' ? 2 : 1;
            line++;
          }
          if (matches.length >= maxResults)
            return {
              operation: 'search_files',
              matches,
              truncated: true,
              skipped,
              summary: `At least ${matches.length} matches; result limit reached.`,
            };
          const column = match.index - offset;
          matches.push({
            file: path,
            line: line + 1,
            snippet: lines[line].slice(Math.max(0, column - 80), column + 160),
          });
        }
        if (found.truncated)
          return {
            operation: 'search_files',
            matches,
            truncated: true,
            skipped,
          };
        continue;
      }
      for (let line = 0; line < lines.length; line++) {
        expression.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = expression.exec(lines[line]))) {
          if (matches.length >= maxResults)
            return {
              operation: 'search_files',
              matches,
              truncated: true,
              skipped,
              summary: `At least ${matches.length} matches; result limit reached.`,
            };
          matches.push({
            file: path,
            line: line + 1,
            snippet: lines[line].slice(
              Math.max(0, match.index - 80),
              match.index + 160,
            ),
          });
          if (!match[0]) expression.lastIndex++;
        }
      }
    }
    return {
      operation: 'search_files',
      matches,
      truncated: false,
      skipped,
      summary: `${matches.length} match(es).`,
    };
  }

  async checkLinks(subpath?: string): Promise<unknown> {
    const { parseWorkspaceMarkdown, internalLinkTarget } =
      await import('./workspaceMarkdown');
    const broken: Array<{
      file: string;
      line: number;
      target: string;
      reason: string;
    }> = [];
    let truncated = false;
    for (const path of (await this.list(subpath)).filter((path) =>
      /\.md$/i.test(path),
    )) {
      const { content } = await this.read(path);
      for (const link of parseWorkspaceMarkdown(content).links) {
        const target = internalLinkTarget(path, link.destination);
        if (!target) continue;
        try {
          const resolved = await this.resolve(target.path);
          const info = await this.request<{ exists: boolean; type?: string }>({
            action: 'info',
            path: resolved,
          });
          if (!info.exists)
            throw new WorkspaceToolError('not_found', 'Missing target.');
          if (target.anchor && info.type === 'file') {
            const headings = parseWorkspaceMarkdown(
              (await this.read(resolved)).content,
            ).headings;
            if (!headings.some((heading) => heading.anchor === target.anchor))
              throw new WorkspaceToolError(
                'broken_anchor',
                'Heading anchor not found.',
              );
          }
        } catch (error) {
          if (broken.length >= 500) {
            truncated = true;
            break;
          }
          broken.push({
            file: path,
            line: link.line,
            target: link.destination,
            reason: (error as WorkspaceToolError).code ?? 'unreadable_target',
          });
        }
      }
      if (truncated) break;
    }
    return {
      operation: 'check_links',
      broken,
      truncated,
      summary: `${broken.length} broken internal link(s).`,
    };
  }

  async prepareEdit(
    args: object,
    path: string,
    transform: (content: string) => string,
    summary: string,
  ): Promise<ToolConfirmPreview> {
    const plan = await this.makeTextPlan(
      (content) => ({ content: transform(content), matches: 1 }),
      [path],
    );
    this.textPlans.set(args, plan);
    return {
      kind: 'edit',
      path: await this.resolve(path),
      before: this.formatPreview(plan.changes[0]?.before ?? ''),
      after: this.formatPreview(plan.changes[0]?.content ?? ''),
      summary,
      detail: this.textDetail(plan),
    };
  }

  async executeEdit(
    args: object,
    path: string,
    transform: (content: string) => string,
    operation: string,
  ): Promise<unknown> {
    if (!this.textPlans.has(args))
      await this.prepareEdit(args, path, transform, operation);
    const plan = this.textPlans.get(args)!;
    this.textPlans.delete(args);
    if (
      operation === 'append_to_file' &&
      plan.changes.length === 1 &&
      plan.changes[0].before === plan.changes[0].expected
    ) {
      await this.verifyBuffers(plan);
      const change = plan.changes[0];
      const result = await this.request<{ paths: string[]; summary: string }>({
        action: 'append-text',
        path: change.path,
        expected: change.before,
        content: change.content.slice(change.before.length),
      });
      this.updateBuffers(plan);
      this.bridge.fileTreeManager.workspaceFilesChanged(...result.paths);
      return { operation, ...result };
    }
    return { operation, ...(await this.applyTextPlan(plan)) };
  }

  async prepareTab(
    args: object,
    path: string | undefined,
    operation: 'save' | 'close',
    discard = false,
  ): Promise<ToolConfirmPreview> {
    const fm = this.bridge.fileManager;
    const requested = path ?? fm.activeFile;
    if (!requested) throw new WorkspaceToolError('not_found', 'No active tab.');
    const tab =
      fm.getSnapshot().tabs.find((tab) => tab.path === requested) ||
      fm
        .getSnapshot()
        .tabs.find(
          (tab) => tab.path === resolveAgentPath(this.root(), requested),
        );
    if (!tab)
      throw new WorkspaceToolError(
        'not_found',
        `Tab is not open: ${requested}`,
      );
    if (!tab.path.startsWith('untitled-') && !tab.path.startsWith('diff://'))
      await this.resolve(tab.path);
    if (operation === 'close' && tab.dirty && !discard)
      throw new WorkspaceToolError(
        'unsaved_changes',
        'Tab has unsaved edits. Save it or explicitly set discard: true.',
      );
    const model = fm.models.get(tab.path);
    this.editorTargets.set(args, {
      path: tab.path,
      model,
      value: model?.getValue() ?? '',
      root: this.root(),
    });
    return {
      kind: 'operation',
      after: '',
      summary: `${operation === 'save' ? 'Save' : 'Close'} tab ${tab.path}.${operation === 'close' && tab.dirty ? ' Discard unsaved changes.' : operation === 'save' && tab.dirty ? ' Save the current unsaved edits.' : ''}`,
      path: tab.path,
    };
  }

  async executeTab(
    args: object,
    path: string | undefined,
    operation: 'save' | 'close',
    discard = false,
  ): Promise<unknown> {
    if (!this.editorTargets.has(args))
      await this.prepareTab(args, path, operation, discard);
    const target = this.editorTargets.get(args)!;
    this.editorTargets.delete(args);
    const fm = this.bridge.fileManager,
      model = fm.models.get(target.path);
    if (
      this.root() !== target.root ||
      model !== target.model ||
      (model?.getValue() !== target.value && model !== undefined)
    )
      throw new WorkspaceToolError(
        'stale_plan',
        'Tab content changed since preview.',
      );
    let finalPath = target.path;
    if (operation === 'save') {
      if (!(await fm.saveTab(target.path)))
        throw new WorkspaceToolError(
          'save_failed',
          'Save was cancelled or failed.',
        );
      finalPath =
        [...fm.models].find(([, model]) => model === target.model)?.[0] ??
        target.path;
      this.bridge.fileTreeManager.workspaceFilesChanged(finalPath);
    } else {
      if (!discard && this.dirtyUnder(target.path).length)
        throw new WorkspaceToolError(
          'unsaved_changes',
          'Tab has unsaved edits.',
        );
      if ((await fm.closeTab(target.path, discard)) !== 'closed')
        throw new WorkspaceToolError(
          'close_failed',
          'The tab could not be closed.',
        );
    }
    return {
      operation: operation === 'save' ? 'save_file' : 'close_tab',
      path: finalPath,
      summary: `${operation === 'save' ? 'Saved' : 'Closed'} ${finalPath}.`,
    };
  }

  private updateBuffers(plan: TextPlan): void {
    for (const change of plan.changes) {
      const model = this.bridge.fileManager.models.get(change.path);
      if (!model || model.getValue() !== change.before) continue;
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: change.content }],
        () => null,
      );
      model.pushStackElement();
      this.bridge.fileManager.recordSavedVersion(
        change.path,
        model,
        model.getValue(),
        model.getAlternativeVersionId(),
      );
    }
  }

  async createTemplate(
    args: object,
    path: string,
    content: string,
    prepare = false,
  ): Promise<unknown> {
    const resolved = await this.resolve(path);
    if (prepare) {
      const info = await this.request<{ exists: boolean }>({
        action: 'info',
        path: resolved,
      });
      if (info.exists)
        throw new WorkspaceToolError(
          'destination_exists',
          `Destination exists: ${resolved}`,
        );
      this.textPlans.set(args, {
        root: this.root(),
        matches: 1,
        changes: [
          {
            path: resolved,
            originalPath: resolved,
            expected: null,
            before: '',
            content,
          },
        ],
      });
      return {
        kind: 'create',
        path: resolved,
        after: this.formatPreview(content),
      };
    }
    if (!this.textPlans.has(args))
      await this.createTemplate(args, path, content, true);
    const plan = this.textPlans.get(args)!;
    this.textPlans.delete(args);
    const result = await this.applyTextPlan(plan);
    return { operation: 'create_from_template', path: resolved, ...result };
  }
}
