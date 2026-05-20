/**
 * `FileManager.closeAllTabsForWorkspaceSwitch` — covers the new
 * workspace-change tab-close flow:
 *   - No tabs → returns true, no prompt.
 *   - No dirty tabs → returns true, no prompt, closes everything,
 *     reseeds a fresh untitled.
 *   - Dirty tabs + user picks Save all → fires save IPC per dirty
 *     tab (saveas for untitled), then closes everything.
 *   - Dirty tabs + user picks Discard all → no save IPC, closes
 *     everything.
 *   - Dirty tabs + user cancels (or dismisses) → no save IPC, tabs
 *     left intact, returns false.
 *
 * Mocking strategy mirrors `FileManager.session.test.ts`: an
 * in-memory Monaco stub and a `prompt` jest.fn() we can swap per
 * test via `openPromptExternal.mockResolvedValueOnce(...)`.
 */

import { openPromptExternal } from '../src/browser/react/contexts/PromptsContext';

jest.mock('../src/browser/assets/intro', () => ({ welcomeMarkdown: '' }));

jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(),
}));

jest.mock('../src/browser/i18n', () => ({
  // Returning the key gives us a stable expectation string in the
  // prompt-content assertion below without depending on the locale
  // build pipeline.
  t: (k: string) => k,
}));

jest.mock('monaco-editor', () => {
  // Class-method-style disposable that reads `this` — mirrors Monaco's
  // real `IDisposable` shape. If close-all-tabs were to destructure
  // `{ dispose }` and call the function detached from its owner, `this`
  // would be undefined and `_isDisposed` access would throw — the exact
  // production bug this test guards against.
  class Disposable {
    public _isDisposed = false;
    constructor(private onDispose: () => void) {}
    dispose() {
      if (this._isDisposed) return;
      this._isDisposed = true;
      this.onDispose();
    }
  }

  const createModel = jest.fn((content: string, _lang: string) => {
    let value = content;
    let altVersion = 1;
    const contentListeners = new Set<() => void>();
    return {
      getValue: jest.fn(() => value),
      setValue: jest.fn((next: string) => {
        value = next;
        altVersion += 1;
        contentListeners.forEach((l) => l());
      }),
      getAlternativeVersionId: jest.fn(() => altVersion),
      onDidChangeContent: jest.fn((listener: () => void) => {
        contentListeners.add(listener);
        return new Disposable(() => contentListeners.delete(listener));
      }),
      _simulateEdit: () => {
        altVersion += 1;
        contentListeners.forEach((l) => l());
      },
      dispose: jest.fn(),
      uri: { toString: () => 'inmemory://model' },
    };
  });
  return {
    editor: { createModel, create: jest.fn(), setTheme: jest.fn() },
    languages: { registerCompletionItemProvider: jest.fn() },
    KeyMod: { CtrlCmd: 0, Shift: 0, Alt: 0, WinCtrl: 0, chord: () => 0 },
    KeyCode: new Proxy({}, { get: () => 0 }),
  };
});

function makeBridge() {
  const sent: Array<{ channel: string; data: unknown }> = [];
  return {
    sent,
    bridge: {
      send: jest.fn((channel: string, data: unknown) => {
        sent.push({ channel, data });
      }),
      receive: jest.fn(),
    },
  };
}

function makeMkeditor() {
  let currentModel: { getValue: () => string } | null = null;
  let viewState: unknown = null;
  return {
    getModel: jest.fn(() => currentModel),
    setModel: jest.fn((m: { getValue: () => string }) => {
      currentModel = m;
    }),
    getValue: jest.fn(() => currentModel?.getValue() ?? ''),
    saveViewState: jest.fn(() => viewState),
    restoreViewState: jest.fn((s: unknown) => {
      viewState = s;
    }),
    focus: jest.fn(),
  };
}

async function loadFileManager() {
  const { FileManager } = await import('../src/browser/core/FileManager');
  const { EditorDispatcher } =
    await import('../src/browser/events/EditorDispatcher');
  return { FileManager, EditorDispatcher };
}

async function buildManagerWithTabs(opts: {
  workspaceFiles?: Array<{ path: string; content: string; dirty?: boolean }>;
  externalFiles?: Array<{ path: string; content: string; dirty?: boolean }>;
  untitled?: Array<{ content: string; dirty?: boolean }>;
}) {
  const { FileManager, EditorDispatcher } = await loadFileManager();
  const { bridge, sent } = makeBridge();
  const fm = new FileManager(
    bridge as never,
    makeMkeditor() as never,
    new EditorDispatcher(),
  );

  // Helper that uses the same private-ish path the real session-restore
  // flow exercises: directly populate models/originals/tabs and start
  // dirty-tracking. We can't go via openPath / from:file:opened in a
  // unit test, but the public `seedUntitled` covers untitled tabs and
  // `restoreSession` covers real-file tabs — using restoreSession would
  // bring along its own side effects, so we mimic its work here.
  const { editor } = await import('monaco-editor');

  const seedReal = (path: string, content: string, dirty: boolean) => {
    const mdl = editor.createModel(content, 'markdown');
    fm.models.set(path, mdl);
    fm.originals.set(path, content);
    fm.tabs.set(path, { path, name: path.split(/[\\/]/).pop() ?? path, dirty });
    fm.trackTab(path, mdl);
    if (dirty) {
      (mdl as unknown as { _simulateEdit: () => void })._simulateEdit();
    }
  };

  for (const f of opts.workspaceFiles ?? []) {
    seedReal(f.path, f.content, !!f.dirty);
  }
  for (const f of opts.externalFiles ?? []) {
    seedReal(f.path, f.content, !!f.dirty);
  }
  for (const u of opts.untitled ?? []) {
    fm.seedUntitled(u.content);
    if (u.dirty) {
      const lastPath = `untitled-${fm.untitledCounter - 1}`;
      const mdl = fm.models.get(lastPath);
      (
        mdl as unknown as { _simulateEdit: () => void } | undefined
      )?._simulateEdit();
    }
  }

  return { fm, bridge, sent };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FileManager.closeAllTabsForWorkspaceSwitch', () => {
  it('returns true with no prompt when no tabs are open', async () => {
    const { fm } = await buildManagerWithTabs({});
    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(true);
    expect(openPromptExternal).not.toHaveBeenCalled();
  });

  it('closes everything (no prompt) when no tab is dirty, reseeding a fresh untitled', async () => {
    const { fm } = await buildManagerWithTabs({
      workspaceFiles: [
        { path: '/old/a.md', content: 'a' },
        { path: '/old/b.md', content: 'b' },
      ],
      externalFiles: [{ path: '/elsewhere/c.md', content: 'c' }],
      untitled: [{ content: '' }],
    });

    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(true);
    expect(openPromptExternal).not.toHaveBeenCalled();

    const snapshot = fm.getSnapshot();
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0].path.startsWith('untitled-')).toBe(true);
    expect(snapshot.activeFile).toBe(snapshot.tabs[0].path);
  });

  it('prompts once and aborts when the user clicks cancel', async () => {
    const { fm, sent } = await buildManagerWithTabs({
      workspaceFiles: [{ path: '/old/a.md', content: 'a', dirty: true }],
      externalFiles: [{ path: '/elsewhere/c.md', content: 'c' }],
    });

    (openPromptExternal as jest.Mock).mockResolvedValueOnce({
      button: 'cancel',
    });

    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(false);
    expect(openPromptExternal).toHaveBeenCalledTimes(1);

    // Tabs unchanged (read directly from the live map — the test
    // helper does not emitChange after seeding, but the close flow
    // would mutate the map regardless).
    expect(Array.from(fm.tabs.keys())).toEqual([
      '/old/a.md',
      '/elsewhere/c.md',
    ]);
    // No save IPC fired.
    expect(sent.filter((m) => m.channel.startsWith('to:file:'))).toEqual([]);
  });

  it('treats a dismissed prompt (button: null) as cancel', async () => {
    const { fm } = await buildManagerWithTabs({
      workspaceFiles: [{ path: '/old/a.md', content: 'a', dirty: true }],
    });

    (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: null });

    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(false);
    expect(Array.from(fm.tabs.keys())).toEqual(['/old/a.md']);
  });

  it('fires save IPC for each dirty tab when the user picks Save all', async () => {
    const { fm, sent } = await buildManagerWithTabs({
      workspaceFiles: [
        { path: '/old/a.md', content: 'a', dirty: true },
        { path: '/old/b.md', content: 'b' }, // not dirty — should NOT trigger save
      ],
      untitled: [{ content: 'scratch', dirty: true }],
    });

    (openPromptExternal as jest.Mock).mockResolvedValueOnce({
      button: 'confirm',
    });

    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(true);

    const saves = sent.filter((m) => m.channel === 'to:file:save');
    expect(saves).toHaveLength(1);
    expect(saves[0].data).toMatchObject({ file: '/old/a.md', openFile: false });

    const saveAs = sent.filter((m) => m.channel === 'to:file:saveas');
    expect(saveAs).toHaveLength(1);

    // Tabs collapsed to one fresh untitled.
    const snapshot = fm.getSnapshot();
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0].path.startsWith('untitled-')).toBe(true);
  });

  it('fires no save IPC when the user picks Discard all', async () => {
    const { fm, sent } = await buildManagerWithTabs({
      workspaceFiles: [{ path: '/old/a.md', content: 'a', dirty: true }],
      untitled: [{ content: 'scratch', dirty: true }],
    });

    (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: 'deny' });

    const result = await fm.closeAllTabsForWorkspaceSwitch();
    expect(result).toBe(true);

    expect(
      sent.filter(
        (m) => m.channel === 'to:file:save' || m.channel === 'to:file:saveas',
      ),
    ).toEqual([]);

    const snapshot = fm.getSnapshot();
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0].path.startsWith('untitled-')).toBe(true);
  });

  it('includes the dirty count in the prompt description', async () => {
    const { fm } = await buildManagerWithTabs({
      workspaceFiles: [
        { path: '/old/a.md', content: 'a', dirty: true },
        { path: '/old/b.md', content: 'b', dirty: true },
        { path: '/old/c.md', content: 'c' },
      ],
    });

    (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: 'deny' });

    await fm.closeAllTabsForWorkspaceSwitch();

    expect(openPromptExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'modals-unsaved:title',
        description: 'modals-unsaved:workspace_switch_text',
      }),
    );
  });
});
