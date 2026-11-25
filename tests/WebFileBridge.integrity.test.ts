import { WebFileBridge } from '../src/browser/core/WebFileBridge';
import type { SessionRestoreEnvelope } from '../src/browser/interfaces/Session';

jest.mock('../src/browser/core/HTMLExporter', () => ({
  HTMLExporter: { webExport: jest.fn(), pdfWebExport: jest.fn() },
}));
jest.mock('../src/browser/util', () => ({
  logger: { error: jest.fn(), warn: jest.fn() },
}));

class FakeFile {
  readonly kind = 'file';
  data: string | ArrayBuffer = '';
  constructor(readonly name: string) {}
  readonly write = jest.fn(async (data: string | ArrayBuffer) => {
    this.data = data;
  });
  readonly close = jest.fn(async () => {});
  readonly abort = jest.fn(async () => {});
  readonly createWritable = jest.fn(async () => ({
    write: this.write,
    close: this.close,
    abort: this.abort,
  }));
  readonly getFile = jest.fn(async () => ({
    text: async () => this.data,

    arrayBuffer: async () =>
      typeof this.data === 'string'
        ? new TextEncoder().encode(this.data).buffer
        : this.data,
  }));
  readonly isSameEntry = jest.fn(async (other: unknown) => other === this);
}

class FakeDirectory {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeFile | FakeDirectory>();
  constructor(readonly name: string) {}
  readonly getFileHandle = jest.fn(
    async (name: string, options: { create?: boolean } = {}) => {
      const child = this.children.get(name);
      if (child?.kind === 'directory')
        throw new DOMException('directory', 'TypeMismatchError');
      if (child) return child;
      if (!options.create) throw new DOMException('missing', 'NotFoundError');
      const file = new FakeFile(name);
      this.children.set(name, file);
      return file;
    },
  );
  readonly getDirectoryHandle = jest.fn(
    async (
      name: string,
      options: { create?: boolean } = {},
    ): Promise<FakeDirectory> => {
      const child = this.children.get(name);
      if (child?.kind === 'file')
        throw new DOMException('file', 'TypeMismatchError');
      if (child) return child;
      if (!options.create) throw new DOMException('missing', 'NotFoundError');
      const dir = new FakeDirectory(name);
      this.children.set(name, dir);
      return dir;
    },
  );
  async *entries() {
    yield* this.children.entries();
  }
  readonly removeEntry = jest.fn(async (name: string) => {
    this.children.delete(name);
  });
  async resolve(target: FakeFile | FakeDirectory): Promise<string[] | null> {
    for (const [name, child] of this.children) {
      if (child === target) return [name];
      if (child.kind === 'directory') {
        const nested = await child.resolve(target);
        if (nested) return [name, ...nested];
      }
    }
    return null;
  }
}

type Internals = {
  rootHandle: FakeDirectory | null;
  rootName: string;
  handles: Map<string, FakeFile | FakeDirectory>;
  shipSessionRestore(): Promise<void>;
  lookupHandle(path: string): Promise<unknown>;
};

function setup(root = new FakeDirectory('notes')) {
  const bridge = new WebFileBridge();
  const internals = bridge as unknown as Internals;
  internals.rootHandle = root;
  internals.rootName = root.name;
  internals.handles.set(root.name, root);
  return { bridge, root, internals };
}

function capture(bridge: WebFileBridge, channel: string) {
  const listener = jest.fn();
  bridge.receive(channel, listener);
  return listener;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('web correlated saves', () => {
  it('acknowledges the captured file only after its writable stream closes', async () => {
    const { bridge, root, internals } = setup();
    const file = await root.getFileHandle('a.md', { create: true });
    internals.handles.set('notes/a.md', file);
    let release!: () => void;
    file.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const saved = capture(bridge, 'from:file:save-result');
    const opened = capture(bridge, 'from:file:opened');
    bridge.send('to:file:save', {
      file: 'notes/a.md',
      content: 'new',
      requestId: 'save-1',
      openFile: false,
    });
    await flush();
    expect(saved).not.toHaveBeenCalled();
    release();
    await flush();
    expect(saved).toHaveBeenCalledWith({
      requestId: 'save-1',
      ok: true,
      path: 'notes/a.md',
    });
    expect(file.data).toBe('new');
    expect(opened).not.toHaveBeenCalled();
  });

  it('reports and aborts a failed write instead of marking a buffer clean', async () => {
    const { bridge, root, internals } = setup();
    const file = await root.getFileHandle('a.md', { create: true });
    internals.handles.set('notes/a.md', file);
    file.write.mockRejectedValueOnce(new Error('quota'));
    const saved = capture(bridge, 'from:file:save-result');
    bridge.send('to:file:save', {
      file: 'notes/a.md',
      content: 'new',
      requestId: 'failed',
    });
    await flush();
    expect(saved).toHaveBeenCalledWith({
      requestId: 'failed',
      ok: false,
      error: 'quota',
    });
    expect(file.abort).toHaveBeenCalledTimes(1);
    expect(file.close).not.toHaveBeenCalled();
  });

  it('returns a failure acknowledgement for a missing handle', async () => {
    const { bridge } = setup();
    const saved = capture(bridge, 'from:file:save-result');
    bridge.send('to:file:save', {
      file: 'notes/missing.md',
      content: 'new',
      requestId: 'missing',
    });
    await flush();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'missing', ok: false }),
    );
  });

  it('acknowledges Save As cancellation quietly', async () => {
    const { bridge } = setup();
    window.showSaveFilePicker = jest
      .fn()
      .mockRejectedValue(new DOMException('cancel', 'AbortError'));
    const saved = capture(bridge, 'from:file:save-result');
    const notices = capture(bridge, 'from:notification:display');
    bridge.send('to:file:saveas', {
      content: 'scratch',
      requestId: 'cancelled',
    });
    await flush();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'cancelled',
        ok: false,
        cancelled: true,
      }),
    );
    expect(notices).not.toHaveBeenCalled();
  });

  it('returns the nested workspace path of a newly saved unexpanded file', async () => {
    const { bridge, root } = setup();
    const nested = await root.getDirectoryHandle('sub', { create: true });
    const target = await nested.getFileHandle('new.md', { create: true });
    window.showSaveFilePicker = jest.fn().mockResolvedValue(target);
    const saved = capture(bridge, 'from:file:save-result');
    const opened = capture(bridge, 'from:file:opened');
    bridge.send('to:file:saveas', { content: 'scratch', requestId: 'as' });
    await flush();
    expect(saved).toHaveBeenCalledWith({
      requestId: 'as',
      ok: true,
      path: 'notes/sub/new.md',
    });
    expect(opened).not.toHaveBeenCalled();
  });

  it('keeps external files with the same basename distinct', async () => {
    const { bridge, internals } = setup();
    const first = new FakeFile('same.md');
    const second = new FakeFile('same.md');
    window.showSaveFilePicker = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    bridge.send('to:file:saveas', { content: 'first', requestId: 'one' });
    await flush();
    bridge.send('to:file:saveas', { content: 'second', requestId: 'two' });
    await flush();
    expect(internals.handles.get('external/same.md')).toBe(first);
    expect(internals.handles.get('external/2/same.md')).toBe(second);
  });

  it('supports legacy Save As string payloads', async () => {
    const { bridge } = setup();
    const file = new FakeFile('legacy.md');
    window.showSaveFilePicker = jest.fn().mockResolvedValue(file);
    const opened = capture(bridge, 'from:file:opened');
    bridge.send('to:file:saveas', 'legacy text');
    await flush();
    expect(file.data).toBe('legacy text');
    expect(opened).toHaveBeenCalledWith({
      content: 'legacy text',
      file: 'external/legacy.md',
    });
  });

  it('refuses an already-open Save As target before truncating its file', async () => {
    const { bridge, root, internals } = setup();
    const target = await root.getFileHandle('other.md', { create: true });
    target.data = 'unsaved destination on disk';
    internals.handles.set('notes/other.md', target);
    window.showSaveFilePicker = jest.fn().mockResolvedValue(target);
    const saved = capture(bridge, 'from:file:save-result');
    bridge.send('to:file:saveas', {
      content: 'source',
      requestId: 'collision',
      excludedPaths: ['notes/other.md'],
    });
    await flush();
    expect(target.createWritable).not.toHaveBeenCalled();
    expect(target.data).toBe('unsaved destination on disk');
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'collision', ok: false }),
    );
  });

  it('does not write or rekey into a different workspace after a delayed Save As picker', async () => {
    const { bridge, internals } = setup();
    const target = new FakeFile('pending.md');
    let finish!: (file: FakeFile) => void;
    window.showSaveFilePicker = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ) as never;
    const saved = capture(bridge, 'from:file:save-result');
    bridge.send('to:file:saveas', { content: 'old source', requestId: 'late' });
    const replacement = new FakeDirectory('notes');
    internals.rootHandle = replacement;
    internals.handles = new Map([['notes', replacement]]);
    finish(target);
    await flush();
    expect(target.createWritable).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'late', ok: false }),
    );
    expect([...internals.handles.keys()]).toEqual(['notes']);
  });
});

describe('web file menu actions', () => {
  it('opens a selected file and keeps its handle for subsequent saves', async () => {
    const { bridge, internals } = setup();
    const file = new FakeFile('picked.md');
    file.data = 'picked content';
    window.showOpenFilePicker = jest.fn().mockResolvedValue([file]);
    const opened = capture(bridge, 'from:file:opened');
    bridge.send('to:file:open', true);
    await flush();
    expect(opened).toHaveBeenCalledWith({
      content: 'picked content',
      file: 'external/picked.md',
    });
    expect(internals.handles.get('external/picked.md')).toBe(file);
  });

  it('keeps cancelled file selection quiet', async () => {
    const { bridge } = setup();
    window.showOpenFilePicker = jest
      .fn()
      .mockRejectedValue(new DOMException('cancel', 'AbortError'));
    const opened = capture(bridge, 'from:file:opened');
    const notices = capture(bridge, 'from:notification:display');
    bridge.send('to:file:open', true);
    await flush();
    expect(opened).not.toHaveBeenCalled();
    expect(notices).not.toHaveBeenCalled();
  });

  it('creates a new untitled tab through the shared listener contract', () => {
    const { bridge } = setup();
    const opened = capture(bridge, 'from:file:opened');
    bridge.send('to:file:new', { content: 'unsaved old buffer' });
    expect(opened).toHaveBeenCalledWith({ content: '', file: null });
  });
});

describe('web session durability', () => {
  it('restores version 2 sessions and ignores malformed tab entries', async () => {
    const { bridge, internals } = setup();
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 2,
        tabs: [
          null,
          {},
          {
            path: 'untitled-1',
            name: 'Scratch',
            viewState: null,
            untitledContent: 'keep',
          },
        ],
        activeFile: 'untitled-1',
      }),
    );
    const restored = capture(bridge, 'from:session:restore');
    await internals.shipSessionRestore();
    const envelope = restored.mock.calls[0][0] as SessionRestoreEnvelope;
    expect(envelope.session?.version).toBe(2);
    expect(envelope.session?.tabs).toHaveLength(1);
    expect(envelope.session?.tabs[0].untitledContent).toBe('keep');
  });

  it('restores nested file tabs without prior directory expansion', async () => {
    const { bridge, root, internals } = setup();
    const dir = await root.getDirectoryHandle('deep', { create: true });
    const file = await dir.getFileHandle('saved.md', { create: true });
    file.data = 'restored';
    localStorage.setItem(
      'mkeditor-session',
      JSON.stringify({
        version: 2,
        tabs: [
          { path: 'notes/deep/saved.md', name: 'saved.md', viewState: null },
        ],
        activeFile: 'notes/deep/saved.md',
      }),
    );
    const restored = capture(bridge, 'from:session:restore');
    await internals.shipSessionRestore();
    expect(restored.mock.calls[0][0].contents).toEqual({
      'notes/deep/saved.md': 'restored',
    });
    expect(restored.mock.calls[0][0].missing).toEqual([]);
  });

  it('persists a migrated scratch buffer before deleting the legacy copy', async () => {
    const { internals } = setup();
    localStorage.setItem('mkeditor-content', 'irreplaceable');
    await internals.shipSessionRestore();
    const session = JSON.parse(localStorage.getItem('mkeditor-session')!);
    expect(session.tabs[0].untitledContent).toBe('irreplaceable');
    expect(localStorage.getItem('mkeditor-content')).toBeNull();
  });

  it('retains the legacy copy when writing its replacement fails', async () => {
    const { internals } = setup();
    localStorage.setItem('mkeditor-content', 'irreplaceable');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await internals.shipSessionRestore();
    expect(localStorage.getItem('mkeditor-content')).toBe('irreplaceable');
  });
});

describe('workspace and mutation safety', () => {
  it('drops an old asynchronous lookup after a same-name workspace switch', async () => {
    const { root, internals } = setup();
    const oldDir = await root.getDirectoryHandle('old', { create: true });
    await oldDir.getFileHandle('note.md', { create: true });
    let finish!: (dir: FakeDirectory) => void;
    root.getDirectoryHandle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = internals.lookupHandle('notes/old/note.md');
    const replacement = new FakeDirectory('notes');
    internals.rootHandle = replacement;
    internals.handles = new Map([['notes', replacement]]);
    finish(oldDir);
    expect(await pending).toBeUndefined();
    expect([...internals.handles.keys()]).toEqual(['notes']);
  });

  it('leaves the old workspace usable until a new folder is accepted', async () => {
    const { bridge, root, internals } = setup(new FakeDirectory('same-name'));
    const next = new FakeDirectory('same-name');
    await next.getFileHandle('next.md', { create: true });
    window.showDirectoryPicker = jest.fn().mockResolvedValue(next);
    const opened = capture(bridge, 'from:folder:opened');
    bridge.send('to:folder:open', null);
    await flush();
    expect(opened).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'same-name', workspaceChange: true }),
    );
    expect(internals.rootHandle).toBe(root);
    expect(internals.handles.has('same-name/next.md')).toBe(false);
    bridge.send('to:workspace:set', { root: 'same-name' });
    expect(internals.rootHandle).toBe(next);
    expect(internals.handles.has('same-name/next.md')).toBe(true);
    await flush();
  });

  it('treats renaming to the current name as a no-op', async () => {
    const { bridge, root, internals } = setup();
    const file = await root.getFileHandle('keep.md', { create: true });
    file.data = 'original';
    internals.handles.set('notes/keep.md', file);
    bridge.send('to:file:rename', { path: 'notes/keep.md', name: 'keep.md' });
    await flush();
    expect(root.removeEntry).not.toHaveBeenCalled();
    expect(file.data).toBe('original');
  });

  it('refuses rename collisions without opening or deleting either file', async () => {
    const { bridge, root, internals } = setup();
    const source = await root.getFileHandle('source.md', { create: true });
    const target = await root.getFileHandle('target.md', { create: true });
    internals.handles.set('notes/source.md', source);
    bridge.send('to:file:rename', {
      path: 'notes/source.md',
      name: 'target.md',
    });
    await flush();
    expect(target.createWritable).not.toHaveBeenCalled();
    expect(root.removeEntry).not.toHaveBeenCalled();
  });

  it('refuses to create a file over an existing name', async () => {
    const { bridge, root } = setup();
    const file = await root.getFileHandle('keep.md', { create: true });
    root.getFileHandle.mockClear();
    const notifications = capture(bridge, 'from:notification:display');
    bridge.send('to:file:create', { parent: 'notes', name: 'keep.md' });
    await flush();
    expect(root.getFileHandle).not.toHaveBeenCalledWith('keep.md', {
      create: true,
    });
    expect(file.createWritable).not.toHaveBeenCalled();
    expect(notifications).toHaveBeenCalledWith({
      status: 'error',
      key: 'notifications:unable_create_file',
    });
  });

  it('does not treat denied collision checks as an unused destination', async () => {
    const { bridge, root, internals } = setup();
    const file = await root.getFileHandle('source.md', { create: true });
    internals.handles.set('notes/source.md', file);
    root.getFileHandle.mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    const result = await bridge.moveItem({
      srcPath: 'notes/source.md',
      dstPath: 'notes/target.md',
    });
    expect(result.ok).toBe(false);
    expect(root.removeEntry).not.toHaveBeenCalled();
  });

  it('publishes directory rename events and resolves new descendant handles for future saves', async () => {
    const { bridge, root, internals } = setup();
    const source = await root.getDirectoryHandle('old', { create: true });
    const file = await source.getFileHandle('note.md', { create: true });
    file.data = 'original';
    internals.handles.set('notes/old', source);
    internals.handles.set('notes/old/note.md', file);
    const renamed = capture(bridge, 'from:path:renamed');
    bridge.send('to:file:rename', { path: 'notes/old', name: 'new' });
    await flush();
    expect(renamed).toHaveBeenCalledWith({
      oldPath: 'notes/old',
      newPath: 'notes/new',
      name: 'new',
    });
    bridge.send('to:file:save', {
      file: 'notes/new/note.md',
      content: 'updated',
      requestId: 'moved',
    });
    await flush();
    const destination = root.children.get('new') as FakeDirectory;
    expect((destination.children.get('note.md') as FakeFile).data).toBe(
      'updated',
    );
    expect(file.data).toBe('original');
  });

  it('rejects ambiguous move paths before any mutation', async () => {
    const { bridge, root } = setup();
    const result = await bridge.moveItem({
      srcPath: 'notes/a.md',
      dstPath: 'notes/../outside/a.md',
    });
    expect(result.ok).toBe(false);
    expect(root.getDirectoryHandle).not.toHaveBeenCalled();
  });

  it('allocates distinct image names for simultaneous clipboard writes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-22T12:00:00Z'));
    const { bridge, root } = setup();
    const opts = {
      sourceFile: 'notes/note.md',
      directory: './assets',
      bytes: new Uint8Array([1, 2]),
      extension: 'png',
    };
    const [first, second] = await Promise.all([
      bridge.pasteImage(opts),
      bridge.pasteImage(opts),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.path).not.toBe(second.path);
    const images = root.children.get('assets') as FakeDirectory;
    expect(images.children.size).toBe(2);
  });
});
