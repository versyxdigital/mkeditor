/**
 * WebFileBridge session-persistence tests.
 *
 * Covers `persistSession`, `shipSessionRestore`, the legacy
 * `mkeditor-content` migration, and the `beforeunload` flush
 * listener. IndexedDB is stubbed (jsdom's built-in shim is enough for
 * `loadRootHandle` to return null cleanly); file handles are minimal
 * stubs that expose just enough to satisfy `getFile().text()`.
 */

import type {
  SessionPayload,
  SessionRestoreEnvelope,
} from '../src/browser/interfaces/Session';

jest.mock('../src/browser/core/HTMLExporter', () => ({
  HTMLExporter: { webExport: jest.fn(), pdfWebExport: jest.fn() },
}));

// jsdom lacks IndexedDB by default. Provide a minimal stub so
// `loadRootHandle` can run and return null without throwing — the
// session tests don't need a live workspace.
function installIndexedDbStub() {
  const fakeDb = {
    transaction: () => ({
      objectStore: () => ({
        get: () => {
          const req: { onsuccess?: () => void; result: unknown } = {
            result: undefined,
          };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
        put: () => {
          const req: { onsuccess?: () => void } = {};
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
        delete: () => {
          const req: { onsuccess?: () => void } = {};
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      }),
      oncomplete: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
    }),
    close: () => {},
  };

  (window as unknown as { indexedDB: { open: () => unknown } }).indexedDB = {
    open: () => {
      const req: {
        onsuccess?: () => void;
        onupgradeneeded?: () => void;
        onerror?: () => void;
        result: typeof fakeDb;
      } = { result: fakeDb };
      // Fire onsuccess on the next tick so callers can await it.
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
}

function makeFileHandle(content: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name: 'stub',
    getFile: jest.fn(
      async () =>
        ({
          text: async () => content,
        }) as unknown as File,
    ),
  } as unknown as FileSystemFileHandle;
}

async function loadBridge() {
  jest.resetModules();
  const { WebFileBridge } = await import('../src/browser/core/WebFileBridge');
  return new WebFileBridge();
}

describe('WebFileBridge.persistSession (to:session:save)', () => {
  beforeEach(() => {
    localStorage.clear();
    installIndexedDbStub();
  });

  it('writes the payload to mkeditor-session', async () => {
    const bridge = await loadBridge();
    const payload: SessionPayload = {
      version: 1,
      tabs: [
        {
          path: 'untitled-1',
          name: 'Untitled 1',
          viewState: null,
          untitledContent: 'hello',
        },
      ],
      activeFile: 'untitled-1',
      workspaceRoot: null,
    };
    bridge.send('to:session:save', payload);

    const stored = JSON.parse(
      localStorage.getItem('mkeditor-session') ?? 'null',
    );
    expect(stored).toEqual(payload);
  });
});

describe('WebFileBridge.shipSessionRestore', () => {
  beforeEach(() => {
    localStorage.clear();
    installIndexedDbStub();
  });

  it('emits a null envelope when nothing is persisted', async () => {
    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );

    await bridge.bootstrap();
    expect(received).toHaveLength(1);
    expect(received[0].session).toBeNull();
    expect(received[0].missing).toEqual([]);
    expect(received[0].contents).toEqual({});
  });

  it('passes untitled tabs through unchanged with their inline content', async () => {
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 1,
        tabs: [
          {
            path: 'untitled-2',
            name: 'Untitled 2',
            viewState: null,
            untitledContent: 'scratch',
          },
        ],
        activeFile: 'untitled-2',
        workspaceRoot: null,
      }),
    );

    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );

    await bridge.bootstrap();

    expect(received).toHaveLength(1);
    expect(received[0].session?.tabs).toHaveLength(1);
    expect(received[0].session?.tabs[0].path).toBe('untitled-2');
    expect(received[0].session?.tabs[0].untitledContent).toBe('scratch');
    expect(received[0].session?.activeFile).toBe('untitled-2');
  });

  it('reads contents for real-file tabs whose handles are present', async () => {
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 1,
        tabs: [{ path: 'my-notes/foo.md', name: 'foo.md', viewState: null }],
        activeFile: 'my-notes/foo.md',
        workspaceRoot: 'my-notes',
      }),
    );

    const bridge = await loadBridge();
    // Inject a handle so the real-file path passes the existence check.
    const handles = (bridge as unknown as { handles: Map<string, unknown> })
      .handles;
    handles.set('my-notes/foo.md', makeFileHandle('# Foo body'));

    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );

    await bridge.bootstrap();

    expect(received[0].session?.tabs.map((t) => t.path)).toEqual([
      'my-notes/foo.md',
    ]);
    expect(received[0].contents['my-notes/foo.md']).toBe('# Foo body');
    expect(received[0].missing).toEqual([]);
  });

  it('moves real-file tabs without a matching handle into `missing`', async () => {
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 1,
        tabs: [
          { path: 'gone/file.md', name: 'file.md', viewState: null },
          {
            path: 'untitled-1',
            name: 'Untitled 1',
            viewState: null,
            untitledContent: 'kept',
          },
        ],
        activeFile: 'gone/file.md',
        workspaceRoot: null,
      }),
    );

    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );

    await bridge.bootstrap();

    expect(received[0].missing).toEqual(['gone/file.md']);
    expect(received[0].session?.tabs.map((t) => t.path)).toEqual([
      'untitled-1',
    ]);
    // active was the missing file → null out.
    expect(received[0].session?.activeFile).toBeNull();
  });

  it('drops a malformed session JSON instead of throwing', async () => {
    localStorage.setItem('mkeditor-session', '{ not valid');
    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );
    await expect(bridge.bootstrap()).resolves.toBeUndefined();
    expect(received[0].session).toBeNull();
  });
});

describe('WebFileBridge legacy mkeditor-content migration', () => {
  beforeEach(() => {
    localStorage.clear();
    installIndexedDbStub();
  });

  it('migrates non-empty legacy content into a first untitled tab', async () => {
    localStorage.setItem('mkeditor-content', 'legacy buffer');
    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );

    await bridge.bootstrap();

    expect(received[0].session?.tabs).toHaveLength(1);
    expect(received[0].session?.tabs[0].path).toBe('untitled-1');
    expect(received[0].session?.tabs[0].untitledContent).toBe('legacy buffer');
    // Legacy key is removed.
    expect(localStorage.getItem('mkeditor-content')).toBeNull();
  });

  it('removes an empty legacy key without inventing a tab', async () => {
    localStorage.setItem('mkeditor-content', '');
    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );
    await bridge.bootstrap();

    expect(received[0].session).toBeNull();
    expect(localStorage.getItem('mkeditor-content')).toBeNull();
  });

  it('does not clobber a session that already has untitled content', async () => {
    localStorage.setItem('mkeditor-content', 'legacy buffer');
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 1,
        tabs: [
          {
            path: 'untitled-1',
            name: 'Untitled 1',
            viewState: null,
            untitledContent: 'newer body',
          },
        ],
        activeFile: 'untitled-1',
        workspaceRoot: null,
      }),
    );

    const bridge = await loadBridge();
    const received: SessionRestoreEnvelope[] = [];
    bridge.receive('from:session:restore', (e: unknown) =>
      received.push(e as SessionRestoreEnvelope),
    );
    await bridge.bootstrap();

    expect(received[0].session?.tabs[0].untitledContent).toBe('newer body');
    // Legacy still removed (it's old, won't be touched again).
    expect(localStorage.getItem('mkeditor-content')).toBeNull();
  });
});

describe('WebFileBridge beforeunload flush', () => {
  beforeEach(() => {
    localStorage.clear();
    installIndexedDbStub();
  });

  it('emits from:session:flush-request when the page unloads', async () => {
    const bridge = await loadBridge();
    let flushCount = 0;
    bridge.receive('from:session:flush-request', () => {
      flushCount += 1;
    });
    await bridge.bootstrap();

    window.dispatchEvent(new Event('beforeunload'));
    expect(flushCount).toBe(1);
  });
});

describe('WebFileBridge to:session:clear', () => {
  beforeEach(() => {
    localStorage.clear();
    installIndexedDbStub();
  });

  it('removes mkeditor-session and fires the success notification', async () => {
    localStorage.setItem('mkeditor-session', JSON.stringify({ x: 1 }));
    const bridge = await loadBridge();
    const notifications: Array<{ status: string; key: string }> = [];
    bridge.receive('from:notification:display', (e: unknown) =>
      notifications.push(e as { status: string; key: string }),
    );

    bridge.send('to:session:clear', null);

    expect(localStorage.getItem('mkeditor-session')).toBeNull();
    expect(notifications).toEqual([
      { status: 'success', key: 'notifications:session_cleared' },
    ]);
  });

  it('still fires the notification when nothing was stored', async () => {
    const bridge = await loadBridge();
    const notifications: Array<{ status: string; key: string }> = [];
    bridge.receive('from:notification:display', (e: unknown) =>
      notifications.push(e as { status: string; key: string }),
    );

    bridge.send('to:session:clear', null);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].key).toBe('notifications:session_cleared');
  });
});
