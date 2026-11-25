/** @jest-environment node */

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { WorkspaceFiles } from '../src/app/lib/WorkspaceFiles';
import { remapLocalPath } from '../src/app/shared/remapLocalPath';
import {
  LocalFileWatcher,
  LOCAL_WATCH_LIMITS,
} from '../src/app/lib/LocalFileWatcher';
import type { LocalFilesChanged } from '../src/app/interfaces/LocalFiles';

let base: string;
let root: string;
let watcher: LocalFileWatcher;
let changes: LocalFilesChanged[];
let context: BrowserWindow;

beforeEach(async () => {
  base = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'mkeditor-native-watch-')),
  );
  root = join(base, 'workspace');
  await fs.mkdir(root);
  AppStorage.setWorkspaceRoot(root);
  context = { webContents: { send: jest.fn() } } as unknown as BrowserWindow;
  changes = [];
  watcher = new LocalFileWatcher({
    workspaceRoot: () => AppStorage.getWorkspaceRoot(),

    canWatchFile: (path) => AppStorage.canWatchFile(context, path),

    fileIdentity: (path) => AppStorage.savedFileIdentity(context, path),

    rename: (source, destination, identity) =>
      AppStorage.followWatchedRename(context, source, destination, identity),

    missing: (path) => AppStorage.revokeFileAuthorization(context, path),

    changed: (change) => changes.push(change),
  });
});

afterEach(async () => {
  watcher.dispose();
  jest.restoreAllMocks();
  AppStorage.setWorkspaceRoot(null);
  await fs.rm(base, { recursive: true, force: true });
});

async function start(files: string[] = [], directories: string[] = []) {
  files.forEach((path) => AppStorage.authorizeFile(context, path));
  await watcher.update({ root, files, directories });
  await watcher.refresh();
  changes.length = 0;
}

test('native filesystem events refresh the explorer without renderer polling', async () => {
  await start();
  const path = join(root, 'outside.md');
  let timer: ReturnType<typeof setTimeout>;
  const event = new Promise<void>((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Native watch did not deliver the new file.')),
      5000,
    );
    const original = changes.push.bind(changes);
    changes.push = (...items) => {
      const length = original(...items);
      if (
        items.some((change) =>
          change.directories.some((dir) =>
            dir.tree.some((node) => node.path === path),
          ),
        )
      )
        resolve();
      return length;
    };
  });
  try {
    await fs.writeFile(path, 'created by the OS');
    await event;
    expect(
      changes.some((change) =>
        change.directories.some((dir) =>
          dir.tree.some((node) => node.path === path),
        ),
      ),
    ).toBe(true);
  } finally {
    clearTimeout(timer!);
  }
});

test('follows a renamed folder by identity and transfers open-file grants', async () => {
  const folder = join(root, 'old');
  await fs.mkdir(folder);
  const file = join(folder, 'draft.md');
  await fs.writeFile(file, 'saved');
  await start([file], [folder]);
  const renamed = join(root, 'renamed');
  await fs.rename(folder, renamed);
  await watcher.refresh();
  expect(changes.flatMap((change) => change.renames)).toEqual([
    { oldPath: folder, newPath: renamed },
  ]);
  expect(AppStorage.canWatchFile(context, join(renamed, 'draft.md'))).toBe(
    true,
  );
  expect(AppStorage.canWatchFile(context, file)).toBe(false);
  await watcher.refresh();
  expect(
    changes.some((change) =>
      change.directories.some((dir) => dir.path === renamed),
    ),
  ).toBe(true);
});

test('follows an open file renamed in its directory', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'same document');
  await start([file]);
  const destination = join(root, 'two.md');
  await fs.rename(file, destination);
  await watcher.refresh();
  expect(changes.flatMap((change) => change.renames)).toEqual([
    { oldPath: file, newPath: destination },
  ]);
  expect(changes.flatMap((change) => change.missing)).toEqual([]);
});

test('detects a case-only rename on every platform', async () => {
  const file = join(root, 'note.md');
  const destination = join(root, 'NOTE.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  await fs.rename(file, destination);
  await watcher.refresh();
  expect(changes.flatMap((change) => change.renames)).toEqual([
    { oldPath: file, newPath: destination },
  ]);
});

test.each([
  [
    '/workspace/old/note.md',
    '/workspace/old/',
    '/workspace/new',
    '/workspace/new/note.md',
  ],
  ['C:\\old\\draft.md', 'C:\\old\\', 'C:\\new', 'C:\\new\\draft.md'],
  ['C:/old/文档.md', 'C:/old/', 'C:\\New folder', 'C:\\New folder\\文档.md'],
  ['/file.md', '/', '/new/', '/new/file.md'],
  ['C:\\file.md', 'C:\\', 'D:\\', 'D:\\file.md'],
  ['/workspace/old/', '/workspace/old/', '/workspace/new', '/workspace/new'],
])(
  'remaps an already validated descendant without losing separators: %s',
  (path, source, destination, expected) => {
    expect(remapLocalPath(path, source, destination)).toBe(expected);
  },
);

test('keeps a selected directory alias without treating its target as deleted', async () => {
  const alias = join(base, 'alias');
  await fs.symlink(
    root,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const file = join(alias, 'note.md');
  await fs.writeFile(file, 'selected through alias');
  AppStorage.authorizeFile(context, file);
  await watcher.update({ root: alias, directories: [], files: [file] });
  await watcher.refresh();
  expect(changes.flatMap((change) => change.missing)).toEqual([]);
  expect(AppStorage.canWatchFile(context, file)).toBe(true);
});

test('retains a deleted file without confusing a replacement of the same name with its identity', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  await fs.rename(file, join(base, 'original-elsewhere.md'));
  await fs.writeFile(file, 'replacement');
  await watcher.refresh();
  expect(changes.flatMap((change) => change.renames)).toEqual([]);
  expect(changes.flatMap((change) => change.missing)).toContain(file);
  expect(AppStorage.canWatchFile(context, file)).toBe(false);
  expect(await fs.readFile(file, 'utf8')).toBe('replacement');
});

test('recognizes committed workspace batch writes rather than recovering their new inode as an external replacement', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  const workspace = new WorkspaceFiles(context);
  await watcher.duringMutation(() =>
    workspace.request({
      action: 'write-batch',
      changes: [
        { path: file, expected: 'original', content: 'confirmed tool write' },
      ],
    }),
  );
  await watcher.refresh();
  expect(changes.flatMap((change) => change.missing)).toEqual([]);
  await expect(
    AppStorage.saveFile(context, {
      filePath: file,
      data: 'next user edit',
      encoding: 'utf8',
      openFile: false,
    }),
  ).resolves.toMatchObject({ ok: true });
  expect(await fs.readFile(file, 'utf8')).toBe('next user edit');
});

test('invalidates an asynchronous scan if the workspace changes before publication', async () => {
  await start();
  const original = fs.opendir.bind(fs);
  let entered!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  jest.spyOn(fs, 'opendir').mockImplementationOnce(async (...args) => {
    const directory = await original(...args);
    entered();
    await gate;
    return directory;
  });
  await fs.writeFile(join(root, 'new.md'), 'new');
  const scan = watcher.refresh();
  await started;
  AppStorage.setWorkspaceRoot(null);
  resume();
  await scan;
  expect(changes).toEqual([]);
});

test('updates a renamed workspace root without expanding its trust boundary', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  const next = join(base, 'renamed-workspace');
  await fs.rename(root, next);
  await watcher.refresh();
  expect(AppStorage.getWorkspaceRoot()).toBe(next);
  expect(changes.at(-1)).toMatchObject({
    root,
    newRoot: next,
    renames: [{ oldPath: root, newPath: next }],
  });
  expect(AppStorage.canWatchFile(context, join(next, 'one.md'))).toBe(true);
});

test('allows an OS rename of the workspace while nested folders are being watched', async () => {
  const child = join(root, 'nested');
  const deep = join(child, 'deep');
  await fs.mkdir(deep, { recursive: true });
  const file = join(deep, 'note.md');
  await fs.writeFile(file, 'original');
  await start([file], [child, deep]);
  const destination = join(base, 'renamed-with-nested-watchers');
  await fs.rename(root, destination);
  await watcher.refresh();
  expect(changes.at(-1)?.renames).toContainEqual({
    oldPath: root,
    newPath: destination,
  });
});

test('reports a deleted root while keeping it distinct from a permission failure', async () => {
  await start();
  await fs.rm(root, { recursive: true });
  await watcher.refresh();
  expect(changes.at(-1)).toMatchObject({ rootMissing: true, missing: [root] });
});

test('does not infer a rename from ambiguous hard links', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await fs.link(file, join(root, 'alias.md'));
  await start([file]);
  await fs.unlink(file);
  await watcher.refresh();
  expect(changes.flatMap((change) => change.renames)).toEqual([]);
  expect(changes.flatMap((change) => change.missing)).toContain(file);
});

test('never watches arbitrary renderer-supplied files outside native grants', async () => {
  const outside = join(base, 'private.md');
  await fs.writeFile(outside, 'private');
  await watcher.update({ root, directories: [base], files: [outside] });
  await watcher.refresh();
  changes.length = 0;
  await fs.unlink(outside);
  await watcher.refresh();
  expect(changes).toEqual([]);
});

test('keeps external file access working without an open workspace', async () => {
  const outside = join(base, 'selected.md');
  await fs.writeFile(outside, 'selected natively');
  AppStorage.setWorkspaceRoot(null);
  AppStorage.authorizeFile(context, outside);
  await watcher.update({ root: null, directories: [], files: [outside] });
  await watcher.refresh();
  changes.length = 0;
  await fs.unlink(outside);
  await watcher.refresh();
  expect(changes.at(-1)).toMatchObject({ root: null, missing: [outside] });
});

test('does not report deleted files while an internal mutation is unresolved', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mutation = watcher.duringMutation(async () => {
    await fs.unlink(file);
    await gate;
  });
  await watcher.refresh();
  expect(changes).toEqual([]);
  await watcher.update({ root, directories: [], files: [] });
  release();
  await mutation;
  await watcher.refresh();
  expect(changes.flatMap((change) => change.missing)).toEqual([]);
});

test('does not drop documents on stat permission failures', async () => {
  const file = join(root, 'one.md');
  await fs.writeFile(file, 'original');
  await start([file]);
  const original = fs.stat.bind(fs);
  jest
    .spyOn(fs, 'stat')
    .mockImplementation(((path: string, ...args: unknown[]) =>
      path === file
        ? Promise.reject(
            Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
          )
        : original(path, ...(args as []))) as typeof fs.stat);
  await watcher.refresh();
  expect(changes.flatMap((change) => change.missing)).toEqual([]);
  expect(AppStorage.canWatchFile(context, file)).toBe(true);
});

test('caps directory enumeration and never publishes an incomplete listing', async () => {
  await start();
  jest.spyOn(fs, 'opendir').mockResolvedValueOnce({
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index <= LOCAL_WATCH_LIMITS.entries; index++)
        yield {
          name: `${index}.md`,
          isDirectory: () => false,

          isFile: () => true,
        };
    },
  } as never);
  await watcher.refresh();
  expect(changes.at(-1)).toMatchObject({ truncated: true, directories: [] });
});

test('keeps file aliases in explorer listings without following them during enumeration', async () => {
  await start();
  jest.spyOn(fs, 'opendir').mockResolvedValueOnce({
    async *[Symbol.asyncIterator]() {
      yield {
        name: 'alias.md',
        isDirectory: () => false,

        isFile: () => false,

        isSymbolicLink: () => true,
      };
    },
  } as never);
  await watcher.refresh();
  expect(changes.at(-1)?.directories[0].tree).toEqual([
    { type: 'file', name: 'alias.md', path: join(root, 'alias.md') },
  ]);
});

test('disposal suppresses a queued scan and releases native watchers', async () => {
  await start();
  await fs.writeFile(join(root, 'new.md'), 'new');
  const refresh = watcher.refresh();
  watcher.dispose();
  await refresh;
  expect(changes).toEqual([]);
});
