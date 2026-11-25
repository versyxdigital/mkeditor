import {
  closeSync,
  chmodSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  read,
  renameSync,
  rmdirSync,
  unlinkSync,
  write,
  promises as fs,
  type Stats,
} from 'fs';
import { dirname, isAbsolute, join, relative, sep } from 'path';

type DirectoryIdentity = { dev: number; ino: number; birthtimeMs: number };

/** Records canonical directory identities across awaits; mutations never await
 * between checking their parents and opening/renaming/unlinking an entry. */
export class WorkspaceMutationGuard {
  private readonly directories = new Map<string, DirectoryIdentity>();

  constructor(
    readonly root: string,
    private readonly verify: (
      directory: string,
      expected?: DirectoryIdentity,
    ) => DirectoryIdentity,
  ) {
    this.directories.set(root, verify(root));
  }

  private parents(path: string, phase: 'capture' | 'verify' | 'create'): void {
    const rel = relative(this.root, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
      throw new Error('Mutation path is outside the workspace.');
    this.verify(this.root, this.directories.get(this.root));
    if (rel === '') {
      if (phase === 'capture') return;
      throw new Error('Cannot mutate the workspace root.');
    }
    let directory = this.root;
    for (const part of relative(this.root, dirname(path))
      .split(sep)
      .filter(Boolean)) {
      directory = join(directory, part);
      const expected = this.directories.get(directory);
      if (!lstatSync(directory, { throwIfNoEntry: false })) {
        if (phase === 'capture' && !expected) return;
        if (phase !== 'create' || expected)
          throw new Error(`Workspace directory disappeared: ${directory}`);
        mkdirSync(directory);
      }
      this.directories.set(directory, this.verify(directory, expected));
    }
  }

  capture(path: string): void {
    this.parents(path, 'capture');
  }

  parent(path: string): void {
    this.parents(path, 'verify');
  }

  createParents(path: string): void {
    this.parents(path, 'create');
  }

  directory(path: string): void {
    this.parent(join(path, '.mkeditor-guard'));
  }

  inspect(path: string): Stats | undefined {
    this.parent(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error(`Symbolic link changed during mutation: ${path}`);
    if (stat?.isDirectory()) this.directory(path);
    return stat;
  }

  rename(source: string, destination: string): void {
    if (!this.inspect(source))
      throw new Error(`Mutation source disappeared: ${source}`);
    this.parent(destination);
    if (lstatSync(destination, { throwIfNoEntry: false }))
      throw Object.assign(new Error('Destination already exists'), {
        code: 'EEXIST',
      });
    renameSync(source, destination);
  }

  /** Highest verified directory on the source volume, for native trash staging. */
  volumeRoot(path: string): string {
    const stat = this.inspect(path);
    if (!stat) throw new Error(`Mutation source disappeared: ${path}`);
    let directory = this.root;
    for (const part of [
      '',
      ...relative(this.root, dirname(path)).split(sep).filter(Boolean),
    ]) {
      if (part) directory = join(directory, part);
      this.directory(directory);
      if (lstatSync(directory).dev === stat.dev) return directory;
    }
    throw new Error('Cannot stage a mount root for trash.');
  }

  removeEmptyDirectory(path: string): void {
    this.directory(path);
    rmdirSync(path);
  }

  private openSource(path: string): number {
    const stat = this.inspect(path);
    if (!stat?.isFile()) throw new Error(`Not a regular file: ${path}`);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      if (
        !opened.isFile() ||
        opened.dev !== stat.dev ||
        opened.ino !== stat.ino
      )
        throw new Error(`File changed while opening: ${path}`);
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    return fd;
  }

  private async writeBytes(fd: number, bytes: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      const count = await new Promise<number>((resolve, reject) =>
        write(
          fd,
          bytes,
          offset,
          bytes.length - offset,
          null,
          (error, written) => (error ? reject(error) : resolve(written)),
        ),
      );
      if (!count) throw new Error('File write made no progress.');
      offset += count;
    }
  }

  async writeNew(
    path: string,
    bytes: Uint8Array,
    mode?: number,
  ): Promise<void> {
    this.parent(path);
    const fd = openSync(path, 'wx', mode);
    try {
      // The descriptor remains attached to this file even if its parent moves.
      await this.writeBytes(fd, bytes);
    } finally {
      closeSync(fd);
    }
    this.inspect(path);
  }

  async copy(source: string, destination: string): Promise<void> {
    const stat = this.inspect(source);
    if (!stat) throw new Error(`Copy source disappeared: ${source}`);
    this.parent(destination);
    if (stat.isDirectory()) {
      this.directory(source);
      mkdirSync(destination);
      this.directory(destination);
      const names = await fs.readdir(source);
      this.directory(source);
      for (const name of names)
        await this.copy(join(source, name), join(destination, name));
      this.directory(destination);
      chmodSync(destination, stat.mode);
      return;
    }
    const input = this.openSource(source);
    let output: number | undefined;
    try {
      this.parent(destination);
      output = openSync(destination, 'wx', stat.mode);
      const buffer = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const count = await new Promise<number>((resolve, reject) =>
          read(input, buffer, 0, buffer.length, null, (error, bytes) =>
            error ? reject(error) : resolve(bytes),
          ),
        );
        if (!count) break;
        await this.writeBytes(output, buffer.subarray(0, count));
      }
    } finally {
      closeSync(input);
      if (output !== undefined) closeSync(output);
    }
    this.parent(source);
    this.inspect(destination);
  }

  async remove(path: string): Promise<void> {
    const stat = this.inspect(path);
    if (!stat) return;
    if (stat.isDirectory()) {
      this.directory(path);
      for (const name of await fs.readdir(path))
        await this.remove(join(path, name));
      this.removeEmptyDirectory(path);
    } else {
      this.parent(path);
      unlinkSync(path);
    }
  }
}
