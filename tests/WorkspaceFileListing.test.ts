import { FileTreeManager } from '../src/browser/core/FileTreeManager';

const bridge = () => ({ send: jest.fn(), receive: jest.fn() });

it('coalesces inventory requests and does not mutate or expand the explorer', async () => {
  let finish!: (paths: string[]) => void;
  const load = jest.fn(
    () =>
      new Promise<string[]>((resolve) => {
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
  finish(['/w/poems/deep/a.md', '/elsewhere/no.md', '/w/poems/deep/a.md']);
  expect(await first).toEqual(['/w/poems/deep/a.md']);
  expect(await manager.listWorkspaceFiles()).toBe(await first);
  expect(load).toHaveBeenCalledTimes(1);
  expect(manager.getSnapshot()).toBe(snapshot);
  expect(execution.send).not.toHaveBeenCalled();
});

it('shares one follow-up scan after rapid mutations invalidate a running inventory', async () => {
  let finish!: (paths: string[]) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(['/w/new.md']);
  const manager = new FileTreeManager(bridge(), jest.fn(), load);
  manager.buildFileTree([], '/w');
  const first = manager.listWorkspaceFiles();
  await Promise.resolve();
  const waiting: Promise<string[]>[] = [];
  for (let i = 0; i < 10; i++) {
    manager.buildFileTree([], '/w');
    waiting.push(manager.listWorkspaceFiles(true));
  }
  finish(['/w/old.md']);
  expect(await first).toEqual([]);
  expect(await Promise.all(waiting)).toEqual(
    Array.from({ length: 10 }, () => ['/w/new.md']),
  );
  expect(load).toHaveBeenCalledTimes(2);
});

it('clears old workspace results and permits recovery after a failed scan', async () => {
  const load = jest
    .fn()
    .mockRejectedValueOnce(new Error('Read failed'))
    .mockResolvedValue(['/w/a.md']);
  const manager = new FileTreeManager(bridge(), jest.fn(), load);
  manager.buildFileTree([], '/w');
  await expect(manager.listWorkspaceFiles()).rejects.toThrow('Read failed');
  expect(await manager.listWorkspaceFiles()).toEqual(['/w/a.md']);
  manager.clearTree();
  expect(await manager.listWorkspaceFiles()).toEqual([]);
});
