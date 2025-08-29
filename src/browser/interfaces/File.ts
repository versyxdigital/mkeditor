export interface File {
  file: string | null;
  filename: string;
  content: string;
}

export interface FileProperties {
  path: string;
  isDirectory: boolean;
  size: string;
  created: string;
  modified: string;
}

export interface RenamedPath {
  oldPath: string;
  newPath: string;
  name: string;
}
