import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  promises as fs,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppStorage } from '../src/app/lib/AppStorage';
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
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual(paths.sort());
  expect(read).not.toHaveBeenCalled();
});

it('reflects folder renames, moves, creations and deletions on the next listing', async () => {
  mkdirSync(join(root, 'poems'));
  mkdirSync(join(root, 'other'));
  writeFileSync(join(root, 'poems', 'one.md'), 'one');
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual([
    join(root, 'poems', 'one.md'),
  ]);
  renameSync(join(root, 'poems'), join(root, 'renamed'));
  renameSync(join(root, 'renamed', 'one.md'), join(root, 'other', 'moved.md'));
  writeFileSync(join(root, 'created.txt'), 'created');
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual(
    [join(root, 'created.txt'), join(root, 'other', 'moved.md')].sort(),
  );
  rmSync(join(root, 'other', 'moved.md'));
  expect(await AppStorage.listWorkspaceFiles(root)).toEqual([
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
    expect(await AppStorage.listWorkspaceFiles(root)).toEqual([
      join(root, 'visible.md'),
    ]);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
