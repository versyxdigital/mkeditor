export type PathOperation = 'move' | 'rename' | 'copy' | 'delete';

export interface PathOperationInput {
  operation: PathOperation;
  source: string;
  destination?: string;
  newName?: string;
  overwrite?: boolean;
  recursive?: boolean;
}

export interface WorkspacePathInfo {
  path: string;
  exists: boolean;
  type?: 'file' | 'directory';
  size?: number;
  modified?: string;
  items?: number;
  files?: number;
}

export interface PathOperationPlan {
  id: string;
  operation: PathOperation;
  source: string;
  destination?: string;
  files: number;
  overwrittenFiles: number;
  summary: string;
}

export type WorkspaceRequest =
  | { action: 'export-html'; content: string }
  | { action: 'resolve'; path: string }
  | { action: 'info'; path: string }
  | { action: 'read-text'; path: string }
  | {
      action: 'regex-text';
      content: string;
      query: string;
      replacement?: string;
      caseSensitive?: boolean;
      limit?: number;
    }
  | { action: 'write-batch'; changes: WorkspaceTextChange[] }
  | { action: 'append-text'; path: string; expected: string; content: string }
  | { action: 'prepare-path'; input: PathOperationInput }
  | { action: 'execute-path'; id: string };

export interface WorkspaceTextChange {
  path: string;
  expected: string | null;
  content: string;
}

export type WorkspaceResponse =
  { ok: true; value: unknown } | { ok: false; error: string; message: string };

export interface WorkspaceOperationResult {
  operation: PathOperation;
  source: string;
  destination?: string;
  files: number;
  summary: string;
  deletion?: 'trash';
}
