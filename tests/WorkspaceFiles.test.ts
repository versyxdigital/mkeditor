import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { tmpdir } from 'os';
import { shell, type BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { WorkspaceFiles } from '../src/app/lib/WorkspaceFiles';
import { createDirectoryLink } from './utils/directoryLink';
import type { PathOperationInput } from '../src/app/interfaces/WorkspaceTools';
import {
  resolveAgentPath,
  validateWorkspaceName,
  toolFailure,
} from '../src/app/shared/workspacePaths';

jest.mock('electron', () => ({ shell: { trashItem: jest.fn() } }));

let root: string;
let files: WorkspaceFiles;
let sent: jest.Mock;
beforeEach(async () => {
  jest.clearAllMocks();
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'mkeditor-tools-')));
  AppStorage.setWorkspaceRoot(root);
  sent = jest.fn();
  files = new WorkspaceFiles({
    webContents: { send: sent },
  } as unknown as BrowserWindow);
  (shell.trashItem as jest.Mock).mockImplementation(async (path) => {
    // Simulate trash using a different temporary fixture directory; never invoke the OS trash in unit tests.
    await fs.rename(
      path,
      join(root, '.trashed-' + (await fs.readdir(root)).length),
    );
  });
});
afterEach(async () => {
  AppStorage.setWorkspaceRoot(null);
  await fs.rm(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});
async function run(input: PathOperationInput) {
  const plan = await files.prepare(input);
  return files.request({ action: 'execute-path', id: plan.id });
}

it('moves a folder with contents and creates missing destination parents', async () => {
  await fs.mkdir(join(root, 'it'));
  await fs.writeFile(join(root, 'it/introduction.md'), 'Ciao');
  const plan = await files.prepare({
    operation: 'move',
    source: 'it',
    destination: 'mkeditor/it',
  });
  expect(plan.files).toBe(1);
  expect(plan.summary).toContain('1 file(s)');
  await files.request({ action: 'execute-path', id: plan.id });
  expect(
    await fs.readFile(join(root, 'mkeditor/it/introduction.md'), 'utf8'),
  ).toBe('Ciao');
  expect(await files.info('it')).toMatchObject({ exists: false });
  expect(sent).toHaveBeenCalledWith(
    'from:path:renamed',
    expect.objectContaining({
      oldPath: join(root, 'it'),
      newPath: join(root, 'mkeditor/it'),
    }),
  );
  expect(sent).toHaveBeenCalledWith('from:folder:opened', expect.anything());
});
it('refuses collision by default and replaces only with overwrite', async () => {
  await fs.writeFile(join(root, 'a.md'), 'source');
  await fs.writeFile(join(root, 'b.md'), 'destination');
  await expect(
    run({ operation: 'move', source: 'a.md', destination: 'b.md' }),
  ).rejects.toMatchObject({ code: 'destination_exists' });
  await run({
    operation: 'move',
    source: 'a.md',
    destination: 'b.md',
    overwrite: true,
  });
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('source');
  expect(shell.trashItem).toHaveBeenCalled();
});
it('copies recursively, retains source and refuses copying/moving into itself', async () => {
  await fs.mkdir(join(root, 'it'));
  await fs.writeFile(join(root, 'it/a.md'), 'hello');
  for (const operation of ['move', 'copy'] as const) {
    await expect(
      run({ operation, source: 'it', destination: 'it/child' }),
    ).rejects.toMatchObject({ code: 'nested_destination' });
    await expect(
      run({ operation, source: 'it', destination: 'it' }),
    ).rejects.toMatchObject({ code: 'same_path' });
  }
  await run({ operation: 'copy', source: 'it', destination: 'copied' });
  expect(await fs.readFile(join(root, 'it/a.md'), 'utf8')).toBe('hello');
  expect(await fs.readFile(join(root, 'copied/a.md'), 'utf8')).toBe('hello');
});
it('renames in place and validates bare names and reserved Windows names', async () => {
  await fs.writeFile(join(root, 'a.md'), 'hello');
  for (const newName of [
    '',
    '../b.md',
    'x/y',
    'x\\y',
    'CON.md',
    'file.',
    'file ',
  ])
    await expect(
      run({ operation: 'rename', source: 'a.md', newName }),
    ).rejects.toMatchObject({ code: 'invalid_name' });
  await run({ operation: 'rename', source: 'a.md', newName: 'b.md' });
  expect(await files.info('b.md')).toMatchObject({
    exists: true,
    type: 'file',
    size: 5,
  });
});
it('requires recursive for non-empty folders and uses the OS trash after preparation', async () => {
  await fs.mkdir(join(root, 'folder'));
  await fs.writeFile(join(root, 'folder/a.md'), 'hello');
  await expect(
    run({ operation: 'delete', source: 'folder' }),
  ).rejects.toMatchObject({ code: 'not_empty' });
  expect(shell.trashItem).not.toHaveBeenCalled();
  expect(
    await run({ operation: 'delete', source: 'folder', recursive: true }),
  ).toMatchObject({ deletion: 'trash', files: 1 });
  expect(await files.info('folder')).toMatchObject({ exists: false });
});
it('rejects every outside path and refuses mutations of the workspace root', async () => {
  for (const path of ['../outside.md', join(root, '..', 'outside.md')]) {
    await expect(files.resolve(path)).rejects.toMatchObject({
      code: 'outside_workspace',
    });
    await expect(files.info(path)).rejects.toMatchObject({
      code: 'outside_workspace',
    });
  }
  for (const operation of ['move', 'rename', 'copy', 'delete'] as const)
    await expect(
      run({
        operation,
        source: '.',
        destination: 'other',
        newName: 'other',
        recursive: true,
      }),
    ).rejects.toMatchObject({ code: 'workspace_root' });
});
it('rejects symlinks that resolve outside, including ancestors of missing paths', async () => {
  const outside = await fs.mkdtemp(join(tmpdir(), 'mkeditor-tools-outside-'));
  try {
    await fs.symlink(outside, join(root, 'escape'), 'junction');
    await expect(files.info('escape')).rejects.toThrow(/outside the workspace/);
    await expect(files.resolve('escape/missing/a.md')).rejects.toThrow(
      /outside the workspace/,
    );
    expect(await fs.readdir(outside)).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});
it('rejects stale previews, reused plans and workspace switches', async () => {
  await fs.writeFile(join(root, 'a.md'), 'before');
  const plan = await files.prepare({
    operation: 'move',
    source: 'a.md',
    destination: 'b.md',
  });
  await fs.writeFile(join(root, 'a.md'), 'changed after preview');
  await expect(
    files.request({ action: 'execute-path', id: plan.id }),
  ).rejects.toMatchObject({ code: 'stale_plan' });
  await expect(
    files.request({ action: 'execute-path', id: plan.id }),
  ).rejects.toMatchObject({ code: 'stale_plan' });
  const next = await files.prepare({ operation: 'delete', source: 'a.md' });
  AppStorage.setWorkspaceRoot(null);
  await expect(
    files.request({ action: 'execute-path', id: next.id }),
  ).rejects.toMatchObject({ code: 'workspace_changed' });
});
it('keeps a destination intact if committing an overwrite fails', async () => {
  await fs.writeFile(join(root, 'a.md'), 'source');
  await fs.writeFile(join(root, 'b.md'), 'destination');
  const plan = await files.prepare({
    operation: 'move',
    source: 'a.md',
    destination: 'b.md',
    overwrite: true,
  });
  const rename = fs.rename;
  jest.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (source === join(root, 'a.md'))
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return rename(source, destination);
  });
  await expect(
    files.request({ action: 'execute-path', id: plan.id }),
  ).rejects.toMatchObject({ code: 'EACCES' });
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('destination');
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('source');
});
it('uses segment boundaries and portable validation in shared paths', () => {
  expect(resolveAgentPath('C:\\Notes', 'it/intro.md')).toBe(
    'C:\\Notes\\it\\intro.md',
  );
  expect(() =>
    resolveAgentPath('C:\\Notes', 'C:\\Notes-other\\a.md'),
  ).toThrow();
  expect(() => resolveAgentPath('/notes', '../outside.md')).toThrow();
  expect(() => validateWorkspaceName('NUL.txt')).toThrow();
  expect(
    toolFailure(Object.assign(new Error('denied'), { code: 'EPERM' })),
  ).toMatchObject({ error: 'permission_denied' });
});
it('rolls back a bulk write when a later atomic replacement fails', async () => {
  await fs.writeFile(join(root, 'a.md'), 'A');
  await fs.writeFile(join(root, 'b.md'), 'B');
  const nativeFs = jest.requireActual('fs') as typeof import('fs');
  const rename = nativeFs.renameSync;
  jest
    .spyOn(nativeFs, 'renameSync')
    .mockImplementation((source, destination) => {
      if (
        String(source).includes('.mkeditor-write-') &&
        destination === join(root, 'b.md')
      )
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return rename(source, destination);
    });
  await expect(
    files.request({
      action: 'write-batch',
      changes: [
        { path: 'a.md', expected: 'A', content: 'changed A' },
        { path: 'b.md', expected: 'B', content: 'changed B' },
      ],
    }),
  ).rejects.toMatchObject({ code: 'EACCES' });
  expect(await fs.readFile(join(root, 'a.md'), 'utf8')).toBe('A');
  expect(await fs.readFile(join(root, 'b.md'), 'utf8')).toBe('B');
  expect(
    (await fs.readdir(root)).filter((name) =>
      name.startsWith('.mkeditor-write-'),
    ),
  ).toEqual([]);
});

describe.each(['create', 'replace'] as const)(
  'batch %s parent integrity',
  (operation) => {
    it.each(['stage', 'commit'] as const)(
      'rejects a parent junction swap after %s validation without any outside write',
      async (phase) => {
        const nativeFs = jest.requireActual('fs') as typeof import('fs');
        const outside = await fs.realpath(
          await fs.mkdtemp(join(tmpdir(), 'mkeditor-batch-outside-')),
        );
        const parent = join(root, 'parent');
        const parked = join(root, 'parked');
        const target = join(parent, 'note.md');
        await fs.mkdir(parent);
        if (operation === 'replace') await fs.writeFile(target, 'original');
        await fs.writeFile(join(outside, 'note.md'), 'outside document');
        let ready = false;
        let swapped = false;
        let stagingName: string | undefined;
        const outsideWrites: string[] = [];
        const recordWrite = (path: unknown) => {
          if (
            typeof path === 'string' &&
            nativeFs.realpathSync.native(dirname(path)) === outside
          )
            outsideWrites.push(path);
          if (
            phase === 'commit' &&
            typeof path === 'string' &&
            path.includes('.mkeditor-write-')
          ) {
            stagingName = basename(path);
            ready = true;
          }
        };
        const write = fs.writeFile.bind(fs);
        jest.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
          recordWrite(args[0]);
          return write(...args);
        });
        const writeSync = nativeFs.writeFileSync;
        jest.spyOn(nativeFs, 'writeFileSync').mockImplementation((...args) => {
          recordWrite(args[0]);
          return writeSync(...args);
        });
        const read = fs.readFile.bind(fs);
        jest.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
          const content = await read(...args);
          if (
            phase === 'stage' &&
            operation === 'replace' &&
            args[0] === target
          )
            ready = true;
          return content;
        });
        const stat = fs.lstat.bind(fs);
        jest.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
          try {
            return await stat(...args);
          } finally {
            if (
              phase === 'stage' &&
              operation === 'create' &&
              args[0] === target
            )
              ready = true;
          }
        });
        const validate = AppStorage.assertInWorkspace.bind(AppStorage);
        jest
          .spyOn(AppStorage, 'assertInWorkspace')
          .mockImplementation(async (...args) => {
            const canonical = await validate(...args);
            if (ready && !swapped && args[0] === target) {
              swapped = true;
              await fs.rename(parent, parked);
              createDirectoryLink(outside, parent);
              // Cleanup must not follow the junction and remove an unrelated file.
              if (stagingName)
                writeSync(
                  join(outside, stagingName),
                  'outside staging sentinel',
                );
            }
            return canonical;
          });
        try {
          await expect(
            files.request({
              action: 'write-batch',
              changes: [
                {
                  path: target,
                  expected: operation === 'create' ? null : 'original',
                  content: 'batch content',
                },
              ],
            }),
          ).rejects.toThrow();
          expect(swapped).toBe(true);
          expect(outsideWrites).toEqual([]);
          expect(await fs.readFile(join(outside, 'note.md'), 'utf8')).toBe(
            'outside document',
          );
          expect((await fs.readdir(outside)).sort()).toEqual(
            ['note.md', ...(stagingName ? [stagingName] : [])].sort(),
          );
          if (stagingName)
            expect(await fs.readFile(join(outside, stagingName), 'utf8')).toBe(
              'outside staging sentinel',
            );
          if (operation === 'replace')
            expect(await fs.readFile(join(parked, 'note.md'), 'utf8')).toBe(
              'original',
            );
        } finally {
          await fs.rm(outside, { recursive: true, force: true });
        }
      },
    );
  },
);
it('rejects replacement of a parent by a different ordinary directory', async () => {
  const parent = join(root, 'parent');
  const target = join(parent, 'note.md');
  await fs.mkdir(parent);
  await fs.writeFile(target, 'original');
  const validate = AppStorage.assertInWorkspace.bind(AppStorage);
  let validations = 0;
  jest
    .spyOn(AppStorage, 'assertInWorkspace')
    .mockImplementation(async (...args) => {
      const canonical = await validate(...args);
      // Preparation validates once directly and once when reading the original.
      if (args[0] === target && ++validations === 3) {
        await fs.rename(parent, join(root, 'parked'));
        await fs.mkdir(parent);
        await fs.writeFile(target, 'original');
      }
      return canonical;
    });
  await expect(
    files.request({
      action: 'write-batch',
      changes: [{ path: target, expected: 'original', content: 'changed' }],
    }),
  ).rejects.toThrow('Workspace directory changed');
  expect(await fs.readFile(target, 'utf8')).toBe('original');
  expect(await fs.readFile(join(root, 'parked', 'note.md'), 'utf8')).toBe(
    'original',
  );
  expect(await fs.readdir(parent)).toEqual(['note.md']);
});
it('handles cross-device moves with staged copy and trash removal of the original', async () => {
  await fs.writeFile(join(root, 'a.md'), 'source');
  const rename = fs.rename;
  jest.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (
      source === join(root, 'a.md') &&
      destination === join(root, 'nested/b.md')
    )
      throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    return rename(source, destination);
  });
  await run({ operation: 'move', source: 'a.md', destination: 'nested/b.md' });
  expect(await fs.readFile(join(root, 'nested/b.md'), 'utf8')).toBe('source');
  expect(await files.info('a.md')).toMatchObject({ exists: false });
});
it('rejects binary edits, invalid parent names and missing sources with specific codes', async () => {
  await fs.writeFile(join(root, 'binary.dat'), Buffer.from([0, 255, 1]));
  await expect(files.readText('binary.dat')).rejects.toMatchObject({
    code: 'binary_file',
  });
  await expect(
    run({ operation: 'move', source: 'missing', destination: 'a.md' }),
  ).rejects.toMatchObject({ code: 'not_found' });
  await fs.writeFile(join(root, 'a.md'), 'hello');
  await expect(
    run({ operation: 'copy', source: 'a.md', destination: 'CON/child.md' }),
  ).rejects.toMatchObject({ code: 'invalid_name' });
  await expect(
    files.request({
      action: 'write-batch',
      changes: [{ path: 'NUL/child.md', expected: null, content: 'hello' }],
    }),
  ).rejects.toMatchObject({ code: 'invalid_name' });
});
