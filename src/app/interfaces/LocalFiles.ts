export interface LocalWatchRequest {
  root: string | null;
  directories: string[];
  files: string[];
}

export interface LocalPathRename {
  oldPath: string;
  newPath: string;
}

export interface LocalFilesChanged {
  root: string | null;
  newRoot?: string;
  rootMissing?: boolean;
  renames: LocalPathRename[];
  missing: string[];
  directories: {
    path: string;
    tree: {
      type: 'file' | 'directory';
      name: string;
      path: string;
      hasChildren?: boolean;
    }[];
  }[];
  truncated: boolean;
}
