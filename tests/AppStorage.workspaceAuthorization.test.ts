import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';

jest.mock('../src/app/lib/AppSession', () => ({
  AppSession: { save: jest.fn() },
}));

function fakeWindow() {
  return {
    webContents: { id: 41, send: jest.fn() },
    once: jest.fn(),
    setTitle: jest.fn(),
  } as unknown as BrowserWindow;
}

describe('main-owned workspace authorization', () => {
  let fixture: string;
  let previous: string;
  let next: string;
  let arbitrary: string;

  beforeEach(() => {
    jest.clearAllMocks();
    AppStorage.setWorkspaceRoot(null);
    fixture = mkdtempSync(join(tmpdir(), 'mkeditor-authority-'));
    previous = join(fixture, 'previous');
    next = join(fixture, 'selected');
    arbitrary = join(fixture, 'arbitrary');
    for (const dir of [previous, next, arbitrary]) {
      mkdirSync(dir);
      writeFileSync(join(dir, 'note.md'), 'document');
    }
  });

  afterEach(() => {
    AppStorage.setWorkspaceRoot(null);
    rmSync(fixture, { recursive: true, force: true });
  });

  it('rejects arbitrary renderer roots and malformed adoption requests', () => {
    AppStorage.setWorkspaceRoot(previous);
    expect(AppStorage.adoptWorkspaceRoot(arbitrary)).toBe(false);
    expect(AppStorage.adoptWorkspaceRoot(undefined)).toBe(false);
    expect(AppStorage.adoptWorkspaceRoot({ root: arbitrary })).toBe(false);
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
  });

  it('accepts a picker-offered root only after the renderer adopts it', async () => {
    AppStorage.setWorkspaceRoot(previous);
    (dialog.showOpenDialog as jest.Mock).mockResolvedValue({
      canceled: false,
      filePaths: [next],
    });
    const window = fakeWindow();
    await AppStorage.openDirectory(window);
    expect(window.webContents.send).toHaveBeenCalledWith(
      'from:folder:opened',
      expect.objectContaining({ path: next, workspaceChange: true }),
    );
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
    expect(AppStorage.adoptWorkspaceRoot(next)).toBe(true);
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(next));
  });

  it('keeps the previous authority and persisted root when the workspace-switch confirmation is cancelled', async () => {
    AppStorage.setWorkspaceRoot(previous);
    (dialog.showOpenDialog as jest.Mock).mockResolvedValue({
      canceled: false,
      filePaths: [next],
    });
    await AppStorage.openDirectory(fakeWindow());
    // Cancelling the renderer confirmation produces no adoption message.
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
    expect(AppStorage.getSessionWorkspaceRoot(next)).toBe(
      realpathSync(previous),
    );
    await expect(
      AppStorage.assertInWorkspace(join(next, 'note.md')),
    ).rejects.toThrow(/outside the workspace/);
    await expect(
      AppStorage.assertInWorkspace(join(previous, 'note.md')),
    ).resolves.toBe(realpathSync(join(previous, 'note.md')));
  });

  it('keeps the previous workspace when the native picker is cancelled', async () => {
    AppStorage.setWorkspaceRoot(previous);
    (dialog.showOpenDialog as jest.Mock).mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    const window = fakeWindow();
    await AppStorage.openDirectory(window);
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
    expect(AppStorage.adoptWorkspaceRoot(next)).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('preserves a trusted restore root in an early session save before asynchronous directory adoption', () => {
    expect(AppStorage.offerWorkspaceRoot(previous, true)).toBe(true);
    expect(AppStorage.getWorkspaceRoot()).toBeNull();
    expect(AppStorage.getSessionWorkspaceRoot(null)).toBe(
      realpathSync(previous),
    );
    expect(AppStorage.getSessionWorkspaceRoot(arbitrary)).toBe(
      realpathSync(previous),
    );
    expect(AppStorage.adoptWorkspaceRoot(previous)).toBe(true);
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
  });

  it('does not authorise an arbitrary directory through openPath or its listing', async () => {
    AppStorage.setWorkspaceRoot(previous);
    const window = fakeWindow();
    await AppStorage.openPath(window, arbitrary);
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'from:folder:opened',
      expect.anything(),
    );
    expect(AppStorage.adoptWorkspaceRoot(arbitrary)).toBe(false);
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
  });

  it('still allows current-workspace directory expansion and an offered restore directory', async () => {
    AppStorage.setWorkspaceRoot(previous);
    const child = join(previous, 'subfolder');
    mkdirSync(child);
    const window = fakeWindow();
    await AppStorage.openPath(window, child);
    expect(window.webContents.send).toHaveBeenCalledWith(
      'from:folder:opened',
      expect.objectContaining({ path: child }),
    );
    expect(AppStorage.offerWorkspaceRoot(next, true)).toBe(true);
    await AppStorage.openPath(window, next);
    expect(window.webContents.send).toHaveBeenCalledWith(
      'from:folder:opened',
      expect.objectContaining({ path: next }),
    );
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
  });

  it('clearing the workspace revokes pending offers as well as the adopted root', () => {
    AppStorage.setWorkspaceRoot(previous);
    AppStorage.offerWorkspaceRoot(next);
    expect(AppStorage.adoptWorkspaceRoot(null)).toBe(true);
    expect(AppStorage.getWorkspaceRoot()).toBeNull();
    expect(AppStorage.adoptWorkspaceRoot(next)).toBe(false);
  });

  it('enforces adoption and session-root clamping on the actual IPC handlers', () => {
    const window = fakeWindow();
    new AppBridge(window, true);
    const handler = (channel: string) =>
      (ipcMain.on as jest.Mock).mock.calls.find(
        ([name]) => name === channel,
      )![1];
    const event = { sender: { id: 41 } };
    AppStorage.setWorkspaceRoot(previous);
    handler('to:workspace:set')(event, { root: arbitrary });
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(previous));
    const payload = {
      version: 2,
      tabs: [],
      activeFile: null,
      workspaceRoot: arbitrary,
      assistant: { sidebarOpen: true, size: 23 },
    };
    handler('to:session:save')(event, payload);
    expect(AppSession.save).toHaveBeenLastCalledWith({
      ...payload,
      workspaceRoot: realpathSync(previous),
    });
    AppStorage.offerWorkspaceRoot(next);
    handler('to:workspace:set')(event, { root: next });
    expect(AppStorage.getWorkspaceRoot()).toBe(realpathSync(next));
    handler('to:session:save')(event, { ...payload, workspaceRoot: next });
    expect(AppSession.save).toHaveBeenLastCalledWith({
      ...payload,
      workspaceRoot: next,
    });
  });

  it('cannot launder a renderer root through persistence when no workspace has been selected', () => {
    const window = fakeWindow();
    new AppBridge(window, true);
    const handler = (ipcMain.on as jest.Mock).mock.calls.find(
      ([name]) => name === 'to:session:save',
    )![1];
    handler(
      { sender: { id: 41 } },
      { version: 2, tabs: [], activeFile: null, workspaceRoot: arbitrary },
    );
    expect(AppSession.save).toHaveBeenLastCalledWith({
      version: 2,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
    });
  });
});
