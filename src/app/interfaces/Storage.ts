export interface CreateFileOptions {
  id?: number | string;
  data: string;
  filePath: string;
  encoding: BufferEncoding;
}

export interface SaveFileOptions {
  id?: number | string;
  data: string;
  filePath?: string;
  encoding: BufferEncoding;
  reset?: boolean;
  openFile?: boolean;
}
