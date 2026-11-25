import { registerBridgeListeners } from '../src/browser/core/BridgeListeners';

jest.mock('../src/browser/i18n', () => ({
  t: (key: string) => key,

  whenLanguageReady: () => Promise.resolve(),
}));

function setup(proceed = true) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const bridge = {
    send: jest.fn(),
    receive: (name: string, handler: (...args: any[]) => any) =>
      handlers.set(name, handler),
  };
  const files = {
    closeAllTabsForWorkspaceSwitch: jest.fn(async () => proceed),
    scheduleSessionSave: jest.fn(),
  };
  const tree = {
    treeRoot: 'notes',
    openingFolder: true,
    buildFileTree: jest.fn(),
  };
  const assistant = {
    getChatSnapshot: jest.fn(() => ({ inflight: { first: {}, second: {} } })),
    cancelCall: jest.fn(),
  };
  registerBridgeListeners(
    bridge,
    {} as never,
    {} as never,
    {} as never,
    files as never,
    tree as never,
    { assistantManager: assistant } as never,
  );
  return {
    bridge,
    files,
    tree,
    assistant,
    opened: handlers.get('from:folder:opened')!,
  };
}

it('confirms and publishes switching to a different folder with the same virtual name', async () => {
  const { bridge, files, tree, opened } = setup();
  await opened({ path: 'notes', tree: [], workspaceChange: true });
  expect(files.closeAllTabsForWorkspaceSwitch).toHaveBeenCalledTimes(1);
  expect(tree.buildFileTree).toHaveBeenCalledWith([], 'notes');
  expect(bridge.send).toHaveBeenCalledWith('to:workspace:set', {
    root: 'notes',
  });
});

it('leaves the old workspace untouched when a same-name switch is cancelled', async () => {
  const { bridge, tree, opened } = setup(false);
  await opened({ path: 'notes', tree: [], workspaceChange: true });
  expect(tree.treeRoot).toBe('notes');
  expect(tree.buildFileTree).not.toHaveBeenCalled();
  expect(bridge.send).not.toHaveBeenCalled();
});

it('treats explicit selection of a child folder as a workspace switch', async () => {
  const { files, tree, opened } = setup();
  await opened({ path: 'notes/sub', tree: [], workspaceChange: true });
  expect(files.closeAllTabsForWorkspaceSwitch).toHaveBeenCalledTimes(1);
  expect(tree.treeRoot).toBe('notes/sub');
});

it('does not confirm or republish the workspace for a lazy directory listing', async () => {
  const { bridge, files, tree, opened } = setup();
  tree.openingFolder = false;
  await opened({ path: 'notes/sub', tree: [] });
  expect(files.closeAllTabsForWorkspaceSwitch).not.toHaveBeenCalled();
  expect(tree.treeRoot).toBe('notes');
  expect(bridge.send).not.toHaveBeenCalled();
});

it('ignores old workspace replies after another root has been adopted', async () => {
  const { bridge, files, tree, opened } = setup();
  tree.treeRoot = 'new-workspace';
  tree.openingFolder = false;
  await opened({ path: 'old-workspace/sub', tree: [] });
  expect(files.closeAllTabsForWorkspaceSwitch).not.toHaveBeenCalled();
  expect(tree.treeRoot).toBe('new-workspace');
  expect(tree.buildFileTree).not.toHaveBeenCalled();
  expect(bridge.send).not.toHaveBeenCalled();
});

it('does not reinterpret a lazy child reply as a selected root while a picker is open', async () => {
  const { bridge, tree, opened } = setup();
  await opened({ path: 'notes/sub', tree: [] });
  expect(tree.treeRoot).toBe('notes');
  expect(bridge.send).not.toHaveBeenCalled();
});

it('cancels AI calls before adopting a workspace so tools cannot target a new root', async () => {
  const { assistant, opened } = setup();
  await opened({ path: 'different-notes', tree: [], workspaceChange: true });
  expect(assistant.cancelCall.mock.calls).toEqual([['first'], ['second']]);
});

it('leaves AI calls intact when a workspace switch is cancelled', async () => {
  const { assistant, opened } = setup(false);
  await opened({ path: 'different-notes', tree: [], workspaceChange: true });
  expect(assistant.cancelCall).not.toHaveBeenCalled();
});
