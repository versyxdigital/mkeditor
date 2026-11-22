import { editor } from 'monaco-editor';
import { FileManager } from '../src/browser/core/FileManager';
import { EditorDispatcher } from '../src/browser/events/EditorDispatcher';
import { openPromptExternal } from '../src/browser/react/contexts/PromptsContext';

jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(() => Promise.resolve({ button: 'deny' })),
}));
jest.mock('../src/browser/i18n', () => ({ t: (key: string) => key }));
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (openPromptExternal as jest.Mock).mockResolvedValue({ button: 'deny' });
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
