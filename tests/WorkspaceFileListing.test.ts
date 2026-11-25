import type { WorkspaceFileListing } from '../src/app/interfaces/Storage';
import { FileTreeManager } from '../src/browser/core/FileTreeManager';

const bridge = () => ({ send: jest.fn(), receive: jest.fn() });

it('coalesces inventory requests and does not mutate or expand the explorer', async () => {
  let finish!: (listing: WorkspaceFileListing) => void;
  const load = jest.fn(
    () =>
      new Promise<WorkspaceFileListing>((resolve) => {
        finish = resolve;
      }),
  );
  const execution = bridge();
  const manager = new FileTreeManager(execution, jest.fn(), load);
  manager.buildFileTree(
    [{ type: 'directory', name: 'poems', path: '/w/poems', hasChildren: true }],
    '/w',
  );
  const snapshot = manager.getSnapshot();
  const first = manager.listWorkspaceFiles(true);
  const second = manager.listWorkspaceFiles(true);
  expect(first).toBe(second);
  await Promise.resolve();
  finish({
    paths: ['/w/poems/deep/a.md', '/elsewhere/no.md', '/w/poems/deep/a.md'],
    truncated: true,
  });
  expect(await first).toEqual({
    paths: ['/w/poems/deep/a.md'],
    truncated: true,
  });
  expect(await manager.listWorkspaceFiles()).toBe(await first);
  expect(load).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot()).toBe(snapshot);
  expect(execution.send).not.toHaveBeenCalled();
});

it('shares one follow-up scan after rapid mutations invalidate a running inventory', async () => {
  let finish!: (listing: WorkspaceFileListing) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<WorkspaceFileListing>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ paths: ['/w/new.md'], truncated: false });
  const manager = new FileTreeManager(bridge(), jest.fn(), load);
  manager.buildFileTree([], '/w');
  const first = manager.listWorkspaceFiles();
  await Promise.resolve();
  const waiting: Promise<WorkspaceFileListing>[] = [];
  for (let i = 0; i < 10; i++) {
    manager.buildFileTree([], '/w');
    waiting.push(manager.listWorkspaceFiles(true));
  }
  finish({ paths: ['/w/old.md'], truncated: false });
  expect(await first).toEqual({ paths: [], truncated: false });
  expect(await Promise.all(waiting)).toEqual(
    Array.from({ length: 10 }, () => ({
      paths: ['/w/new.md'],
      truncated: false,
    })),
  );
  expect(load).toHaveBeenCalledTimes(2);
});

it('clears old workspace results and permits recovery after a failed scan', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('Read failed'))
    .mockResolvedValue({ paths: ['/w/a.md'], truncated: false });
  const manager = new FileTreeManager(bridge(), jest.fn(), load);
  manager.buildFileTree([], '/w');
  await expect(manager.listWorkspaceFiles()).rejects.toThrow('Read failed');
  expect(await manager.listWorkspaceFiles()).toEqual({
    paths: ['/w/a.md'],
    truncated: false,
  });
  manager.clearTree();
  expect(await manager.listWorkspaceFiles()).toEqual({
    paths: [],
    truncated: false,
  });
});
