/**
 * `FileManager.openDiffTab` + `closeTab` (diff branch) +
 * `serializeSession` (diff-filter) tests.
 *
 * The diff tab is a read-only preview surface populated by the
 * "pop out" button on the inline tool confirmation card. It rides
 * the regular tab strip but has no editable model and isn't
 * persisted to the session file.
 */

import type { SessionRestoreEnvelope } from '../src/browser/interfaces/Session';

jest.mock('../src/browser/assets/intro', () => ({ welcomeMarkdown: '' }));

jest.mock('../src/browser/react/contexts/PromptsContext', () => ({
  openPromptExternal: jest.fn(() => Promise.resolve({ button: 'deny' })),
}));

jest.mock('monaco-editor', () => {
  const createModel = jest.fn((content: string) => {
    let value = content;
    const contentListeners = new Set<() => void>();
    return {
      getValue: jest.fn(() => value),
      setValue: jest.fn((next: string) => {
        value = next;
        contentListeners.forEach((l) => l());
      }),
      getAlternativeVersionId: jest.fn(() => 1),
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

describe('FileManager.openDiffTab', () => {
  it('appends a TabInfo with kind="diff" and stores the payload', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );

    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ README.md',
      original: 'old body',
      modified: 'new body',
      sourcePath: '/abs/README.md',
    });

    const tab = fm.tabs.get('diff://tc-1');
    expect(tab).toBeDefined();
    expect(tab?.kind).toBe('diff');
    expect(tab?.name).toBe('Δ README.md');
    expect(tab?.dirty).toBe(false);

    const payload = fm.getDiffTab('diff://tc-1');
    expect(payload).toEqual({
      original: 'old body',
      modified: 'new body',
      language: 'markdown',
      sourcePath: '/abs/README.md',
    });
  });

  it('sets the new diff tab as active and emits a snapshot change', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    const listener = jest.fn();
    fm.on('change', listener);

    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ README.md',
      original: 'a',
      modified: 'b',
    });

    expect(fm.activeFile).toBe('diff://tc-1');
    expect(listener).toHaveBeenCalled();
    const snap = fm.getSnapshot();
    expect(snap.activeFile).toBe('diff://tc-1');
    expect(snap.tabs.find((t) => t.path === 'diff://tc-1')?.kind).toBe('diff');
  });

  it('re-opening the same diff tab id replaces the payload and re-activates (no duplicate tab)', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ README.md',
      original: 'first',
      modified: 'second',
    });
    // User clicks pop-out a second time on the same tool (e.g. after
    // editing the agent's proposal upstream).
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ README.md',
      original: 'first-v2',
      modified: 'second-v2',
    });

    const diffTabs = Array.from(fm.tabs.values()).filter(
      (t) => t.kind === 'diff',
    );
    expect(diffTabs).toHaveLength(1);
    expect(fm.getDiffTab('diff://tc-1')?.original).toBe('first-v2');
    expect(fm.getDiffTab('diff://tc-1')?.modified).toBe('second-v2');
  });
});

describe('FileManager.closeTab (diff-tab branch)', () => {
  it('drops the diff tab + payload without surfacing the unsaved-changes prompt', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ x',
      original: 'a',
      modified: 'b',
    });
    expect(fm.tabs.has('diff://tc-1')).toBe(true);

    await fm.closeTab('diff://tc-1');

    expect(fm.tabs.has('diff://tc-1')).toBe(false);
    expect(fm.getDiffTab('diff://tc-1')).toBeUndefined();
    // No `to:file:save` IPC fired — diff tabs never trigger the save
    // path even if their "modified" content differs from "original".
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      openPromptExternal,
    } = require('../src/browser/react/contexts/PromptsContext');
    expect(openPromptExternal).not.toHaveBeenCalled();
  });

  it('seeds a fresh untitled when the diff tab was the only tab in the strip', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.openDiffTab({
      id: 'diff://only',
      name: 'Δ x',
      original: 'a',
      modified: 'b',
    });
    expect(fm.tabs.size).toBe(1);

    await fm.closeTab('diff://only');

    // One tab remains — the auto-seeded untitled.
    expect(fm.tabs.size).toBe(1);
    const remaining = Array.from(fm.tabs.keys())[0];
    expect(remaining.startsWith('untitled-')).toBe(true);
    expect(fm.activeFile).toBe(remaining);
  });
});

describe('FileManager.serializeSession (diff-tab filter)', () => {
  it('omits diff tabs from the persisted session payload', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.seedUntitled('scratch');
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ y',
      original: 'a',
      modified: 'b',
    });

    const payload = fm.serializeSession();
    expect(payload.tabs.find((t) => t.path === 'diff://tc-1')).toBeUndefined();
    // The untitled tab IS persisted (kind defaults to 'file').
    expect(payload.tabs.some((t) => t.path.startsWith('untitled-'))).toBe(true);
  });

  it('drops the diff tab from `activeFile` when it was the active tab at persist time', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.seedUntitled('s');
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ y',
      original: 'a',
      modified: 'b',
    });
    expect(fm.activeFile).toBe('diff://tc-1');

    const payload = fm.serializeSession();
    // activeFile fell back to the first surviving tab (the untitled).
    expect(payload.activeFile).not.toBe('diff://tc-1');
    expect(payload.activeFile?.startsWith('untitled-')).toBe(true);
  });

  it('survives a round-trip — restoreSession ignores the missing diff tab', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.seedUntitled('s');
    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ y',
      original: 'a',
      modified: 'b',
    });
    const payload = fm.serializeSession();

    const fm2 = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    const envelope: SessionRestoreEnvelope = {
      session: payload,
      contents: {},
      missing: [],
    };
    fm2.restoreSession(envelope);

    expect(fm2.tabs.has('diff://tc-1')).toBe(false);
    expect(
      Array.from(fm2.tabs.keys()).some((p) => p.startsWith('untitled-')),
    ).toBe(true);
  });
});

describe('FileManager.getActiveEditablePath', () => {
  // `activeFile` is polymorphic — for `kind: 'diff'` tabs it holds a
  // synthetic id (`diff://...`) rather than a filesystem path. The
  // selection-write tools, MkedLinkProvider, and the menu File-New
  // unsaved-prompt all need the path Monaco is actually backing
  // (which is the file UNDER the overlay, not the overlay itself).
  // These tests pin down the resolution rules so a future refactor
  // doesn't accidentally let a `diff://...` id leak back out.

  it('returns null for an untitled-only session', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    fm.seedUntitled('');
    expect(fm.activeFile?.startsWith('untitled-')).toBe(true);
    expect(fm.getActiveEditablePath()).toBeNull();
  });

  it('returns the active path when a normal file tab is focused', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    // Simulate a real-file tab landing in FileManager the way
    // BridgeListeners does for `from:file:opened`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { editor } = require('monaco-editor');
    const mdl = editor.createModel('hello');
    fm.models.set('/abs/README.md', mdl);
    fm.originals.set('/abs/README.md', 'hello');
    fm.trackTab('/abs/README.md', mdl);
    fm.addTab('README.md', '/abs/README.md');
    fm.activateFile('/abs/README.md', 'README.md');

    expect(fm.getActiveEditablePath()).toBe('/abs/README.md');
  });

  it('falls back to the last-active file tab when a diff overlay is focused', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { editor } = require('monaco-editor');
    const mdl = editor.createModel('hello');
    fm.models.set('/abs/README.md', mdl);
    fm.originals.set('/abs/README.md', 'hello');
    fm.trackTab('/abs/README.md', mdl);
    fm.addTab('README.md', '/abs/README.md');
    fm.activateFile('/abs/README.md', 'README.md');

    fm.openDiffTab({
      id: 'diff://tc-1',
      name: 'Δ README.md',
      original: 'old',
      modified: 'new',
      sourcePath: '/abs/README.md',
    });

    // `activeFile` is now the diff overlay id — but the editable
    // accessor still surfaces the file Monaco is actually backing.
    expect(fm.activeFile).toBe('diff://tc-1');
    expect(fm.getActiveEditablePath()).toBe('/abs/README.md');
  });

  it('returns null after the last-active file tab is closed (no editable file remains)', async () => {
    const { FileManager, EditorDispatcher } = await loadFileManager();
    const { bridge } = makeBridge();
    const fm = new FileManager(
      bridge as never,
      makeMkeditor() as never,
      new EditorDispatcher(),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { editor } = require('monaco-editor');
    const mdl = editor.createModel('hello');
    fm.models.set('/abs/README.md', mdl);
    fm.originals.set('/abs/README.md', 'hello');
    fm.trackTab('/abs/README.md', mdl);
    fm.addTab('README.md', '/abs/README.md');
    fm.activateFile('/abs/README.md', 'README.md');

    await fm.closeTab('/abs/README.md');

    // closeTab's "no tabs left" branch seeds a fresh untitled; the
    // editable accessor should now report null (only an untitled).
    expect(fm.getActiveEditablePath()).toBeNull();
  });
});
