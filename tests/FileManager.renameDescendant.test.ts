/**
 * `FileManager.renameDescendantTabs` — companion to `renameTab` that
 * walks open tabs by parent-folder prefix and migrates each to the
 * new prefix. Triggered by `from:path:renamed` when a directory has
 * moved; ensures tabs inside the moved folder keep working.
 */

jest.mock('../src/browser/assets/intro', () => ({ welcomeMarkdown: '' }));

// `closeTab` would surface a confirm prompt for dirty tabs; we never
// close so the mock just satisfies the import.
jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(() => Promise.resolve({ button: 'deny' })),
}));

jest.mock('monaco-editor', () => {
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
        return { dispose: () => contentListeners.delete(listener) };
      }),
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
  return {
    send: jest.fn(),
    receive: jest.fn(),
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

/** Seed `count` tabs under a parent prefix, one synthetic model each. */
function seedTabsUnder(
  fm: unknown,
  parent: string,
  sep: string,
  names: string[],
) {
  const editorMock = jest.requireMock('monaco-editor') as {
    editor: { createModel: jest.Mock };
  };
  const target = fm as unknown as {
    models: Map<string, unknown>;
    originals: Map<string, string>;
    addTab: (name: string, path: string) => void;
  };
  for (const name of names) {
    const path = `${parent}${sep}${name}`;
    const model = editorMock.editor.createModel(`body of ${name}`, 'markdown');
    target.models.set(path, model);
    target.originals.set(path, `body of ${name}`);
    target.addTab(name, path);
  }
}

describe('FileManager.renameDescendantTabs', () => {
  it('remaps every open tab whose path sits under the moved folder', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const fm = new FileManager(
      makeBridge() as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    seedTabsUnder(fm, '/work/notes', '/', ['a.md', 'b.md', 'sub/c.md']);

    const migrated = fm.renameDescendantTabs('/work/notes', '/work/archive');
    expect(migrated).toBe(3);

    const snapshot = fm.getSnapshot();
    const paths = snapshot.tabs.map((t) => t.path).sort();
    expect(paths).toEqual([
      '/work/archive/a.md',
      '/work/archive/b.md',
      '/work/archive/sub/c.md',
    ]);
    // Old paths no longer present in any state map.
    const internals = fm as unknown as {
      models: Map<string, unknown>;
      originals: Map<string, string>;
    };
    expect(internals.models.has('/work/notes/a.md')).toBe(false);
    expect(internals.originals.has('/work/notes/a.md')).toBe(false);
  });

  it('does not touch tabs whose path merely shares a prefix string', async () => {
    // /work/notes-archive must not match the prefix /work/notes — the
    // walk uses `oldDir + sep` so it's separator-bounded, never raw
    // startsWith. Regression: an earlier draft would have swept the
    // sibling.
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const fm = new FileManager(
      makeBridge() as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    seedTabsUnder(fm, '/work/notes', '/', ['a.md']);
    seedTabsUnder(fm, '/work/notes-archive', '/', ['unrelated.md']);

    const migrated = fm.renameDescendantTabs('/work/notes', '/work/archive');
    expect(migrated).toBe(1);

    const paths = fm
      .getSnapshot()
      .tabs.map((t) => t.path)
      .sort();
    expect(paths).toEqual([
      '/work/archive/a.md',
      '/work/notes-archive/unrelated.md',
    ]);
  });

  it('returns 0 and is a no-op when no open tab lives under the moved folder', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const fm = new FileManager(
      makeBridge() as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    seedTabsUnder(fm, '/work/notes', '/', ['a.md']);

    const migrated = fm.renameDescendantTabs(
      '/work/unrelated',
      '/work/somewhere-else',
    );
    expect(migrated).toBe(0);
    const paths = fm.getSnapshot().tabs.map((t) => t.path);
    expect(paths).toEqual(['/work/notes/a.md']);
  });

  it('handles Windows backslash separators', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const fm = new FileManager(
      makeBridge() as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    seedTabsUnder(fm, 'C:\\work\\notes', '\\', ['a.md', 'b.md']);

    const migrated = fm.renameDescendantTabs(
      'C:\\work\\notes',
      'C:\\work\\archive',
    );
    expect(migrated).toBe(2);
    const paths = fm
      .getSnapshot()
      .tabs.map((t) => t.path)
      .sort();
    expect(paths).toEqual([
      'C:\\work\\archive\\a.md',
      'C:\\work\\archive\\b.md',
    ]);
  });

  it('migrates the activeFile pointer when the active tab sits under the moved folder', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const fm = new FileManager(
      makeBridge() as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    seedTabsUnder(fm, '/work/notes', '/', ['a.md']);
    fm.activateFile('/work/notes/a.md', 'a.md');

    fm.renameDescendantTabs('/work/notes', '/work/archive');
    expect(fm.getSnapshot().activeFile).toBe('/work/archive/a.md');
  });
});
