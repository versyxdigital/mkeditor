/** Path rules shared by agent tools and their native filesystem boundary. */
export class WorkspaceToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}

export function validateWorkspaceName(name: string): void {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:*?"<>|]/.test(name) ||
    Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new WorkspaceToolError(
      'invalid_name',
      `Invalid file or folder name: ${name}`,
    );
}

export function normalizeWorkspacePath(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const prefix = slashed.startsWith('//')
    ? '//'
    : slashed.startsWith('/')
      ? '/'
      : '';
  const segments: string[] = [];
  for (const part of slashed.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return prefix + segments.join('/');
}

export function workspacePathKey(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return /^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

export function withinWorkspacePath(path: string, parent: string): boolean {
  const key = workspacePathKey(path),
    root = workspacePathKey(parent).replace(/\/$/, '');
  return key === root || key.startsWith(root + '/');
}

/** Resolve literally under root. Never use basename guesses for mutations. */
export function resolveAgentPath(root: string | null, input: string): string {
  if (!root)
    throw new WorkspaceToolError(
      'no_workspace',
      'Open a workspace folder first.',
    );
  if (typeof input !== 'string' || !input || input.includes('\0'))
    throw new WorkspaceToolError(
      'invalid_path',
      'A non-empty path is required.',
    );
  const slashed = input.replace(/\\/g, '/');
  const absolute = /^(?:[a-z]:\/|\/)/i.test(slashed);
  if (/^[a-z]:[^/]/i.test(slashed))
    throw new WorkspaceToolError(
      'outside_workspace',
      'Drive-relative paths are not supported.',
    );
  // Reject traversal even if it would later re-enter the workspace.
  let depth = 0;
  if (!absolute)
    for (const segment of slashed.split('/')) {
      if (segment === '..') {
        if (--depth < 0)
          throw new WorkspaceToolError(
            'outside_workspace',
            `Path escapes the workspace: ${input}`,
          );
      } else if (segment && segment !== '.') depth++;
    }
  const result = normalizeWorkspacePath(
    absolute ? slashed : root + '/' + slashed,
  );
  if (!withinWorkspacePath(result, root))
    throw new WorkspaceToolError(
      'outside_workspace',
      `Path is outside the workspace: ${input}`,
    );
  return root.includes('\\') ? result.replace(/\//g, '\\') : result;
}

export function toolFailure(error: unknown): {
  ok: false;
  error: string;
  message: string;
} {
  const err = error as {
    code?: string;
    message?: string;
    cause?: { code?: string };
  };
  const code = err?.code ?? err?.cause?.code;
  const mapped: Record<string, string> = {
    ENOENT: 'not_found',
    EACCES: 'permission_denied',
    EPERM: 'permission_denied',
    EEXIST: 'destination_exists',
    ENOTEMPTY: 'not_empty',
    EISDIR: 'not_file',
    ENOTDIR: 'not_directory',
  };
  const message = err?.message ?? String(error);
  return {
    ok: false,
    error:
      mapped[code ?? ''] ??
      code ??
      (/outside the workspace|symbolic link/i.test(message)
        ? 'outside_workspace'
        : 'operation_failed'),
    message,
  };
}
