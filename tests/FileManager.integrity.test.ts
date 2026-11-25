import { editor } from 'monaco-editor';
import {
  FileManager,
  type FileSaveResult,
} from '../src/browser/core/FileManager';
import { FileTreeManager } from '../src/browser/core/FileTreeManager';
import { registerBridgeListeners } from '../src/browser/core/BridgeListeners';
import { EditorDispatcher } from '../src/browser/events/EditorDispatcher';
import { openPromptExternal } from '../src/browser/react/contexts/PromptsContext';
import { sonnerToast } from '../src/browser/notify';
import { remoteDocumentPath } from '../src/app/interfaces/Cloud';

jest.mock('../src/browser/notify', () => ({ sonnerToast: jest.fn() }));

jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(() => Promise.resolve({ button: 'deny' })),
}));
jest.mock('../src/browser/i18n', () => ({
  t: (key: string) => key,
  whenLanguageReady: () => Promise.resolve(),
}));
jest.mock('monaco-editor', () => ({
  editor: {
    createModel: jest.fn((content: string) => {
      let value = content;
      let version = 1;
      const listeners = new Set<() => void>();
      const model = {
        disposed: false,
        getValue: () => value,
        setValue: (next: string) => {
          value = next;
          version++;
          listeners.forEach((listener) => listener());
        },
        getAlternativeVersionId: () => version,
        onDidChangeContent: (listener: () => void) => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
        dispose: jest.fn(() => {
          model.disposed = true;
        }),
      };
      return model;
    }),
  },
}));

function setup() {
  let active: ReturnType<typeof editor.createModel> | null = null;
  const bridge = { send: jest.fn(), receive: jest.fn() };
  const mk = {
    getModel: () => active,
    setModel: (model: typeof active) => {
      active = model;
    },
    getValue: () => active?.getValue() ?? '',
    saveViewState: jest.fn(() => ({ cursorState: [] })),
    restoreViewState: jest.fn(),
    focus: jest.fn(),
    updateOptions: jest.fn(),
  };
  const fm = new FileManager(bridge, mk as never, new EditorDispatcher());
  const add = (path: string, content = 'saved') => {
    const model = editor.createModel(content, 'markdown');
    fm.models.set(path, model);
    fm.originals.set(path, content);
    fm.trackTab(path, model);
    fm.addTab(path.split('/').pop()!, path);
    fm.activateFile(path);
    return model;
  };
  const lastSave = () => {
    const call = bridge.send.mock.calls
      .filter(
        ([channel]) =>
          channel === 'to:file:save' || channel === 'to:file:saveas',
      )
      .at(-1);
    if (!call) throw new Error('No save request');
    return call[1] as { requestId: string; content: string; file?: string };
  };
  return { fm, mk, bridge, add, lastSave };
}

function remoteEditing(provider?: 'google-drive' | 'dropbox') {
  const setupResult = setup();
  const document = {
    ...(provider ? { provider } : {}),
    connectionId: 'drive',
    accountId: 'account',
    connectionName: 'Drive',
    item: {
      id: 'markdown',
      name: 'notes.md',
      kind: 'markdown' as const,
      parents: ['root'],
      validator: '"first"',
      editable: true,
    },
    content: 'original',
  };
  const save = jest.fn<Promise<typeof document>, [unknown]>();
  const reconcile = jest.fn<Promise<typeof document>, [unknown]>();
  const discard = jest.fn().mockResolvedValue(undefined);
  setupResult.fm.setRemoteOperations({
    canEdit: () => true,
    save,
    reconcile,
    discard,
  });
  setupResult.fm.openRemoteDocument(document);
  const path = setupResult.fm.activeFile!;
  const model = setupResult.fm.models.get(path)!;
  return { ...setupResult, document, path, model, save, reconcile, discard };
}

test('remote save acknowledges its captured version and leaves edits made in flight dirty', async () => {
  const { fm, mk, model, path, document, save } = remoteEditing();
  expect(mk.updateOptions).toHaveBeenLastCalledWith({ readOnly: false });
  let acknowledge!: (value: typeof document) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      acknowledge = resolve;
    }),
  );
  model.setValue('snapshot');
  const pending = fm.saveTab(path);
  expect(sonnerToast).not.toHaveBeenCalled();
  model.setValue('newer edits');
  acknowledge({
    ...document,
    content: 'snapshot',
    item: { ...document.item, validator: '"second"' },
  });
  expect(await pending).toBe(true);
  expect(fm.originals.get(path)).toBe('snapshot');
  expect(model.getValue()).toBe('newer edits');
  expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
    true,
  );
  expect(fm.tabs.get(path)?.remote?.item.validator).toBe('"second"');
  expect(sonnerToast).toHaveBeenCalledTimes(1);
  expect(sonnerToast).toHaveBeenCalledWith('success', 'cloud:save_saved');
});

test('discard waits for persistent suppression before disposing a newly opened remote tab', async () => {
  const { fm, model, path, save, discard, document } = remoteEditing();
  let finishSave!: (value: typeof document) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      finishSave = resolve;
    }),
  );
  model.setValue('discarded draft');
  const saving = fm.saveTab(path);
  let persisted!: () => void;
  discard.mockReturnValue(
    new Promise<void>((resolve) => {
      persisted = resolve;
    }),
  );
  const closing = fm.closeTab(path, true);
  expect(discard).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionId: document.connectionId,
      accountId: document.accountId,
    }),
    [save.mock.calls[0][0].operationId],
  );
  expect(fm.models.get(path)).toBe(model);
  expect(await fm.saveTab(path)).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
  persisted();
  expect(await closing).toBe('closed');
  expect(fm.models.has(path)).toBe(false);
  finishSave({ ...document, content: 'discarded draft' });
  expect(await saving).toBe(false);
  expect(fm.models.has(path)).toBe(false);
});

test('failed discard persistence keeps the remote draft open', async () => {
  const { fm, model, path, save, discard } = remoteEditing();
  save.mockRejectedValue('unconfirmed');
  model.setValue('keep this draft');
  await fm.saveTab(path);
  discard.mockRejectedValue('storage');
  expect(await fm.closeTab(path, true)).toBe('aborted');
  expect(fm.models.get(path)).toBe(model);
  expect(model.getValue()).toBe('keep this draft');
});

test('repeated save requests share one Drive write and one success toast', async () => {
  const { fm, model, path, document, save } = remoteEditing();
  model.setValue('draft');
  let acknowledge!: (value: typeof document) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      acknowledge = resolve;
    }),
  );
  const first = fm.saveTab(path);
  const second = fm.saveTab(path);
  expect(sonnerToast).not.toHaveBeenCalled();
  acknowledge({ ...document, content: 'draft' });
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
  expect(sonnerToast).toHaveBeenCalledTimes(1);
});

test.each(['conflict', 'network', 'unconfirmed', 'auth', 'not_applied'])(
  'a %s Drive save keeps the draft without a success toast',
  async (error) => {
    const { fm, model, path, save } = remoteEditing();
    model.setValue('keep my draft');
    save.mockRejectedValue(error);
    expect(await fm.saveTab(path)).toBe(false);
    expect(model.getValue()).toBe('keep my draft');
    expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
      true,
    );
    expect(sonnerToast).not.toHaveBeenCalled();
  },
);

test('unknown remote saves preserve their snapshot, block reload and reconcile without replaying', async () => {
  const { fm, model, path, document, save, reconcile } = remoteEditing();
  save.mockRejectedValue('unconfirmed');
  model.setValue('snapshot');
  expect(await fm.saveTab(path)).toBe(false);
  expect(sonnerToast).not.toHaveBeenCalled();
  model.setValue('newer edit');
  expect(fm.reloadRemoteDocument(path, document)).toBe(false);
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: 'cancel' });
  expect(await fm.closeTab(path)).toBe('aborted');
  reconcile.mockResolvedValue({
    ...document,
    content: 'snapshot',
    item: { ...document.item, validator: '"second"' },
  });
  expect(await fm.saveTab(path)).toBe(true);
  expect(sonnerToast).toHaveBeenCalledTimes(1);
  expect(sonnerToast).toHaveBeenCalledWith('success', 'cloud:save_saved');
  expect(save).toHaveBeenCalledTimes(1);
  expect(reconcile.mock.calls[0][0]).toMatchObject({ content: 'snapshot' });
  expect(model.getValue()).toBe('newer edit');
  expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
    true,
  );
});

test('conflicts never overwrite the buffer and require explicit reload before another save', async () => {
  const { fm, model, path, document, save } = remoteEditing();
  model.setValue('my edits');
  save.mockRejectedValue('conflict');
  expect(await fm.saveTab(path)).toBe(false);
  expect(await fm.saveTab(path)).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
  expect(model.getValue()).toBe('my edits');
  expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
    true,
  );
  expect(
    fm.reloadRemoteDocument(path, { ...document, content: 'latest remote' }),
  ).toBe(true);
  expect(model.getValue()).toBe('latest remote');
  expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
    false,
  );
});

test('remote access changes lock the editor while preserving its unsaved buffer', () => {
  const { fm, mk, model } = remoteEditing();
  model.setValue('unsaved');
  fm.setRemoteOperations({
    canEdit: () => false,
    save: jest.fn(),
    reconcile: jest.fn(),
  });
  fm.refreshRemoteAccess();
  expect(mk.updateOptions).toHaveBeenLastCalledWith({ readOnly: true });
  expect(model.getValue()).toBe('unsaved');
});

test('remote tabs are read-only, account-bound and kept separate from local IO', async () => {
  const { fm, mk, bridge, add } = setup();
  const local = add('/workspace/local.md');
  const document = {
    connectionId: 'drive',
    accountId: 'account-a',
    connectionName: 'My Drive',
    item: {
      id: 'item',
      name: 'notes.md',
      kind: 'markdown' as const,
      parents: ['root'],
      revision: '1',
    },
    content: '# Remote',
  };
  fm.openRemoteDocument(document);
  const remotePath = fm.activeFile!;
  expect(mk.updateOptions).toHaveBeenLastCalledWith({ readOnly: true });
  expect(fm.getActiveEditablePath()).toBeNull();
  expect(fm.getActiveDocumentPath()).toBe(remotePath);
  fm.openRemoteDocument({ ...document, content: 'changed remotely' });
  expect(fm.models.get(remotePath)?.getValue()).toBe('# Remote');
  expect([...fm.tabs.values()].filter((tab) => tab.remote)).toHaveLength(1);
  expect(await fm.saveTab(remotePath)).toBe(false);
  expect(
    bridge.send.mock.calls.some(([channel]) => channel === 'to:file:save'),
  ).toBe(false);
  const session = fm.serializeSession();
  expect(session.tabs.map((tab) => tab.path)).toEqual([
    '/workspace/local.md',
    remotePath,
  ]);
  expect(session.tabs[1].remote).toMatchObject({
    document,
    baseline: document.content,
    dirty: false,
  });
  expect(session.activeFile).toBe(remotePath);
  fm.openRemoteDocument({ ...document, accountId: 'account-b' });
  expect([...fm.tabs.values()].filter((tab) => tab.remote)).toHaveLength(2);
  fm.copyRemoteToLocal(remotePath);
  expect(fm.activeFile).toMatch(/^untitled-/);
  expect(mk.getValue()).toBe('# Remote');
  expect(
    fm.getSnapshot().tabs.find((tab) => tab.path === fm.activeFile)?.dirty,
  ).toBe(true);
  expect(mk.updateOptions).toHaveBeenLastCalledWith({ readOnly: false });
  fm.activateFile('/workspace/local.md');
  expect(mk.getModel()).toBe(local);
  expect(mk.updateOptions).toHaveBeenLastCalledWith({ readOnly: false });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (openPromptExternal as jest.Mock).mockResolvedValue({ button: 'deny' });
});

function setupSaveTree(root = '/workspace') {
  const state = setup();
  const tree = new FileTreeManager(state.bridge, () => {});
  tree.buildFileTree([], root);
  const handlers = new Map<string, (result: FileSaveResult) => void>();
  state.bridge.receive.mockImplementation((channel, handler) => {
    handlers.set(channel, handler);
  });
  registerBridgeListeners(
    state.bridge,
    state.mk as never,
    new EditorDispatcher(),
    {} as never,
    state.fm,
    tree,
    {} as never,
  );
  return { ...state, tree, saved: handlers.get('from:file:save-result')! };
}

describe('acknowledged saves update the explorer', () => {
  it.each([
    ['/workspace', '/workspace/new.md'],
    ['C:\\workspace', 'C:\\workspace\\new.md'],
    ['notes', 'notes/new.md'],
  ])(
    'shows an untitled document saved into %s without reopening the folder',
    async (root, destination) => {
      const { fm, tree, add, lastSave, saved, bridge } = setupSaveTree(root);
      const model = add('untitled-1', '# New document');
      const save = fm.saveContentToFile();
      expect(tree.getSnapshot().nodes).toEqual([]);
      saved({ requestId: lastSave().requestId, ok: true, path: destination });
      await expect(save).resolves.toBe(true);
      expect(tree.getSnapshot().nodes).toEqual([
        { type: 'file', name: 'new.md', path: destination },
      ]);
      expect(fm.models.get(destination)).toBe(model);
      expect(fm.getSnapshot().tabs[0].dirty).toBe(false);
      expect(bridge.send).not.toHaveBeenCalledWith(
        'to:file:openpath',
        expect.anything(),
      );
    },
  );

  it('keeps the original entry and inactive source model when Save As completes after switching tabs', async () => {
    const { fm, tree, add, lastSave, saved } = setupSaveTree();
    const model = add('/workspace/original.md');
    tree.addFileToTree('/workspace/original.md');
    const save = fm.saveContentToFile(true);
    add('/workspace/other.md');
    saved({
      requestId: lastSave().requestId,
      ok: true,
      path: '/workspace/copy.md',
    });
    await expect(save).resolves.toBe(true);
    expect(tree.getSnapshot().nodes.map((node) => node.name)).toEqual([
      'copy.md',
      'original.md',
    ]);
    expect(fm.models.get('/workspace/copy.md')).toBe(model);
    expect(fm.activeFile).toBe('/workspace/other.md');
  });

  it.each([false, true])(
    'does not insert a failed or cancelled save (cancelled=%s)',
    async (cancelled) => {
      const { fm, tree, add, lastSave, saved } = setupSaveTree();
      add('untitled-1').setValue('unsaved');
      const save = fm.saveContentToFile();
      saved({
        requestId: lastSave().requestId,
        ok: false,
        cancelled,
        path: '/workspace/new.md',
      });
      await expect(save).resolves.toBe(false);
      expect(tree.getSnapshot().nodes).toEqual([]);
      expect(fm.models.has('untitled-1')).toBe(true);
      expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
    },
  );

  it('keeps files saved outside the workspace out of its tree', async () => {
    const { fm, tree, add, lastSave, saved } = setupSaveTree();
    add('untitled-1');
    const save = fm.saveContentToFile();
    saved({
      requestId: lastSave().requestId,
      ok: true,
      path: '/workspace-other/new.md',
    });
    await expect(save).resolves.toBe(true);
    expect(tree.getSnapshot().nodes).toEqual([]);
  });

  it('preserves loaded subtrees and does not duplicate entries on repeated saves or acknowledgements', async () => {
    const { fm, tree, add, lastSave, saved } = setupSaveTree();
    tree.buildFileTree(
      [
        {
          type: 'directory',
          name: 'docs',
          path: '/workspace/docs',
          loaded: true,
          hasChildren: true,
          children: [
            {
              type: 'file',
              name: 'guide.md',
              path: '/workspace/docs/guide.md',
            },
          ],
        },
      ],
      '/workspace',
    );
    const subtree = tree.getSnapshot().nodes[0];
    add('untitled-1');
    for (let i = 0; i < 2; i++) {
      const save = fm.saveContentToFile();
      const result = {
        requestId: lastSave().requestId,
        ok: true,
        path: '/workspace/new.md',
      };
      saved(result);
      saved(result);
      await expect(save).resolves.toBe(true);
    }
    expect(tree.getSnapshot().nodes.map((node) => node.name)).toEqual([
      'docs',
      'new.md',
    ]);
    expect(tree.getSnapshot().nodes[0]).toBe(subtree);
    expect(subtree.children?.[0].name).toBe('guide.md');
    expect(subtree.loaded).toBe(true);
  });
});

it('does not undo a rename or mark the new path clean when an old save completes', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/A.md');
  model.setValue('changed');
  const save = fm.saveContentToFile();
  const requestId = lastSave().requestId;
  fm.renameTab('/A.md', '/B.md', 'B.md');
  fm.onSaveResult({ requestId, ok: true, path: '/A.md' });
  await expect(save).resolves.toBe(false);
  expect([...fm.models.keys()]).toEqual(['/B.md']);
  expect(fm.activeFile).toBe('/B.md');
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
});

it('excludes other open document paths from Save As before any disk write', () => {
  const { fm, add, bridge } = setup();
  add('/other.md');
  add('/source.md');
  void fm.saveContentToFile(true);
  expect(bridge.send).toHaveBeenCalledWith(
    'to:file:saveas',
    expect.objectContaining({
      excludedPaths: ['/other.md'],
    }),
  );
});

it('keeps window-close protection enabled for a dirty inactive tab', () => {
  const { fm, add, bridge } = setup();
  const dirty = add('/dirty.md');
  dirty.setValue('unsaved');
  add('/clean.md');
  expect(bridge.send).toHaveBeenLastCalledWith('to:editor:state', true);
  fm.trackContentHasChanged(false);
  expect(bridge.send).toHaveBeenLastCalledWith('to:editor:state', true);
});

it('records an acknowledged tool save without clearing edits typed during the write', () => {
  const { fm, add } = setup();
  const model = add('/notes.md');
  model.setValue('tool edit');
  const savedVersion = model.getAlternativeVersionId();
  model.setValue('typed during save');
  fm.recordSavedVersion('/notes.md', model, 'tool edit', savedVersion);
  expect(fm.originals.get('/notes.md')).toBe('tool edit');
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
  fm.recordSavedVersion(
    '/notes.md',
    model,
    model.getValue(),
    model.getAlternativeVersionId(),
  );
  expect(fm.getSnapshot().tabs[0].dirty).toBe(false);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('keeps a failed write dirty and preserves the last saved baseline', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('unsaved');
  const save = fm.saveContentToFile();
  expect(fm.originals.get('/notes.md')).toBe('saved');
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: false,
    error: 'disk full',
  });
  await expect(save).resolves.toBe(false);
  expect(fm.originals.get('/notes.md')).toBe('saved');
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
});

it('acknowledges the saved revision without clearing edits typed during the write', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('first edit');
  const save = fm.saveContentToFile();
  model.setValue('newer edit');
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(save).resolves.toBe(true);
  expect(fm.originals.get('/notes.md')).toBe('first edit');
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
  expect(fm.contentHasChanged).toBe(true);
});

it('clears dirty state only after a successful acknowledged write', async () => {
  const { fm, add, lastSave } = setup();
  add('/notes.md').setValue('new text');
  const save = fm.saveContentToFile();
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(save).resolves.toBe(true);
  expect(fm.getSnapshot().tabs[0].dirty).toBe(false);
  expect(fm.contentHasChanged).toBe(false);
});

it('times out a missing save reply without clearing the buffer or accepting late replies', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('unsaved');
  const save = fm.saveContentToFile();
  const requestId = lastSave().requestId;
  jest.advanceTimersByTime(60_000);
  await expect(save).resolves.toBe(false);
  fm.onSaveResult({ requestId, ok: true, path: '/notes.md' });
  expect(fm.getSnapshot().tabs[0].dirty).toBe(true);
  expect(fm.models.get('/notes.md')).toBe(model);
});

it('deduplicates identical in-flight saves', async () => {
  const { fm, add, bridge, lastSave } = setup();
  add('/notes.md').setValue('unsaved');
  const first = fm.saveContentToFile();
  const second = fm.saveContentToFile();
  expect(second).toBe(first);
  expect(
    bridge.send.mock.calls.filter(([channel]) => channel === 'to:file:save'),
  ).toHaveLength(1);
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(first).resolves.toBe(true);
});

it('serializes a newer save behind an older pending write', async () => {
  const { fm, add, bridge, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('first edit');
  const first = fm.saveContentToFile();
  model.setValue('second edit');
  const second = fm.saveContentToFile();
  expect(
    bridge.send.mock.calls.filter(([channel]) => channel === 'to:file:save'),
  ).toHaveLength(1);
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await first;
  await Promise.resolve();
  expect(lastSave().content).toBe('second edit');
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(second).resolves.toBe(true);
  expect(fm.originals.get('/notes.md')).toBe('second edit');
});

it('rekeys the Save As source rather than the tab selected during the picker', async () => {
  const { fm, add, lastSave } = setup();
  fm.seedUntitled('scratch');
  const source = fm.models.get('untitled-1');
  const save = fm.saveContentToFile();
  add('/other.md', 'other');
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/scratch.md',
  });
  await expect(save).resolves.toBe(true);
  expect(fm.models.get('/scratch.md')).toBe(source);
  expect(fm.models.has('untitled-1')).toBe(false);
  expect(fm.models.get('/other.md')?.getValue()).toBe('other');
  expect(fm.activeFile).toBe('/other.md');
});

it('does not overwrite an already open target model after Save As', async () => {
  const { fm, add, lastSave } = setup();
  const target = add('/target.md', 'target with edits');
  fm.seedUntitled('scratch');
  const source = fm.models.get('untitled-1');
  const save = fm.saveContentToFile();
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/target.md',
  });
  await expect(save).resolves.toBe(false);
  expect(fm.models.get('/target.md')).toBe(target);
  expect(fm.models.get('untitled-1')).toBe(source);
});

it('waits for Save and close to succeed before disposing a dirty model', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('unsaved');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({
    button: 'confirm',
  });
  const close = fm.closeTab('/notes.md');
  await Promise.resolve();
  expect(model.dispose).not.toHaveBeenCalled();
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(close).resolves.toBe('closed');
  expect(model.dispose).toHaveBeenCalledTimes(1);
});

it('retains the tab after Save and close fails', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('unsaved');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({
    button: 'confirm',
  });
  const close = fm.closeTab('/notes.md');
  await Promise.resolve();
  fm.onSaveResult({ requestId: lastSave().requestId, ok: false });
  await expect(close).resolves.toBe('aborted');
  expect(model.dispose).not.toHaveBeenCalled();
  expect(fm.models.get('/notes.md')).toBe(model);
});

it('retains edits entered during Save and close', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/notes.md');
  model.setValue('unsaved');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({
    button: 'confirm',
  });
  const close = fm.closeTab('/notes.md');
  await Promise.resolve();
  model.setValue('new edit during save');
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: true,
    path: '/notes.md',
  });
  await expect(close).resolves.toBe('aborted');
  expect(model.dispose).not.toHaveBeenCalled();
});

it('preserves the workspace when Save all fails', async () => {
  const { fm, add, lastSave } = setup();
  const model = add('/old/notes.md');
  model.setValue('unsaved');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({
    button: 'confirm',
  });
  const close = fm.closeAllTabsForWorkspaceSwitch();
  await Promise.resolve();
  fm.onSaveResult({ requestId: lastSave().requestId, ok: false });
  await expect(close).resolves.toBe(false);
  expect(fm.models.get('/old/notes.md')).toBe(model);
  expect(model.dispose).not.toHaveBeenCalled();
});

it('preserves an untitled tab if the Save As picker is cancelled during close', async () => {
  const { fm, lastSave } = setup();
  fm.seedUntitled('restored scratch');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({
    button: 'confirm',
  });
  const close = fm.closeTab('untitled-1');
  await Promise.resolve();
  fm.onSaveResult({
    requestId: lastSave().requestId,
    ok: false,
    cancelled: true,
  });
  await expect(close).resolves.toBe('aborted');
  expect(fm.models.get('untitled-1')?.getValue()).toBe('restored scratch');
});

it('does not expose the previously selected real path for an active scratch buffer or its diff overlay', () => {
  const { fm, add } = setup();
  add('/notes.md');
  fm.seedUntitled('scratch');
  expect(fm.getActiveEditablePath()).toBeNull();
  fm.openDiffTab({
    id: 'diff://one',
    name: 'Review',
    original: '',
    modified: 'new',
  });
  expect(fm.getActiveEditablePath()).toBeNull();
});

it('does not replace a populated scratch buffer with another file', () => {
  const { fm } = setup();
  fm.seedUntitled('valuable scratch');
  expect(fm.replaceUntitled('/other.md', 'other.md', 'other content')).toBe(
    false,
  );
  expect(fm.models.get('untitled-1')?.getValue()).toBe('valuable scratch');
});

it('swaps the backing editor model before closing a file under an active diff', async () => {
  const { fm, add, mk } = setup();
  const model = add('/notes.md');
  fm.openDiffTab({
    id: 'diff://one',
    name: 'Review',
    original: '',
    modified: 'new',
  });
  await expect(fm.closeTab('/notes.md')).resolves.toBe('closed');
  expect(mk.getModel()).not.toBe(model);
  expect(fm.activeFile).toBe('diff://one');
  expect(fm.getActiveEditablePath()).toBeNull();
});

it('still prompts for an inactive dirty document when the active tab is a log', async () => {
  const { fm, add } = setup();
  const notes = add('/notes.md');
  notes.setValue('unsaved');
  add('/main.log', 'log');
  (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: 'cancel' });
  await expect(fm.closeTab('/notes.md')).resolves.toBe('aborted');
  expect(fm.models.get('/notes.md')).toBe(notes);
});

it('restores saved tab order and the view state of an already active seed', () => {
  const { fm, mk } = setup();
  fm.seedUntitled('seed one');
  fm.seedUntitled('seed two');
  const view = { cursorState: [{ position: { lineNumber: 4, column: 2 } }] };
  fm.restoreSession({
    session: {
      version: 2,
      workspaceRoot: null,
      activeFile: 'untitled-2',
      tabs: [
        {
          path: 'untitled-2',
          name: 'Two',
          untitledContent: 'restored two',
          viewState: view,
        },
        {
          path: 'untitled-1',
          name: 'One',
          untitledContent: 'restored one',
          viewState: null,
        },
      ],
    },
    contents: {},
    missing: [],
  });
  expect([...fm.tabs.keys()]).toEqual(['untitled-2', 'untitled-1']);
  expect(mk.restoreViewState).toHaveBeenCalledWith(view);
});

it('also detaches a closing active file when its next tab is a diff overlay', async () => {
  const { fm, add, mk } = setup();
  const model = add('/notes.md');
  fm.openDiffTab({
    id: 'diff://one',
    name: 'Review',
    original: '',
    modified: 'new',
  });
  fm.activateFile('/notes.md');
  await expect(fm.closeTab('/notes.md')).resolves.toBe('closed');
  expect(mk.getModel()).not.toBe(model);
  expect(fm.activeFile).toBe('diff://one');
});

test.each(['google-drive', 'dropbox'] as const)(
  '%s moving a dirty remote document keeps its identity, model and saved baseline',
  async (provider) => {
    const { fm, document, model, path } = remoteEditing(provider);
    model.setValue('unsaved draft');
    const baseline = fm.originals.get(path);
    await fm.moveRemoteDocument(document, async () => ({
      item: { ...document.item, parents: ['drafts'], validator: '"moved"' },
      previousValidator: '"first"',
    }));
    expect(fm.models.get(path)).toBe(model);
    expect(model.getValue()).toBe('unsaved draft');
    expect(fm.originals.get(path)).toBe(baseline);
    expect(fm.getSnapshot().tabs.find((tab) => tab.path === path)?.dirty).toBe(
      true,
    );
    expect(fm.tabs.get(path)?.remote?.item).toMatchObject({
      id: 'markdown',
      parents: ['drafts'],
      validator: '"moved"',
    });
  },
);

test.each(['google-drive', 'dropbox'] as const)(
  '%s moving never advances a validator across an external content change',
  async (provider) => {
    const { fm, document, path, model } = remoteEditing(provider);
    await fm.moveRemoteDocument(document, async () => ({
      item: {
        ...document.item,
        parents: ['drafts'],
        contentRevision: 'external',
        validator: '"external"',
      },
      previousValidator: '"first"',
    }));
    expect(fm.tabs.get(path)?.remote?.item.validator).toBe('"first"');
    expect(model.getValue()).toBe('original');
  },
);

test.each(['google-drive', 'dropbox'] as const)(
  '%s save waits for an active move and uses its acknowledged validator',
  async (provider) => {
    const { fm, document, model, path, save } = remoteEditing(provider);
    let complete!: (value: {
      item: typeof document.item;
      previousValidator: string;
    }) => void;
    const moving = fm.moveRemoteDocument(
      document,
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await Promise.resolve();
    model.setValue('draft');
    const saving = fm.saveTab(path);
    expect(save).not.toHaveBeenCalled();
    expect(fm.hasUnconfirmedRemoteSave(path)).toBe(true);
    save.mockResolvedValue({
      ...document,
      content: 'draft',
      item: { ...document.item, parents: ['drafts'], validator: '"saved"' },
    });
    complete({
      item: { ...document.item, parents: ['drafts'], validator: '"moved"' },
      previousValidator: '"first"',
    });
    await moving;
    expect(await saving).toBe(true);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({
          item: expect.objectContaining({ validator: '"moved"' }),
        }),
      }),
    );
  },
);

test('a failed move releases its lock and retains the original document', async () => {
  const { fm, document, model, path } = remoteEditing();
  await expect(
    fm.moveRemoteDocument(document, async () => {
      throw 'permission';
    }),
  ).rejects.toBe('permission');
  expect(fm.hasUnconfirmedRemoteSave(path)).toBe(false);
  expect(fm.tabs.get(path)?.remote?.item.parents).toEqual(['root']);
  expect(model.getValue()).toBe('original');
  expect(fm.tabs.get(path)?.remoteSave).toBeUndefined();
});

test.each(['google-drive', 'dropbox'] as const)(
  '%s an uncertain move blocks content saves until its location is checked',
  async (provider) => {
    const { fm, document, path, model, save } = remoteEditing(provider);
    model.setValue('unsaved draft');
    await expect(
      fm.moveRemoteDocument(document, async () => {
        throw 'unconfirmed';
      }),
    ).rejects.toBe('unconfirmed');
    expect(await fm.saveTab(path)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await fm.moveRemoteDocument(document, async () => ({
      item: { ...document.item, parents: ['drafts'], validator: '"moved"' },
      previousValidator: '"first"',
    }));
    save.mockResolvedValue({
      ...document,
      content: 'unsaved draft',
      item: { ...document.item, validator: '"saved"' },
    });
    expect(await fm.saveTab(path)).toBe(true);
  },
);

test.each(['google-drive', 'dropbox'] as const)(
  '%s restored moves block the matching provider tab until checked',
  async (provider) => {
    const { fm, document, path, model, save } = remoteEditing(provider);
    model.setValue('restored draft');
    fm.markRecoveredMoves([
      {
        provider,
        connectionId: document.connectionId,
        accountId: document.accountId,
        itemId: document.item.id,
        operationId: 'move',
        kind: 'move',
      },
    ]);
    expect(fm.hasUnconfirmedRemoteSave(path)).toBe(true);
    expect(await fm.saveTab(path)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    fm.clearUnappliedMove(
      document.connectionId,
      document.accountId,
      document.item.id,
      provider,
    );
    expect(fm.hasUnconfirmedRemoteSave(path)).toBe(false);
    expect(model.getValue()).toBe('restored draft');
  },
);

test('an unconfirmed move blocks saves until its location is checked', async () => {
  const { fm, document, model, path, save } = remoteEditing();
  model.setValue('unsaved');
  await expect(
    fm.moveRemoteDocument(document, async () => {
      throw 'unconfirmed';
    }),
  ).rejects.toBe('unconfirmed');
  expect(await fm.saveTab(path)).toBe(false);
  expect(save).not.toHaveBeenCalled();
  await fm.moveRemoteDocument(document, async () => ({
    item: { ...document.item, parents: ['drafts'], validator: '"moved"' },
    previousValidator: '"first"',
  }));
  expect(fm.hasUnconfirmedRemoteSave(path)).toBe(false);
  expect(model.getValue()).toBe('unsaved');
});

test('remote session restores a dirty draft offline with its baseline, identity and view state', () => {
  const source = remoteEditing();
  source.model.setValue('recovered draft');
  source.fm.viewStates.set(source.path, { cursorState: [] } as never);
  const payload = source.fm.serializeSession();
  const restored = setup();
  restored.fm.setRemoteOperations({
    canEdit: () => false,
    canCheck: () => false,
    save: jest.fn(),
    reconcile: jest.fn(),
  });
  restored.fm.restoreSession({ session: payload, contents: {}, missing: [] });
  expect(restored.fm.activeFile).toBe(source.path);
  expect(restored.mk.getValue()).toBe('recovered draft');
  expect(restored.fm.originals.get(source.path)).toBe('original');
  expect(restored.fm.getSnapshot().tabs[0]).toMatchObject({
    dirty: true,
    remoteRecovery: { status: 'waiting' },
  });
  expect(restored.mk.updateOptions).toHaveBeenLastCalledWith({
    readOnly: false,
  });
});

test('recovered drafts validate the remote baseline before the first save', async () => {
  const source = remoteEditing();
  source.model.setValue('draft');
  const restored = setup();
  let resolveCheck!: (value: typeof source.document) => void;
  const check = jest.fn(
    () =>
      new Promise<typeof source.document>((resolve) => {
        resolveCheck = resolve;
      }),
  );
  const save = jest.fn(async () => ({
    ...source.document,
    content: 'draft',
    item: { ...source.document.item, validator: '"saved"' },
  }));
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    check,
    save,
    reconcile: jest.fn(),
  });
  restored.fm.restoreSession({
    session: source.fm.serializeSession(),
    contents: {},
    missing: [],
  });
  const saving = restored.fm.saveTab(source.path);
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  resolveCheck({
    ...source.document,
    item: { ...source.document.item, validator: '"checked"' },
  });
  expect(await saving).toBe(true);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      document: expect.objectContaining({
        item: expect.objectContaining({ validator: '"checked"' }),
      }),
    }),
  );
});

test('an external change during downtime preserves the recovered draft and opens conflict recovery', async () => {
  const source = remoteEditing();
  source.model.setValue('my draft');
  const restored = setup();
  const save = jest.fn();
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    check: async () => ({ ...source.document, content: 'changed in Drive' }),
    save,
    reconcile: jest.fn(),
  });
  restored.fm.restoreSession({
    session: source.fm.serializeSession(),
    contents: {},
    missing: [],
  });
  expect(await restored.fm.checkRemoteRecovery(source.path)).toBe(false);
  expect(restored.mk.getValue()).toBe('my draft');
  expect(restored.fm.tabs.get(source.path)?.remoteSave?.phase).toBe('conflict');
  expect(save).not.toHaveBeenCalled();
});

test('a restored clean document refreshes from Drive while intervening local edits are retained', async () => {
  const source = remoteEditing();
  const restored = setup();
  let finish!: (document: typeof source.document) => void;
  const check = jest.fn(
    () =>
      new Promise<typeof source.document>((resolve) => {
        finish = resolve;
      }),
  );
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    check,
    save: jest.fn(),
    reconcile: jest.fn(),
  });
  restored.fm.restoreSession({
    session: source.fm.serializeSession(),
    contents: {},
    missing: [],
  });
  const checking = restored.fm.checkRemoteRecovery(source.path);
  await Promise.resolve();
  restored.fm.models.get(source.path)!.setValue('typed during the check');
  finish({ ...source.document, content: 'remote update' });
  expect(await checking).toBe(false);
  expect(restored.mk.getValue()).toBe('typed during the check');
  expect(restored.fm.tabs.get(source.path)?.remoteSave?.phase).toBe('conflict');
});

test('a missing Drive file leaves its recovered text available and never recreates it', async () => {
  const source = remoteEditing();
  source.model.setValue('keep this');
  const restored = setup();
  const save = jest.fn();
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    check: async () => {
      throw 'missing';
    },
    save,
    reconcile: jest.fn(),
  });
  restored.fm.restoreSession({
    session: source.fm.serializeSession(),
    contents: {},
    missing: [],
  });
  expect(await restored.fm.checkRemoteRecovery(source.path)).toBe(false);
  expect(restored.mk.getValue()).toBe('keep this');
  expect(restored.fm.tabs.get(source.path)?.remoteRecovery?.error).toBe(
    'missing',
  );
  expect(save).not.toHaveBeenCalled();
});

test('interrupted saves are reconciled after restoring and newer draft edits stay dirty', async () => {
  const source = remoteEditing();
  source.model.setValue('write snapshot');
  let complete!: (document: typeof source.document) => void;
  source.save.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const sourceSave = source.fm.saveTab(source.path);
  source.model.setValue('newer draft');
  const payload = source.fm.serializeSession();
  const restored = setup();
  const save = jest.fn();
  const acknowledged = {
    ...source.document,
    content: 'write snapshot',
    item: { ...source.document.item, validator: '"acknowledged"' },
  };
  const reconcile = jest.fn(async () => acknowledged);
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    check: async () => acknowledged,
    save,
    reconcile,
  });
  restored.fm.restoreSession({ session: payload, contents: {}, missing: [] });
  expect(await restored.fm.checkRemoteRecovery(source.path)).toBe(true);
  expect(restored.mk.getValue()).toBe('newer draft');
  expect(restored.fm.originals.get(source.path)).toBe('write snapshot');
  expect(restored.fm.getSnapshot().tabs[0].dirty).toBe(true);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  expect(sonnerToast).not.toHaveBeenCalled();
  complete(acknowledged);
  await sourceSave;
});

test('a recovered Dropbox creation adopts its confirmed file ID without losing newer edits', async () => {
  const restored = setup();
  const pending = {
    provider: 'dropbox' as const,
    pendingCreate: true,
    connectionId: 'dropbox',
    accountId: 'account',
    connectionName: 'Dropbox',
    item: {
      id: 'pending:creation',
      name: 'created.md',
      kind: 'markdown' as const,
      parents: ['root'],
      editable: true,
    },
    content: 'newer writing',
  };
  const originalPath = remoteDocumentPath(pending);
  const confirmed = {
    ...pending,
    pendingCreate: undefined,
    operationId: 'creation',
    item: { ...pending.item, id: 'id:permanent', validator: '"000000001"' },
    content: 'write snapshot',
  };
  const permanentPath = remoteDocumentPath(confirmed);
  const save = jest.fn();
  restored.fm.setRemoteOperations({
    canEdit: () => true,
    canCheck: () => true,
    save,
    reconcile: async () => confirmed,
    check: async () => confirmed,
  });
  restored.fm.restoreSession({
    session: {
      version: 3,
      workspaceRoot: null,
      activeFile: originalPath,
      tabs: [
        {
          path: originalPath,
          name: 'created.md',
          viewState: null,
          remote: {
            document: pending,
            baseline: '',
            dirty: true,
            pendingSave: {
              operationId: 'creation',
              content: 'write snapshot',
              validator: '',
            },
          },
        },
      ],
    },
    contents: {},
    missing: [],
  });
  const model = restored.fm.models.get(originalPath);
  expect(await restored.fm.checkRemoteRecovery(originalPath)).toBe(true);
  expect(restored.fm.models.get(permanentPath)).toBe(model);
  expect(restored.fm.activeFile).toBe(permanentPath);
  expect(model?.getValue()).toBe('newer writing');
  expect(restored.fm.originals.get(permanentPath)).toBe('write snapshot');
  expect(restored.fm.getSnapshot().tabs[0]).toMatchObject({
    path: permanentPath,
    dirty: true,
    remote: { provider: 'dropbox' },
  });
  expect(restored.fm.serializeSession().tabs[0].remote?.document.item.id).toBe(
    'id:permanent',
  );
  expect(save).not.toHaveBeenCalled();
  expect(sonnerToast).not.toHaveBeenCalled();
});

test('remote typing checkpoints are bounded even while the debounce keeps being reset', () => {
  jest.useFakeTimers();
  try {
    const source = remoteEditing();
    source.bridge.send.mockClear();
    for (let index = 0; index < 6; index++) {
      source.model.setValue(`draft ${index}`);
      jest.advanceTimersByTime(250);
    }
    const checkpoints = source.bridge.send.mock.calls.filter(
      ([channel]) => channel === 'to:session:save',
    );
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0][1].tabs[0].remote.document.content).toMatch(
      /^draft /,
    );
  } finally {
    jest.useRealTimers();
  }
});

test('checkpoint backpressure sends the latest draft and waits for an acknowledged final flush', () => {
  jest.useFakeTimers();
  try {
    const source = remoteEditing();
    source.fm.setCheckpointAcknowledgements(true);
    source.bridge.send.mockClear();
    source.model.setValue('first checkpoint');
    jest.advanceTimersByTime(350);
    for (let i = 0; i < 6; i++) {
      source.model.setValue(`latest ${i}`);
      jest.advanceTimersByTime(250);
    }
    const sent = () =>
      source.bridge.send.mock.calls.filter(
        ([channel]) => channel === 'to:session:save',
      );
    expect(sent()).toHaveLength(1);
    source.fm.flushSessionCheckpoint('final');
    expect(sent()).toHaveLength(1);
    source.fm.onSessionCheckpointSaved();
    expect(sent()).toHaveLength(2);
    expect(sent()[1][1]).toMatchObject({
      flushId: 'final',
      tabs: [
        expect.objectContaining({
          remote: expect.objectContaining({
            document: expect.objectContaining({ content: 'latest 5' }),
          }),
        }),
      ],
    });
    source.fm.onSessionCheckpointSaved();
    expect(sent()).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
});

test('a delayed session restore preserves live edits and keeps the older recovered draft separately', () => {
  const source = remoteEditing();
  source.model.setValue('older recovered draft');
  const live = remoteEditing();
  live.model.setValue('new live edits');
  live.fm.restoreSession({
    session: source.fm.serializeSession(),
    contents: {},
    missing: [],
  });
  expect(live.fm.activeFile).toBe(live.path);
  expect(live.model.getValue()).toBe('new live edits');
  expect(
    [...live.fm.models].some(
      ([path, model]) =>
        path.startsWith('untitled-') &&
        model.getValue() === 'older recovered draft',
    ),
  ).toBe(true);
});
