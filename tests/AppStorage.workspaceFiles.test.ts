import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  promises as fs,
  type Dir,
  type Dirent,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AppStorage,
  WORKSPACE_LISTING_LIMITS,
} from '../src/app/lib/AppStorage';
import { createDirectoryLink } from './utils/directoryLink';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mkeditor-workspace-files-'));
  AppStorage.setWorkspaceRoot(root);
});
afterEach(() => {
  jest.restoreAllMocks();
  AppStorage.setWorkspaceRoot(null);
  rmSync(root, { recursive: true, force: true });
});

it('lists deep, unopened files of any extension without reading their contents', async () => {
  mkdirSync(join(root, 'poems', 'nested'), { recursive: true });
  const paths = [
    join(root, 'poems', 'nested', 'sonnet.md'),
    join(root, 'config.json'),
    join(root, 'README'),
    join(root, '.hidden'),
  ];
  paths.forEach((path) =>
    writeFileSync(path, 'Contents must not be read during enumeration'),
  );
  const read = jest.spyOn(fs, 'readFile');
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual({
    paths: paths.sort(),
    truncated: false,
  });
  expect(read).not.toHaveBeenCalled();
});

it('skips dependency, build and dot-directories while preserving dot-files', async () => {
  const excluded = [
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    'coverage',
    '.cache',
    '.custom',
  ];
  for (const name of [...excluded, 'docs']) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'file.md'), 'text');
  }
  writeFileSync(join(root, '.notes.md'), 'text');
  const open = jest.spyOn(fs, 'opendir');
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual({
    paths: [join(root, '.notes.md'), join(root, 'docs', 'file.md')].sort(),
    truncated: false,
  });
  expect(open).toHaveBeenCalledTimes(2);
  for (const name of excluded)
    expect(open).not.toHaveBeenCalledWith(join(root, name));
});

function entry(name: string, directory = false): Dirent {
  return {
    name,
    isDirectory: () => directory,
    isFile: () => !directory,
    isSymbolicLink: () => false,
  } as Dirent;
}

function directoryStream(items: Iterable<Dirent>, closed: () => void): Dir {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield* items;
      } finally {
        closed();
      }
    },
  } as Dir;
}

it.each(['files', 'entries'] as const)(
  'bounds the %s budget even inside one huge directory and closes its handle',
  async (budget) => {
    let visited = 0;
    const limit = WORKSPACE_LISTING_LIMITS[budget];
    const closed = jest.fn();
    function* entries() {
      for (let i = 0; i < limit + 100; i++) {
        visited++;
        yield budget === 'files'
          ? entry(`${i}.md`)
          : entry(`.ignored-${i}`, true);
      }
    }
    const open = jest
      .spyOn(fs, 'opendir')
      .mockResolvedValue(directoryStream(entries(), closed));
    const listing = await AppStorage.listWorkspaceFiles(root);
    expect(listing.truncated).toBe(true);
    expect(listing.paths).toHaveLength(budget === 'files' ? limit : 0);
    expect(visited).toBeLessThanOrEqual(limit + 1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  },
);

it('caps directory traversal and bounds the pending directory queue', async () => {
  const closed = jest.fn();
  const children = Array.from(
    { length: WORKSPACE_LISTING_LIMITS.directories + 10 },
    (_, i) => entry(`folder-${i}`, true),
  );
  const canonicalRoot = AppStorage.getWorkspaceRoot()!;
  const open = jest
    .spyOn(fs, 'opendir')
    .mockImplementation(async (path) =>
      directoryStream(path === canonicalRoot ? children : [], closed),
    );
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual({
    paths: [],
    truncated: true,
  });
  expect(open).toHaveBeenCalledTimes(WORKSPACE_LISTING_LIMITS.directories);
  expect(closed).toHaveBeenCalledTimes(WORKSPACE_LISTING_LIMITS.directories);
});

it('reflects folder renames, moves, creations and deletions on the next listing', async () => {
  mkdirSync(join(root, 'poems'));
  mkdirSync(join(root, 'other'));
  writeFileSync(join(root, 'poems', 'one.md'), 'one');
  expect((await AppStorage.listWorkspaceFiles(root)).paths).toEqual([
    join(root, 'poems', 'one.md'),
  ]);
  renameSync(join(root, 'poems'), join(root, 'renamed'));
  renameSync(join(root, 'renamed', 'one.md'), join(root, 'other', 'moved.md'));
  writeFileSync(join(root, 'created.txt'), 'created');
  expect((await AppStorage.listWorkspaceFiles(root)).paths).toEqual(
    [join(root, 'created.txt'), join(root, 'other', 'moved.md')].sort(),
  );
  rmSync(join(root, 'other', 'moved.md'));
  expect((await AppStorage.listWorkspaceFiles(root)).paths).toEqual([
    join(root, 'created.txt'),
  ]);
});

it('rejects no workspace, unrelated roots and subfolders passed as the active root', async () => {
  mkdirSync(join(root, 'sub'));
  await expect(
    AppStorage.listWorkspaceFiles(join(root, 'sub')),
  ).rejects.toThrow(/workspace root/);
  await expect(AppStorage.listWorkspaceFiles(tmpdir())).rejects.toThrow(
    /outside the workspace/,
  );
  AppStorage.setWorkspaceRoot(null);
  await expect(AppStorage.listWorkspaceFiles(root)).rejects.toThrow(
    /No workspace/,
  );
});

it('rejects a listing when the workspace changes while it is running', async () => {
  const other = join(root, 'other');
  mkdirSync(other);
  const listing = AppStorage.listWorkspaceFiles(root);
  AppStorage.setWorkspaceRoot(other);
  await expect(listing).rejects.toThrow(/Workspace changed/);
});

it('does not follow directory links outside the workspace or through cycles', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'mkeditor-outside-files-'));
  try {
    writeFileSync(join(outside, 'private.md'), 'private');
    writeFileSync(join(root, 'visible.md'), 'visible');
    createDirectoryLink(outside, join(root, 'escape'));
    createDirectoryLink(root, join(root, 'loop'));
    expect((await AppStorage.listWorkspaceFiles(root)).paths).toEqual([
      join(root, 'visible.md'),
    ]);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
