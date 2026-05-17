/**
 * FileManager session-persistence unit tests.
 *
 * Covers `serializeSession`, `restoreSession`, and the debounced
 * `scheduleSessionSave` triggers wired into the mutating methods.
 *
 * Monaco is mocked: `editor.createModel` returns a tiny in-memory
 * model, and the editor stub captures the current model + view state
 * so we can drive `setModel` / `saveViewState` / `restoreViewState`
 * end-to-end without pulling Monaco in.
 */

import type { SessionRestoreEnvelope } from '../src/browser/interfaces/Session';

// --- Mocks --------------------------------------------------------

jest.mock('../src/browser/assets/intro', () => ({ welcomeMarkdown: '' }));

// React/Radix context plumbing isn't needed; openPromptExternal is
// only invoked from `closeTab` and our tests don't close dirty tabs.
jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(() => Promise.resolve({ button: 'deny' })),
}));

jest.mock('monaco-editor', () => {
  const createModel = jest.fn((content: string, _lang: string) => {
    let value = content;
    return {
      getValue: jest.fn(() => value),
      setValue: jest.fn((next: string) => {
        value = next;
      }),
      dispose: jest.fn(),
      // FileManager doesn't read these but Monaco models expose them.
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

// --- Helpers ------------------------------------------------------

function makeBridge() {
  const sent: Array<{ channel: string; data: unknown }> = [];
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    sent,
    handlers,
    bridge: {
      send: jest.fn((channel: string, data: unknown) => {
        sent.push({ channel, data });
      }),
      receive: jest.fn((channel: string, fn: (...args: unknown[]) => void) => {
        handlers[channel] = fn;
      }),
    },
  };
}

function makeMkeditor() {
  let currentModel: { getValue: () => string } | null = null;
  let viewState: unknown = null;
  const stub = {
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
    // Test-only: let a test push a synthetic view state that
    // `saveViewState()` will return on the next call.
    __setNextViewState: (s: unknown) => {
      viewState = s;
    },
  };
  return stub;
}

async function loadFileManager() {
  const { FileManager } = await import('../src/browser/core/FileManager');
  const { EditorDispatcher } =
    await import('../src/browser/events/EditorDispatcher');
  return { FileManager, EditorDispatcher };
}

// --- Tests --------------------------------------------------------

describe('FileManager.serializeSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an empty payload when no tabs are open', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    const payload = fm.serializeSession();
    expect(payload).toEqual({
      version: 1,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
    });
  });

  it('includes the workspace root from the injected getter', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.setWorkspaceRootGetter(() => '/abs/my-notes');
    const payload = fm.serializeSession();
    expect(payload.workspaceRoot).toBe('/abs/my-notes');
  });

  it('serialises workspaceRoot as null when no getter is set', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    const payload = fm.serializeSession();
    expect(payload.workspaceRoot).toBeNull();
  });

  it('captures the active tab view state at serialise time', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const mk = makeMkeditor();
    const fm = new FileManager(
      bridge as never,
      mk as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('hello');
    // Pretend the cursor moved — saveViewState will now return a marker.
    mk.__setNextViewState({ marker: 'fresh-cursor' });

    const payload = fm.serializeSession();
    expect(payload.tabs).toHaveLength(1);
    expect(payload.tabs[0].path).toBe('untitled-1');
    expect(payload.tabs[0].viewState).toEqual({ marker: 'fresh-cursor' });
    expect(payload.activeFile).toBe('untitled-1');
  });

  it('inlines untitled content only when non-empty', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('scratch');
    const payload = fm.serializeSession();
    expect(payload.tabs[0].untitledContent).toBe('scratch');
  });

  it('drops untitledContent for empty untitled buffers', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('');
    const payload = fm.serializeSession();
    expect(payload.tabs[0].untitledContent).toBeUndefined();
  });
});

describe('FileManager.restoreSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function envelope(
    tabs: SessionRestoreEnvelope['session'] extends infer T
      ? T extends null
        ? never
        : NonNullable<T>['tabs']
      : never,
    activeFile: string | null,
    contents: Record<string, string> = {},
    missing: string[] = [],
  ): SessionRestoreEnvelope {
    return {
      session: { version: 1, tabs, activeFile, workspaceRoot: null },
      missing,
      contents,
    };
  }

  it('replays a real-file tab from pre-loaded contents', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.restoreSession(
      envelope(
        [{ path: '/abs/foo.md', name: 'foo.md', viewState: null }],
        '/abs/foo.md',
        { '/abs/foo.md': '# Foo\n' },
      ),
    );

    expect(fm.tabs.has('/abs/foo.md')).toBe(true);
    expect(fm.models.get('/abs/foo.md')?.getValue()).toBe('# Foo\n');
    expect(fm.activeFile).toBe('/abs/foo.md');
  });

  it('replays an untitled tab from inline content', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.restoreSession(
      envelope(
        [
          {
            path: 'untitled-3',
            name: 'Untitled 3',
            viewState: null,
            untitledContent: 'draft body',
          },
        ],
        'untitled-3',
      ),
    );

    expect(fm.tabs.has('untitled-3')).toBe(true);
    expect(fm.models.get('untitled-3')?.getValue()).toBe('draft body');
  });

  it('advances untitledCounter past the highest restored synthetic id', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    expect(fm.untitledCounter).toBe(1);
    fm.restoreSession(
      envelope(
        [
          {
            path: 'untitled-5',
            name: 'Untitled 5',
            viewState: null,
            untitledContent: 'a',
          },
          {
            path: 'untitled-2',
            name: 'Untitled 2',
            viewState: null,
            untitledContent: 'b',
          },
        ],
        'untitled-5',
      ),
    );

    expect(fm.untitledCounter).toBe(6);
  });

  it('is idempotent — a second call is a no-op', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.restoreSession(
      envelope(
        [{ path: '/abs/a.md', name: 'a.md', viewState: null }],
        '/abs/a.md',
        { '/abs/a.md': 'first' },
      ),
    );
    const tabsAfterFirst = Array.from(fm.tabs.keys());

    fm.restoreSession(
      envelope(
        [{ path: '/abs/b.md', name: 'b.md', viewState: null }],
        '/abs/b.md',
        { '/abs/b.md': 'second' },
      ),
    );

    expect(Array.from(fm.tabs.keys())).toEqual(tabsAfterFirst);
  });

  it('does no replay when the envelope has no session', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.restoreSession({ session: null, missing: [], contents: {} });
    expect(fm.tabs.size).toBe(0);
    expect(fm.activeFile).toBeNull();
  });

  it('falls back to the first tab when the persisted active is gone', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    // activeFile points at something that's not in tabs (e.g. the
    // persisted active was the file that ended up in `missing`).
    fm.restoreSession(
      envelope(
        [{ path: '/abs/keep.md', name: 'keep.md', viewState: null }],
        '/abs/gone.md',
        { '/abs/keep.md': 'kept' },
      ),
    );

    expect(fm.activeFile).toBe('/abs/keep.md');
  });

  it('suppresses the debounced session-save trigger during replay', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge, sent } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.restoreSession(
      envelope(
        [{ path: '/abs/a.md', name: 'a.md', viewState: null }],
        '/abs/a.md',
        { '/abs/a.md': 'x' },
      ),
    );

    // Even after the debounce window, no save should have echoed back.
    jest.advanceTimersByTime(1000);
    const sessionSaves = sent.filter((s) => s.channel === 'to:session:save');
    expect(sessionSaves).toHaveLength(0);
  });
});

describe('FileManager.scheduleSessionSave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires a to:session:save after the debounce window on tab events', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge, sent } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('hello');

    // Within the debounce window — nothing yet.
    jest.advanceTimersByTime(100);
    expect(sent.filter((s) => s.channel === 'to:session:save')).toHaveLength(0);

    // Past the window — one save.
    jest.advanceTimersByTime(400);
    const saves = sent.filter((s) => s.channel === 'to:session:save');
    expect(saves.length).toBeGreaterThan(0);
    const lastPayload = saves[saves.length - 1].data as {
      tabs: { path: string }[];
    };
    expect(lastPayload.tabs.map((t) => t.path)).toEqual(['untitled-1']);
  });
});

describe('FileManager.activateFile re-activation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not restoreViewState when activating the already-active tab', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const mk = makeMkeditor();
    const fm = new FileManager(
      bridge as never,
      mk as never,
      new EditorDispatcher(),
    );

    // Inject a stale view state directly so the bug's preconditions
    // hold without needing to drive a real switch-away.
    fm.seedUntitled('hello');
    (fm as unknown as { viewStates: Map<string, unknown> }).viewStates.set(
      'untitled-1',
      { marker: 'stale' },
    );

    // Snapshot the call count after seedUntitled (which itself runs
    // through activateFile).
    const callsBefore = mk.restoreViewState.mock.calls.length;

    // Re-activate the already-active tab.
    fm.activateFile('untitled-1');

    expect(mk.restoreViewState.mock.calls.length).toBe(callsBefore);
  });

  it('still refreshes title + emits change on re-activation (rename use case)', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge, sent } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('hello');
    const titlesBefore = sent.filter(
      (s) => s.channel === 'to:title:set',
    ).length;

    // Re-activate with a different display name.
    fm.activateFile('untitled-1', 'Renamed');

    const titlesAfter = sent.filter((s) => s.channel === 'to:title:set');
    expect(titlesAfter.length).toBe(titlesBefore + 1);
    expect(titlesAfter[titlesAfter.length - 1].data).toBe('Renamed');
  });

  it('renameTab on the active tab does not roll the cursor back', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const mk = makeMkeditor();
    const fm = new FileManager(
      bridge as never,
      mk as never,
      new EditorDispatcher(),
    );

    // Pre-seed a saved viewState for /abs/old.md (as if the user had
    // switched away from it once). The renameTab path will migrate
    // this entry to /abs/new.md and call activateFile(/abs/new.md).
    // We must not see a restoreViewState call against that stale state.
    fm.seedUntitled('placeholder'); // gives us untitled-1; not the target
    // Manually wire up a tab + viewState for /abs/old.md so we can
    // rename it without going through the bridge.
    const editorMock = jest.requireMock('monaco-editor') as {
      editor: { createModel: jest.Mock };
    };
    const model = editorMock.editor.createModel('body', 'markdown');
    (fm as unknown as { models: Map<string, unknown> }).models.set(
      '/abs/old.md',
      model,
    );
    (fm as unknown as { originals: Map<string, string> }).originals.set(
      '/abs/old.md',
      'body',
    );
    (fm as unknown as { viewStates: Map<string, unknown> }).viewStates.set(
      '/abs/old.md',
      { marker: 'stale-from-prior-switch-away' },
    );
    fm.addTab('old.md', '/abs/old.md');
    fm.activateFile('/abs/old.md'); // switching from untitled-1 — viewState restored here is fine

    const restoreCallsBefore = mk.restoreViewState.mock.calls.length;

    // Rename the active tab. renameTab mutates activeFile then calls
    // activateFile(newPath) — without the fix this would re-apply the
    // migrated stale viewState.
    fm.renameTab('/abs/old.md', '/abs/new.md', 'new.md');

    expect(mk.restoreViewState.mock.calls.length).toBe(restoreCallsBefore);
  });
});

describe('FileManager serialize ↔ restore round-trip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('round-trips an untitled tab with content and view state', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const mk = makeMkeditor();
    const fm = new FileManager(
      bridge as never,
      mk as never,
      new EditorDispatcher(),
    );

    fm.seedUntitled('the body');
    mk.__setNextViewState({ marker: 'cursor-at-line-3' });
    const payload = fm.serializeSession();

    // Spin up a fresh FileManager and restore.
    const fm2 = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm2.restoreSession({
      session: payload,
      missing: [],
      contents: {},
    });

    expect(fm2.activeFile).toBe('untitled-1');
    expect(fm2.models.get('untitled-1')?.getValue()).toBe('the body');
    expect(fm2.untitledCounter).toBe(2);
  });
});
