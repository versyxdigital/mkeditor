import { promises as fs } from 'fs';
import type { BrowserWindow } from 'electron';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { AppStorage } from '../src/app/lib/AppStorage';
import { createDirectoryLink } from './utils/directoryLink';
const nativeFs = jest.requireActual('fs') as typeof import('fs');

let root: string;
let outside: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'mkeditor-guard-')));
  outside = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'mkeditor-guard-outside-')),
  );
  AppStorage.setWorkspaceRoot(root);
});

it.each(['validation', 'write', 'publication', 'fallback', 'cleanup'] as const)(
  'rejects an image parent swapped during %s without changing outside files',
  async (phase) => {
    const parent = join(root, 'assets');
    const parked = join(root, 'parked');
    await fs.mkdir(parent);
    await fs.writeFile(join(outside, 'private.md'), 'private');
    const context = {
      webContents: { send: jest.fn() },
    } as unknown as BrowserWindow;
    let swapped = false;
    let blocked: string | undefined;
    let temporary: string | undefined;
    const swap = () => {
      if (swapped) return;
      const staged = nativeFs
        .readdirSync(parent)
        .find((name) => name.startsWith('.mkeditor-image-'));
      try {
        nativeFs.renameSync(parent, parked);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          phase !== 'write' ||
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')
        )
          throw error;
        blocked = code;
        return;
      }
      swapped = true;
      temporary = staged;
      createDirectoryLink(outside, parent);
      if (temporary)
        nativeFs.writeFileSync(join(outside, temporary), 'outside temporary');
    };
    if (phase === 'validation') {
      const validate = AppStorage.assertInWorkspace.bind(AppStorage);
      jest
        .spyOn(AppStorage, 'assertInWorkspace')
        .mockImplementation(async (...args) => {
          const canonical = await validate(...args);
          swap();
          return canonical;
        });
    } else if (phase === 'write') {
      const write = nativeFs.write;
      jest.spyOn(nativeFs, 'write').mockImplementation((...args) => {
        swap();
        return Reflect.apply(write, undefined, args);
      });
    } else if (phase === 'publication') {
      const guard = AppStorage.workspaceMutationGuard();
      const write = guard.writeNew.bind(guard);
      jest.spyOn(AppStorage, 'workspaceMutationGuard').mockReturnValue(guard);
      jest.spyOn(guard, 'writeNew').mockImplementation(async (...args) => {
        await write(...args);
        swap();
      });
    } else {
      const link = nativeFs.linkSync;
      jest.spyOn(nativeFs, 'linkSync').mockImplementation((...args) => {
        if (phase === 'cleanup') link(...args);
        swap();
        if (phase === 'fallback')
          throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
      });
    }
    const result = await AppStorage.writePastedImage(
      context,
      join(root, 'source.md'),
      'assets',
      new Uint8Array([1, 2, 3]),
      'png',
    );
    expect(swapped).toBe(blocked === undefined);
    expect(result.ok).toBe(blocked !== undefined);
    if (blocked) {
      expect(process.platform).toBe('win32');
      expect(['EPERM', 'EACCES', 'EBUSY']).toContain(blocked);
      expect(phase).toBe('write');
    }
    if (result.ok)
      expect([...(await fs.readFile(result.path))]).toEqual([1, 2, 3]);
    expect(await fs.readFile(join(outside, 'private.md'), 'utf8')).toBe(
      'private',
    );
    expect((await fs.readdir(outside)).sort()).toEqual(
      ['private.md', ...(temporary ? [temporary] : [])].sort(),
    );
    if (temporary)
      expect(await fs.readFile(join(outside, temporary), 'utf8')).toBe(
        'outside temporary',
      );
    expect(context.webContents.send.mock.calls.length).toBe(blocked ? 1 : 0);
  },
);

it('publishes an image with an exclusive copy when hard links are unavailable', async () => {
  jest.spyOn(nativeFs, 'linkSync').mockImplementation(() => {
    throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
  });
  const context = {
    webContents: { send: jest.fn() },
  } as unknown as BrowserWindow;
  const result = await AppStorage.writePastedImage(
    context,
    join(root, 'source.md'),
    'assets/nested',
    new Uint8Array([4, 5, 6]),
    'png',
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect([...(await fs.readFile(result.path))]).toEqual([4, 5, 6]);
  expect(await fs.readdir(join(root, 'assets', 'nested'))).toEqual([
    basename(result.path),
  ]);
});
afterEach(async () => {
  jest.restoreAllMocks();
  AppStorage.setWorkspaceRoot(null);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

it.each(['junction', 'directory'] as const)(
  'rejects a parent replaced by a %s before each mutation',
  async (replacement) => {
    for (const operation of [
      'mkdir',
      'write',
      'copy',
      'rename',
      'remove',
    ] as const) {
      const parent = join(root, operation);
      const parked = join(root, `${operation}-parked`);
      await fs.mkdir(parent);
      await fs.writeFile(join(parent, 'original.md'), 'original');
      const guard = AppStorage.workspaceMutationGuard();
      guard.capture(join(parent, 'original.md'));
      guard.capture(join(parent, 'new', 'file.md'));
      await fs.rename(parent, parked);
      if (replacement === 'junction') createDirectoryLink(outside, parent);
      else await fs.mkdir(parent);
      await fs.writeFile(join(parent, 'original.md'), 'replacement');
      const mutate = () => {
        switch (operation) {
          case 'mkdir':
            return guard.createParents(join(parent, 'new', 'file.md'));
          case 'write':
            return guard.writeNew(join(parent, 'new.md'), Buffer.from('new'));
          case 'copy':
            return guard.copy(
              join(parked, 'original.md'),
              join(parent, 'new.md'),
            );
          case 'rename':
            return guard.rename(
              join(parent, 'original.md'),
              join(root, 'moved.md'),
            );
          case 'remove':
            return guard.remove(join(parent, 'original.md'));
        }
      };
      await expect(Promise.resolve().then(mutate)).rejects.toThrow(
        /changed|symbolic/,
      );
      expect(await fs.readFile(join(parent, 'original.md'), 'utf8')).toBe(
        'replacement',
      );
      expect(await fs.readdir(parent)).toEqual(['original.md']);
      expect(await fs.readFile(join(parked, 'original.md'), 'utf8')).toBe(
        'original',
      );
      expect(nativeFs.existsSync(join(root, 'moved.md'))).toBe(false);
    }
  },
);

it.each(['write', 'copy'] as const)(
  'pins %s I/O to the opened file when its parent is swapped while the write is pending',
  async (operation) => {
    const parent = join(root, 'work');
    const parked = join(root, 'parked');
    const target = join(parent, 'staged.bin');
    const source = join(root, 'source.bin');
    await fs.mkdir(parent);
    await fs.writeFile(source, 'original bytes');
    await fs.writeFile(join(outside, 'staged.bin'), 'outside bytes');
    const guard = AppStorage.workspaceMutationGuard();
    guard.capture(target);
    guard.capture(source);
    const write = nativeFs.write;
    let swapped = false;
    let blocked: string | undefined;
    jest.spyOn(nativeFs, 'write').mockImplementation((...args) => {
      if (!swapped) {
        try {
          nativeFs.renameSync(parent, parked);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            process.platform !== 'win32' ||
            !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')
          )
            throw error;
          blocked = code;
        }
        if (!blocked) {
          swapped = true;
          createDirectoryLink(outside, parent);
        }
      }
      return Reflect.apply(write, undefined, args);
    });
    const error = await (
      operation === 'write'
        ? guard.writeNew(target, Buffer.from('original bytes'))
        : guard.copy(source, target)
    ).then(
      () => null,
      (error: Error) => error,
    );
    if (swapped) expect(error?.message).toMatch(/changed|symbolic/);
    else {
      expect(process.platform).toBe('win32');
      expect(['EPERM', 'EACCES', 'EBUSY']).toContain(blocked);
      expect(error).toBeNull();
    }
    expect(
      await fs.readFile(join(swapped ? parked : parent, 'staged.bin'), 'utf8'),
    ).toBe('original bytes');
    expect(await fs.readFile(join(outside, 'staged.bin'), 'utf8')).toBe(
      'outside bytes',
    );
  },
);
