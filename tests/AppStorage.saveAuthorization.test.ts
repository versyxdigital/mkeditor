import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';
import { CloudSessionRecovery } from '../src/app/lib/cloud/CloudSessionRecovery';
import { createDirectoryLink } from './utils/directoryLink';

jest.mock('electron', () => {
  const original = jest.requireActual('electron');
  return {
    ...original,
    app: { ...original.app, addRecentDocument: jest.fn() },
  };
});

function windowFor(id = 71): BrowserWindow {
  return {
    webContents: { id, send: jest.fn() },
    once: jest.fn(),
    setTitle: jest.fn(),
    isDestroyed: () => false,
  } as unknown as BrowserWindow;
}

let root: string;
let context: BrowserWindow;
const save = (path: string | undefined, owner = context) =>
  AppStorage.saveFile(owner, {
    filePath: path,
    data: 'changed',
    encoding: 'utf8',
    openFile: false,
  });

beforeEach(() => {
  jest.clearAllMocks();
  root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'mkeditor-save-auth-')),
  );
  context = windowFor();
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({
    canceled: true,
    filePath: '',
  });
  AppStorage.setWorkspaceRoot(null);
});

afterEach(() => {
  jest.restoreAllMocks();
  AppStorage.setWorkspaceRoot(null);
  rmSync(root, { recursive: true, force: true });
});

test('ordinary save IPC cannot create a renderer-supplied destination without native selection', async () => {
  const file = join(root, 'unapproved.md');
  new AppBridge(context, true);
  const handler = jest
    .mocked(ipcMain.on)
    .mock.calls.find(([channel]) => channel === 'to:file:save')![1];
  await handler({ sender: { id: 71 } } as never, {
    file,
    content: 'unapproved content',
    requestId: 'blocked',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(existsSync(file)).toBe(false);
  expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
  expect(context.webContents.send).toHaveBeenCalledWith(
    'from:file:save-result',
    { requestId: 'blocked', ok: false, cancelled: true },
  );
});

test('an existing unapproved file is not overwritten', async () => {
  const file = join(root, 'private.md');
  writeFileSync(file, 'private');
  expect(await save(file)).toEqual({ ok: false, cancelled: true });
  expect(readFileSync(file, 'utf8')).toBe('private');
});

test.each(['missing', 'unreadable', 'directory'] as const)(
  'a %s native-open target reports failure without changing the active file or granting save access',
  async (kind) => {
    const active = join(root, 'active.md');
    const target = join(root, 'unavailable.md');
    writeFileSync(active, 'current document');
    AppStorage.openActiveFile(context, active);
    if (kind === 'directory') mkdirSync(target);
    if (kind === 'unreadable') {
      writeFileSync(target, 'unreadable document');
      const nativeFs = jest.requireActual('fs') as typeof import('fs');
      const read = nativeFs.readFileSync;
      jest.spyOn(nativeFs, 'readFileSync').mockImplementation((...args) => {
        if (args[0] === target)
          throw Object.assign(new Error('read denied'), { code: 'EACCES' });
        return Reflect.apply(read, undefined, args);
      });
    }
    jest.mocked(context.webContents.send).mockClear();
    jest.mocked(app.addRecentDocument).mockClear();
    expect(() => AppStorage.openActiveFile(context, target)).not.toThrow();
    expect(AppStorage.getActiveFilePath()).toBe(active);
    expect(context.webContents.send).toHaveBeenCalledTimes(1);
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:notification:display',
      {
        status: 'error',
        key: 'notifications:unable_open_file',
      },
    );
    expect(app.addRecentDocument).not.toHaveBeenCalled();
    expect(await save(target)).toEqual({ ok: false, cancelled: true });
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
  },
);

test('a native-opened file outside the workspace remains saveable in its window', async () => {
  const file = join(root, 'selected.md');
  writeFileSync(file, 'original');
  jest.mocked(dialog.showOpenDialog).mockResolvedValue({
    canceled: false,
    filePaths: [file],
  });
  await AppStorage.showOpenDialog(context);
  expect(await save(file)).toEqual({ ok: true, path: file });
  expect(readFileSync(file, 'utf8')).toBe('changed');
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  expect(await save(file, windowFor(72))).toEqual({
    ok: false,
    cancelled: true,
  });
});

test('native Save As writes only the selected destination and authorizes subsequent saves', async () => {
  const supplied = join(root, 'unapproved.md');
  const selected = join(root, 'selected.md');
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({
    canceled: false,
    filePath: selected,
  });
  expect(await save(supplied)).toEqual({ ok: true, path: selected });
  expect(existsSync(supplied)).toBe(false);
  expect(readFileSync(selected, 'utf8')).toBe('changed');
  expect(await save(selected)).toEqual({ ok: true, path: selected });
  expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
});

test('renderer file opens and mked links cannot authorize outside files', async () => {
  const file = join(root, 'private.md');
  writeFileSync(file, 'private');
  await AppStorage.openPath(context, file);
  const bridge = new AppBridge(context);
  bridge.handleMkedUrl(`mked://open?path=${encodeURIComponent(file)}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await save(file)).toEqual({ ok: false, cancelled: true });
  expect(readFileSync(file, 'utf8')).toBe('private');
  expect(context.webContents.send).not.toHaveBeenCalledWith(
    'from:file:opened',
    expect.anything(),
  );
});

test('opening an existing workspace file grants save access but new paths still need a picker', async () => {
  const file = join(root, 'existing.md');
  writeFileSync(file, 'original');
  AppStorage.setWorkspaceRoot(root);
  await AppStorage.openPath(context, file);
  expect(await save(file)).toEqual({ ok: true, path: file });
  expect(await save(join(root, 'new.md'))).toEqual({
    ok: false,
    cancelled: true,
  });
  expect(existsSync(join(root, 'new.md'))).toBe(false);
});

test('retargeting a directory link does not transfer a file grant to its new target', async () => {
  const first = mkdtempSync(join(tmpdir(), 'mkeditor-save-first-'));
  const second = mkdtempSync(join(tmpdir(), 'mkeditor-save-second-'));
  const link = join(root, 'linked');
  try {
    writeFileSync(join(first, 'note.md'), 'first');
    writeFileSync(join(second, 'note.md'), 'second');
    createDirectoryLink(first, link);
    AppStorage.openActiveFile(context, join(link, 'note.md'));
    rmSync(link, { recursive: true, force: true });
    createDirectoryLink(second, link);
    expect(await save(join(link, 'note.md'))).toEqual({
      ok: false,
      cancelled: true,
    });
    expect(readFileSync(join(second, 'note.md'), 'utf8')).toBe('second');
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('main-created documents retain authorization after a rename', async () => {
  const file = join(root, 'before.md');
  const renamed = join(root, 'after.md');
  writeFileSync(file, 'original');
  AppStorage.openActiveFile(context, file);
  await AppStorage.renamePath(context, file, 'after.md');
  expect(await save(renamed)).toEqual({ ok: true, path: renamed });
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});

test('main-restored local documents outside the workspace can be saved without another picker', async () => {
  const file = join(root, 'restored.md');
  writeFileSync(file, 'original');
  jest.spyOn(AppSession, 'load').mockReturnValueOnce(null);
  jest.spyOn(CloudSessionRecovery.prototype, 'restore').mockResolvedValueOnce({
    session: null,
    missing: [],
    contents: { [file]: 'original' },
  });
  await new AppBridge(context).restoreSession(true);
  expect(await save(file)).toEqual({ ok: true, path: file });
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
