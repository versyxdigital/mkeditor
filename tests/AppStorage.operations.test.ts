import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  promises as fs,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dialog, type BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';

jest.mock('electron', () => ({
  app: { addRecentDocument: jest.fn() },
  dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
}));

function fakeWindow() {
  return {
    webContents: { send: jest.fn() },
  } as unknown as BrowserWindow;
}

describe('AppStorage document operations', () => {
  let root: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'mkeditor-storage-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AppStorage.setWorkspaceRoot(null);
    rmSync(root, { recursive: true, force: true });
  });

  it.each([false, true])(
    'creates and refreshes the explorer with openFile=%s',
    async (openFile) => {
      const context = fakeWindow();
      const existing = join(root, 'existing.md');
      writeFileSync(existing, 'current document');
      AppStorage.setActiveFile(context, existing);
      const send = context.webContents.send as jest.Mock;
      send.mockClear();

      const result = await AppStorage.createFile(
        context,
        root,
        'new.md',
        '# Created',
        openFile,
      );
      expect(result).toEqual({ ok: true, path: join(root, 'new.md') });
      expect(readFileSync(join(root, 'new.md'), 'utf8')).toBe('# Created');
      expect(send).toHaveBeenCalledWith(
        'from:folder:opened',
        expect.objectContaining({ path: root }),
      );
      expect(
        send.mock.calls.filter(([channel]) => channel === 'from:file:opened'),
      ).toHaveLength(openFile ? 1 : 0);
      expect(AppStorage.getActiveFilePath()).toBe(
        openFile ? join(root, 'new.md') : existing,
      );
    },
  );

  it('serializes menu and direct tool writes so an older save cannot overtake a later one', async () => {
    const target = join(root, 'queued.md');
    writeFileSync(target, 'original');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actual = fs.writeFile.bind(fs);
    const context = fakeWindow();
    AppStorage.setActiveFile(context, target);
    const writes = jest
      .spyOn(fs, 'writeFile')
      .mockImplementationOnce(async (...args) => {
        await gate;
        return actual(...args);
      });
    const menu = AppStorage.saveFile(context, {
      filePath: target,
      data: 'menu',
      encoding: 'utf-8',
      openFile: false,
    });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const tool = AppStorage.writeTextFile(target, 'tool');
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(writes).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([menu, tool]);
    expect(writes).toHaveBeenCalledTimes(2);
    expect(readFileSync(target, 'utf-8')).toBe('tool');
  });

  it('publishes concurrent pasted images under distinct names without changing either image', async () => {
    AppStorage.setWorkspaceRoot(root);
    const source = join(root, 'source.md');
    writeFileSync(source, 'markdown');
    const results = await Promise.all([
      AppStorage.writePastedImage(
        fakeWindow(),
        source,
        '.',
        new Uint8Array([1, 2, 3]),
        'png',
      ),
      AppStorage.writePastedImage(
        fakeWindow(),
        source,
        '.',
        new Uint8Array([4, 5, 6]),
        'png',
      ),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const paths = results.map((result) => {
      if (!result.ok) throw new Error(result.error);
      return result.path;
    });
    expect(new Set(paths).size).toBe(2);
    expect([...readFileSync(paths[0])]).toEqual([1, 2, 3]);
    expect([...readFileSync(paths[1])]).toEqual([4, 5, 6]);
  });

  it('does not overwrite an existing file when creating a new document', async () => {
    const file = join(root, 'existing.md');
    writeFileSync(file, 'valuable document');
    const context = fakeWindow();
    const result = await AppStorage.createFile(
      context,
      root,
      'existing.md',
      'replacement',
    );
    expect(result.ok).toBe(false);
    expect(readFileSync(file, 'utf-8')).toBe('valuable document');
    expect(context.webContents.send).not.toHaveBeenCalled();
  });

  it('rejects a Save As destination already open in another tab before overwriting it', async () => {
    const target = join(root, 'target.md');
    writeFileSync(target, 'valuable destination');
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({
      canceled: false,
      filePath: target,
    });
    const result = await AppStorage.saveFile(fakeWindow(), {
      data: 'source document',
      encoding: 'utf-8',
      openFile: false,
      excludedPaths: [target],
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(target, 'utf-8')).toBe('valuable destination');
  });

  it('does not overwrite another document when renaming a file', async () => {
    const source = join(root, 'source.md');
    const target = join(root, 'target.md');
    writeFileSync(source, 'source');
    writeFileSync(target, 'target');
    const context = fakeWindow();
    await AppStorage.renamePath(context, source, 'target.md');
    expect(readFileSync(source, 'utf-8')).toBe('source');
    expect(readFileSync(target, 'utf-8')).toBe('target');
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:notification:display',
      {
        status: 'error',
        key: 'notifications:unable_rename',
      },
    );
  });

  it('allows a case-only rename without treating the source as a destination collision', async () => {
    const source = join(root, 'Note.md');
    const destination = join(root, 'note.md');
    writeFileSync(source, 'document');
    const context = fakeWindow();
    await AppStorage.renamePath(context, source, 'note.md');
    expect(readFileSync(destination, 'utf-8')).toBe('document');
    expect(context.webContents.send).toHaveBeenCalledWith('from:path:renamed', {
      oldPath: source,
      newPath: destination,
      name: 'note.md',
    });
  });

  it('allows the next queued save to succeed after an earlier write fails', async () => {
    const target = join(root, 'recover.md');
    jest
      .spyOn(fs, 'writeFile')
      .mockRejectedValueOnce(new Error('temporary write failure'));
    const failed = AppStorage.writeTextFile(target, 'first');
    const retry = AppStorage.writeTextFile(target, 'second');
    await expect(failed).rejects.toThrow('temporary write failure');
    await expect(retry).resolves.toBeUndefined();
    expect(readFileSync(target, 'utf-8')).toBe('second');
  });

  it('rejects a rename that attempts to move through path traversal', async () => {
    const source = join(root, 'source.md');
    writeFileSync(source, 'source');
    await AppStorage.renamePath(fakeWindow(), source, '../escaped.md');
    expect(readFileSync(source, 'utf-8')).toBe('source');
  });

  it('allows only one of two concurrent creates to claim the same filename', async () => {
    const results = await Promise.all([
      AppStorage.createFile(fakeWindow(), root, 'new.md', 'first'),
      AppStorage.createFile(fakeWindow(), root, 'new.md', 'second'),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(['first', 'second']).toContain(
      readFileSync(join(root, 'new.md'), 'utf-8'),
    );
  });

  it('waits for Save As selection and the actual write before reporting success', async () => {
    const target = join(root, 'saved.md');
    let select!: (selection: { canceled: boolean; filePath: string }) => void;
    (dialog.showSaveDialog as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        select = resolve;
      }),
    );
    const pending = AppStorage.saveFile(fakeWindow(), {
      data: 'complete document',
      encoding: 'utf-8',
      openFile: false,
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(existsSync(target)).toBe(false);
    select({ canceled: false, filePath: target });
    await expect(pending).resolves.toEqual({ ok: true, path: target });
    expect(readFileSync(target, 'utf-8')).toBe('complete document');
  });

  it('treats Save As cancellation as cancellation without displaying an error', async () => {
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: true });
    const context = fakeWindow();
    await expect(
      AppStorage.saveFile(context, {
        data: 'unsaved',
        encoding: 'utf-8',
        openFile: false,
      }),
    ).resolves.toEqual({ ok: false, cancelled: true });
    expect(context.webContents.send).not.toHaveBeenCalled();
  });

  it('reports a failed write without a success event or opening a file', async () => {
    const context = fakeWindow();
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({
      canceled: false,
      filePath: join(root, 'missing', 'note.md'),
    });
    const result = await AppStorage.saveFile(context, {
      data: 'unsaved',
      filePath: join(root, 'missing', 'note.md'),
      encoding: 'utf-8',
      openFile: false,
    });
    expect(result.ok).toBe(false);
    expect(context.webContents.send).toHaveBeenCalledTimes(1);
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:notification:display',
      {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      },
    );
  });

  it('resolves an open-dialog cancellation instead of leaving callers waiting', async () => {
    (dialog.showOpenDialog as jest.Mock).mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    const context = fakeWindow();
    await expect(AppStorage.showOpenDialog(context)).resolves.toBeNull();
    expect(context.webContents.send).not.toHaveBeenCalled();
  });

  it('resolves an open-dialog failure and displays the relevant error', async () => {
    (dialog.showOpenDialog as jest.Mock).mockRejectedValue(
      new Error('picker failed'),
    );
    const context = fakeWindow();
    await expect(AppStorage.showOpenDialog(context)).resolves.toBeNull();
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:notification:display',
      {
        status: 'error',
        key: 'notifications:unable_open_file',
      },
    );
  });

  it.each(['loadURL', 'executeJavaScript', 'printToPDF'])(
    'destroys the PDF window when %s fails',
    async (failure) => {
      const offscreen = {
        setTitle: jest.fn(),
        loadURL: jest.fn().mockResolvedValue(undefined),
        isDestroyed: jest.fn(() => false),
        destroy: jest.fn(),
        webContents: {
          executeJavaScript: jest.fn().mockResolvedValue(undefined),
          printToPDF: jest.fn().mockResolvedValue(Buffer.from('pdf')),
        },
      };
      const failing =
        failure === 'loadURL'
          ? offscreen.loadURL
          : offscreen.webContents[
              failure as 'executeJavaScript' | 'printToPDF'
            ];
      failing.mockRejectedValue(new Error('export failed'));
      const context = fakeWindow();
      await expect(
        AppStorage.saveFileToPDF(
          context,
          offscreen as unknown as BrowserWindow,
          {
            data: '<html></html>',
            encoding: 'utf-8',
          },
        ),
      ).resolves.toBeUndefined();
      expect(offscreen.destroy).toHaveBeenCalledTimes(1);
      expect(context.webContents.send).toHaveBeenCalledWith(
        'from:notification:display',
        {
          status: 'error',
          key: 'notifications:unable_export_preview',
        },
      );
    },
  );

  it('maps missing paths to the specific missing-path notification', async () => {
    const context = fakeWindow();
    await AppStorage.openPath(context, join(root, 'missing.md'));
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:notification:display',
      {
        status: 'error',
        key: 'notifications:path_not_exist',
      },
    );
  });
});
