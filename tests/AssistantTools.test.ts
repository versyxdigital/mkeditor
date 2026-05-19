/**
 * AssistantTools (AI Assistant P5) unit tests.
 *
 * The catalog reaches into FileManager / FileTreeManager / Editor /
 * BridgeManager. We build a tiny `fakeBridge` that satisfies just
 * those surfaces and assert each tool's outbound effect.
 *
 * Heavy file I/O paths (write_file / edit_file / create_file that
 * open a file via `to:file:openpath` and wait for it to land) are
 * exercised via a controllable FileManager mock that fires the
 * `change` event synchronously.
 */

import { AssistantTools } from '../src/browser/core/AssistantTools';

interface FakeBridge {
  send: jest.Mock;
  receive: jest.Mock;
}

interface FakePosition {
  lineNumber: number;
  column: number;
}

interface FakeModel {
  getValue: jest.Mock;
  getLineCount: jest.Mock;
  getLineMaxColumn: jest.Mock;
  setValue: jest.Mock;
  getEOL: jest.Mock<string, []>;
  /** Mirrors Monaco's getPositionAt: char offset → 1-based line+column. */
  getPositionAt: jest.Mock<FakePosition, [number]>;
}

function makeModel(content: string, eol: '\n' | '\r\n' = '\n'): FakeModel {
  const lines = content.split(/\r?\n/);
  return {
    getValue: jest.fn(() => content),
    getLineCount: jest.fn(() => lines.length),
    getLineMaxColumn: jest.fn(
      (lineNum: number) => (lines[lineNum - 1]?.length ?? 0) + 1,
    ),
    setValue: jest.fn(),
    getEOL: jest.fn(() => eol),
    getPositionAt: jest.fn((offset: number) => {
      // Walk the content counting EOL-aware lines until we reach `offset`.
      // The model EOL determines the length of each line break; characters
      // before the cursor on the current line determine the column.
      const eolLen = eol.length;
      let line = 1;
      let lineStart = 0;
      let i = 0;
      while (i < offset) {
        const isCRLF = eol === '\r\n' && content[i] === '\r' && content[i + 1] === '\n';
        const isLF = eol === '\n' && content[i] === '\n';
        if (isCRLF || isLF) {
          line += 1;
          i += eolLen;
          lineStart = i;
          continue;
        }
        i += 1;
      }
      return { lineNumber: line, column: offset - lineStart + 1 };
    }),
  };
}

function makeBridgeManager(opts: {
  activeFile?: string | null;
  models?: Map<string, FakeModel>;
  treeSnapshot?: {
    treeRoot: string | null;
    nodes: Array<{
      type: 'file' | 'directory';
      name: string;
      path: string;
      children?: Array<{ type: 'file' | 'directory'; name: string; path: string }>;
    }>;
  };
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
  selectionText?: string;
  cursorPosition?: { lineNumber: number; column: number } | null;
} = {}) {
  const sent: Array<{ channel: string; data: unknown }> = [];
  const bridge: FakeBridge = {
    send: jest.fn((channel: string, data: unknown) => {
      sent.push({ channel, data });
    }),
    receive: jest.fn(),
  };

  const models = opts.models ?? new Map<string, FakeModel>();
  const changeListeners = new Set<() => void>();

  const fileManager = {
    activeFile: opts.activeFile ?? null,
    models,
    on: jest.fn((event: string, listener: () => void) => {
      if (event !== 'change') throw new Error(`unsupported event ${event}`);
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    }),
    activateFile: jest.fn(),
    _emit: () => changeListeners.forEach((l) => l()),
    _setModel: (path: string, model: FakeModel) => {
      models.set(path, model);
      changeListeners.forEach((l) => l());
    },
  };

  // The fake tree starts as a mutable snapshot so a test can wire
  // lazy-load behaviour: when the tool calls `requestDirectoryContents`,
  // the test seeds children on the matching directory node and fires
  // the `change` event. Mirrors how the real FileTreeManager mutates
  // the directory in place under `buildFileTree`.
  let treeSnapshotRef = opts.treeSnapshot ?? {
    treeRoot: null as string | null,
    nodes: [] as Array<{
      type: 'file' | 'directory';
      name?: string;
      path: string;
      hasChildren?: boolean;
      loaded?: boolean;
      children?: unknown[];
    }>,
  };
  const treeListeners = new Set<() => void>();
  type LazyLoadHandler = (path: string) => void;
  let lazyLoadHandler: LazyLoadHandler | null = null;
  const fileTreeManager = {
    getSnapshot: jest.fn(() => treeSnapshotRef),
    treeRoot: opts.treeSnapshot?.treeRoot ?? null,
    on: jest.fn((event: string, listener: () => void) => {
      if (event !== 'change') throw new Error(`unsupported event ${event}`);
      treeListeners.add(listener);
      return () => treeListeners.delete(listener);
    }),
    requestDirectoryContents: jest.fn((path: string) => {
      lazyLoadHandler?.(path);
    }),
    /** Wire a synchronous handler that responds to lazy-load requests. */
    _setLazyLoadHandler: (handler: LazyLoadHandler) => {
      lazyLoadHandler = handler;
    },
    /** Replace the snapshot (must be the exact same reference style). */
    _setTreeSnapshot: (next: typeof treeSnapshotRef) => {
      treeSnapshotRef = next;
      treeListeners.forEach((l) => l());
    },
    /** Notify subscribers that the snapshot was mutated in place. */
    _emitTreeChange: () => treeListeners.forEach((l) => l()),
  };

  const mkeditor = {
    getSelection: jest.fn(() => opts.selection ?? null),
    getModel: jest.fn(() => {
      const path = opts.activeFile;
      if (!path) return null;
      const m = models.get(path);
      if (!m) return null;
      return {
        getValueInRange: jest.fn(() => opts.selectionText ?? ''),
      };
    }),
    getPosition: jest.fn(() => opts.cursorPosition ?? null),
    executeEdits: jest.fn(),
    getValue: jest.fn(() => {
      const path = opts.activeFile;
      if (!path) return '';
      return models.get(path)?.getValue() ?? '';
    }),
  };

  return {
    bridge,
    fileManager,
    fileTreeManager,
    mkeditor,
    sent,
  };
}

describe('AssistantTools — catalog metadata', () => {
  it('describe() returns 11 tool descriptors (the documented catalog)', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    const names = tools.describe().map((d) => d.name);
    expect(names.sort()).toEqual(
      [
        'create_file',
        'create_folder',
        'edit_file',
        'get_active_file',
        'get_selection',
        'insert_at_cursor',
        'list_files',
        'open_tab',
        'read_file',
        'replace_selection',
        'write_file',
      ].sort(),
    );
  });

  it('every descriptor carries a description string and a JSON-Schema parameters object', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    for (const d of tools.describe()) {
      expect(typeof d.description).toBe('string');
      expect(d.description.length).toBeGreaterThan(0);
      expect(typeof d.parameters).toBe('object');
      expect((d.parameters as { type: string }).type).toBe('object');
    }
  });

  it('classify() returns read vs write per the plan', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    expect(tools.classify('read_file')).toBe('read');
    expect(tools.classify('list_files')).toBe('read');
    expect(tools.classify('get_active_file')).toBe('read');
    expect(tools.classify('get_selection')).toBe('read');
    expect(tools.classify('open_tab')).toBe('read');
    expect(tools.classify('write_file')).toBe('write');
    expect(tools.classify('edit_file')).toBe('write');
    expect(tools.classify('create_file')).toBe('write');
    expect(tools.classify('replace_selection')).toBe('write');
    expect(tools.classify('insert_at_cursor')).toBe('write');
    expect(tools.classify('made_up_tool')).toBe('unknown');
  });

  it('hasTool() returns true for catalog entries, false for unknowns', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    expect(tools.hasTool('read_file')).toBe(true);
    expect(tools.hasTool('made_up_tool')).toBe(false);
  });
});

describe('AssistantTools — read-class execution', () => {
  it('read_file returns content + lineCount when the file is already open', async () => {
    const models = new Map<string, FakeModel>();
    models.set('/a/b.md', makeModel('hello\nworld'));
    const bm = makeBridgeManager({ models });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('read_file', { path: '/a/b.md' })) as {
      path: string;
      content: string;
      lineCount: number;
    };
    expect(result.path).toBe('/a/b.md');
    expect(result.content).toBe('hello\nworld');
    expect(result.lineCount).toBe(2);
  });

  // ---- mked.readFile shim helpers ----
  type MkedShim = {
    readFile: (path: string) => Promise<{ content: string; lineCount: number }>;
  };
  function setMked(shim: MkedShim | undefined): () => void {
    const w = window as Window & { mked?: MkedShim };
    const prev = w.mked;
    if (shim === undefined) {
      delete w.mked;
    } else {
      w.mked = shim;
    }
    return () => {
      if (prev === undefined) {
        delete w.mked;
      } else {
        w.mked = prev;
      }
    };
  }

  it('read_file reads via window.mked.readFile when the file is NOT open as a tab (no tab is opened)', async () => {
    // Behaviour change: previously this tool sent `to:file:openpath`
    // and waited for the file to land as a tab. That meant every
    // context-gathering read by the agent popped a new editor tab,
    // which was very noisy. Now reads route through the mked invoke
    // helper so the user sees no UI churn.
    const mkedReadFile = jest.fn(async () => ({
      content: 'disk body',
      lineCount: 3,
    }));
    const restore = setMked({ readFile: mkedReadFile });
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      const result = (await tools.execute('read_file', {
        path: '/missing.md',
      })) as { path: string; content: string; lineCount: number };
      expect(mkedReadFile).toHaveBeenCalledWith('/missing.md');
      expect(result).toEqual({
        path: '/missing.md',
        content: 'disk body',
        lineCount: 3,
      });
      // Critically: no to:file:openpath was fired — no tab gets opened.
      expect(bm.sent).not.toContainEqual(
        expect.objectContaining({ channel: 'to:file:openpath' }),
      );
    } finally {
      restore();
    }
  });

  it('read_file surfaces a useful error when mked.readFile fails (e.g. ENOENT)', async () => {
    const restore = setMked({
      readFile: jest.fn(async () => {
        throw new Error('ENOENT: no such file or directory');
      }),
    });
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      await expect(
        tools.execute('read_file', { path: '/nope.md' }),
      ).rejects.toThrow(/failed to read \/nope\.md.*ENOENT/);
    } finally {
      restore();
    }
  });

  it('read_file surfaces the directory-vs-file guard error so the agent has a clear recovery path (regression)', async () => {
    // Main now stat-checks before fs.readFile and throws a structured
    // message when handed a directory path. Previously the bare OS
    // `EISDIR: illegal operation on a directory` reached the agent
    // and gave it nothing actionable. The renderer wraps the inner
    // message but must keep it readable in the outer error string.
    const restore = setMked({
      readFile: jest.fn(async () => {
        throw new Error(
          '/workspace/poems is a directory, not a file. Use list_files to enumerate its contents; use create_file to write a new file inside it.',
        );
      }),
    });
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      await expect(
        tools.execute('read_file', { path: '/workspace/poems' }),
      ).rejects.toThrow(
        /is a directory, not a file.*list_files.*create_file/,
      );
    } finally {
      restore();
    }
  });

  it('read_file throws a clear error when no main-process bridge is available (web mode)', async () => {
    const restore = setMked(undefined);
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      await expect(
        tools.execute('read_file', { path: '/anything.md' }),
      ).rejects.toThrow(/main-process bridge unavailable/);
    } finally {
      restore();
    }
  });

  it('read_file prefers the open Monaco model over disk so unsaved edits are captured', async () => {
    // If the user has the file open with unsaved changes, the agent
    // should see what's on screen — not the stale on-disk copy. The
    // mked.readFile path should NOT fire.
    const mkedReadFile = jest.fn();
    const restore = setMked({ readFile: mkedReadFile });
    try {
      const models = new Map<string, FakeModel>();
      models.set('/live.md', makeModel('live unsaved buffer'));
      const bm = makeBridgeManager({ models });
      const tools = new AssistantTools(bm as never);
      const result = (await tools.execute('read_file', {
        path: '/live.md',
      })) as { content: string };
      expect(result.content).toBe('live unsaved buffer');
      expect(mkedReadFile).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('read_file resolves a workspace-relative path via exact-suffix tree match', async () => {
    // Regression: agent passes "native/01-quickstart.md", file tree
    // has it under /workspace/native/01-quickstart.md. Tool resolves
    // to the absolute path before shipping IPC + polling models.
    const models = new Map<string, FakeModel>();
    models.set('/workspace/native/01-quickstart.md', makeModel('hello'));
    const bm = makeBridgeManager({
      models,
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          {
            type: 'directory',
            name: 'native',
            path: '/workspace/native',
            children: [
              {
                type: 'file',
                name: '01-quickstart.md',
                path: '/workspace/native/01-quickstart.md',
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('read_file', {
      path: 'native/01-quickstart.md',
    })) as { path: string; content: string };
    expect(result.path).toBe('/workspace/native/01-quickstart.md');
    expect(result.content).toBe('hello');
    // No IPC needed — model was already cached under the resolved key.
    expect(bm.sent).not.toContainEqual(
      expect.objectContaining({ channel: 'to:file:openpath' }),
    );
  });

  it('read_file falls back to basename match when the relative prefix is wrong (workspace-root-misread regression)', async () => {
    // The user's reported case: workspace is /workspace/omglang/docs,
    // agent passed "docs/native/01-quickstart.md" thinking the
    // workspace was the parent. Exact-suffix match misses; basename
    // match recovers because "01-quickstart.md" is unique in the tree.
    const models = new Map<string, FakeModel>();
    models.set('/workspace/omglang/docs/native/01-quickstart.md', makeModel('x'));
    const bm = makeBridgeManager({
      models,
      treeSnapshot: {
        treeRoot: '/workspace/omglang/docs',
        nodes: [
          {
            type: 'directory',
            name: 'native',
            path: '/workspace/omglang/docs/native',
            children: [
              {
                type: 'file',
                name: '01-quickstart.md',
                path: '/workspace/omglang/docs/native/01-quickstart.md',
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('read_file', {
      path: 'docs/native/01-quickstart.md',
    })) as { path: string };
    expect(result.path).toBe('/workspace/omglang/docs/native/01-quickstart.md');
  });

  it('read_file throws an informative error when a relative suffix matches multiple files', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          { type: 'file', name: 'notes.md', path: '/workspace/a/notes.md' },
          { type: 'file', name: 'notes.md', path: '/workspace/b/notes.md' },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    // Both `/workspace/a/notes.md` and `/workspace/b/notes.md` end
    // with `/notes.md`, so the exact-suffix branch fires with both
    // candidates and we surface them in the error.
    await expect(
      tools.execute('read_file', { path: 'notes.md' }),
    ).rejects.toThrow(/matched 2 files/);
  });

  it('read_file basename fallback fires when no exact suffix matches', async () => {
    // Agent guessed a wrong directory prefix; the suffix doesn't
    // match anything in the tree, so we fall through to basename
    // matching and pick the unique file with that basename.
    const models = new Map<string, FakeModel>();
    models.set('/workspace/sub/foo.md', makeModel('body'));
    const bm = makeBridgeManager({
      models,
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          {
            type: 'directory',
            name: 'sub',
            path: '/workspace/sub',
            children: [
              { type: 'file', name: 'foo.md', path: '/workspace/sub/foo.md' },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('read_file', {
      path: 'wrong-prefix/foo.md', // suffix /wrong-prefix/foo.md doesn't exist
    })) as { path: string };
    expect(result.path).toBe('/workspace/sub/foo.md');
  });

  it('read_file throws when the basename fallback is ambiguous', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          { type: 'file', name: 'dup.md', path: '/workspace/a/dup.md' },
          { type: 'file', name: 'dup.md', path: '/workspace/b/dup.md' },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    // "x/dup.md" suffix matches neither, falls through to basename
    // "dup.md" which matches both → ambiguous error.
    await expect(
      tools.execute('read_file', { path: 'x/dup.md' }),
    ).rejects.toThrow(/share its basename/);
  });

  it('read_file throws when a relative path is supplied with no workspace open', async () => {
    const bm = makeBridgeManager(); // no treeSnapshot → treeRoot null
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('read_file', { path: 'foo.md' }),
    ).rejects.toThrow(/no workspace folder is open/);
  });


  it('list_files walks the tree and returns up to 500 paths', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          { type: 'file', name: 'a.md', path: '/workspace/a.md' },
          {
            type: 'directory',
            name: 'sub',
            path: '/workspace/sub',
            loaded: true,
            children: [
              { type: 'file', name: 'b.md', path: '/workspace/sub/b.md' },
              { type: 'file', name: 'c.md', path: '/workspace/sub/c.md' },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('list_files', {})) as {
      root: string;
      paths: string[];
      directories: string[];
    };
    expect(result.root).toBe('/workspace');
    expect(result.paths.sort()).toEqual([
      '/workspace/a.md',
      '/workspace/sub/b.md',
      '/workspace/sub/c.md',
    ]);
    // Directories must be returned too — the agent asks "list folders"
    // and the tool previously returned [] for that question.
    expect(result.directories).toEqual(['/workspace/sub']);
  });

  it('list_files returns directories alongside files (regression for agent asking "list folders")', async () => {
    // Reported user case: the agent (Anthropic) asked "list all
    // folders that extend from root" and got back only markdown
    // file paths — directories were silently dropped from the walk.
    // This pins the contract so directories appear under their own
    // field and the description's promise actually holds.
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          {
            type: 'directory',
            name: '.claude',
            path: '/workspace/.claude',
            loaded: true,
            children: [],
          },
          {
            type: 'directory',
            name: '.github',
            path: '/workspace/.github',
            loaded: true,
            children: [],
          },
          {
            type: 'directory',
            name: 'docs',
            path: '/workspace/docs',
            loaded: true,
            children: [
              {
                type: 'file',
                name: 'arch.md',
                path: '/workspace/docs/arch.md',
              },
            ],
          },
          {
            type: 'directory',
            name: 'src',
            path: '/workspace/src',
            loaded: true,
            children: [
              {
                type: 'directory',
                name: 'app',
                path: '/workspace/src/app',
                loaded: true,
                children: [
                  {
                    type: 'file',
                    name: 'README.md',
                    path: '/workspace/src/app/README.md',
                  },
                ],
              },
              {
                type: 'directory',
                name: 'browser',
                path: '/workspace/src/browser',
                loaded: true,
                children: [
                  {
                    type: 'file',
                    name: 'README.md',
                    path: '/workspace/src/browser/README.md',
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('list_files', {})) as {
      root: string;
      paths: string[];
      directories: string[];
    };
    expect(result.directories.sort()).toEqual([
      '/workspace/.claude',
      '/workspace/.github',
      '/workspace/docs',
      '/workspace/src',
      '/workspace/src/app',
      '/workspace/src/browser',
    ]);
    expect(result.paths.sort()).toEqual([
      '/workspace/docs/arch.md',
      '/workspace/src/app/README.md',
      '/workspace/src/browser/README.md',
    ]);
  });

  it('list_files requests lazy-load for unloaded directories and walks the populated children (regression)', async () => {
    // Regression for the user-reported case: workspace freshly
    // restored from session has subdirectories present in the snapshot
    // but with `loaded: false` (children populated only when the user
    // expands them in the UI). Previously list_files walked past these
    // and returned an empty list under that branch.
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace/docs',
        nodes: [
          {
            type: 'file',
            name: 'compilation-pipeline.md',
            path: '/workspace/docs/compilation-pipeline.md',
          },
          {
            type: 'directory',
            name: 'native',
            path: '/workspace/docs/native',
            hasChildren: true,
            loaded: false,
            // no `children` yet — lazy
          },
        ],
      },
    });
    // When the tool asks main to load /workspace/docs/native, populate
    // the children in place and fire a change event — same shape the
    // real FileTreeManager.buildFileTree produces.
    bm.fileTreeManager._setLazyLoadHandler((path: string) => {
      if (path !== '/workspace/docs/native') return;
      const snap = bm.fileTreeManager.getSnapshot();
      const dir = snap.nodes.find(
        (n: { path: string }) => n.path === '/workspace/docs/native',
      ) as {
        loaded?: boolean;
        children?: unknown[];
      };
      dir.loaded = true;
      dir.children = [
        {
          type: 'file',
          name: '01-quickstart.md',
          path: '/workspace/docs/native/01-quickstart.md',
        },
        {
          type: 'file',
          name: '02-internals.md',
          path: '/workspace/docs/native/02-internals.md',
        },
      ];
      bm.fileTreeManager._emitTreeChange();
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('list_files', {})) as {
      root: string;
      paths: string[];
    };
    expect(bm.fileTreeManager.requestDirectoryContents).toHaveBeenCalledWith(
      '/workspace/docs/native',
    );
    expect(result.paths.sort()).toEqual([
      '/workspace/docs/compilation-pipeline.md',
      '/workspace/docs/native/01-quickstart.md',
      '/workspace/docs/native/02-internals.md',
    ]);
  });

  it('list_files with subpath resolves the directory by suffix and restricts the listing to that subtree', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace/docs',
        nodes: [
          {
            type: 'file',
            name: 'compilation-pipeline.md',
            path: '/workspace/docs/compilation-pipeline.md',
          },
          {
            type: 'directory',
            name: 'native',
            path: '/workspace/docs/native',
            loaded: true,
            children: [
              {
                type: 'file',
                name: '01-quickstart.md',
                path: '/workspace/docs/native/01-quickstart.md',
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('list_files', {
      subpath: 'native',
    })) as { root: string; paths: string[] };
    // root reflects the resolved subdir, not the workspace root.
    expect(result.root).toBe('/workspace/docs/native');
    // Top-level file outside the scope is excluded.
    expect(result.paths).toEqual([
      '/workspace/docs/native/01-quickstart.md',
    ]);
  });

  it('list_files with subpath lazy-loads the targeted directory before listing', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace/docs',
        nodes: [
          {
            type: 'directory',
            name: 'native',
            path: '/workspace/docs/native',
            hasChildren: true,
            loaded: false,
          },
        ],
      },
    });
    bm.fileTreeManager._setLazyLoadHandler((path: string) => {
      const snap = bm.fileTreeManager.getSnapshot();
      const dir = snap.nodes.find(
        (n: { path: string }) => n.path === path,
      ) as { loaded?: boolean; children?: unknown[] };
      dir.loaded = true;
      dir.children = [
        {
          type: 'file',
          name: 'quickstart.md',
          path: `${path}/quickstart.md`,
        },
      ];
      bm.fileTreeManager._emitTreeChange();
    });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('list_files', {
      subpath: 'native',
    })) as { paths: string[] };
    expect(result.paths).toEqual(['/workspace/docs/native/quickstart.md']);
  });

  it('get_active_file returns null path when no file is open', async () => {
    const bm = makeBridgeManager({ activeFile: null });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('get_active_file', {})) as {
      path: string | null;
    };
    expect(result.path).toBeNull();
  });

  it('get_active_file returns path + content for the open active file', async () => {
    const models = new Map<string, FakeModel>();
    models.set('/active.md', makeModel('hello'));
    const bm = makeBridgeManager({ activeFile: '/active.md', models });
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('get_active_file', {})) as {
      path: string;
      content: string;
    };
    expect(result.path).toBe('/active.md');
    expect(result.content).toBe('hello');
  });

  it('open_tab fires to:file:openpath and returns ok', async () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    const result = (await tools.execute('open_tab', { path: '/x.md' })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    expect(bm.sent).toContainEqual({
      channel: 'to:file:openpath',
      data: { path: '/x.md' },
    });
  });
});

describe('AssistantTools — write-class execution', () => {
  // The write tools (P8 reliability pass) now await the disk write
  // via `window.mked.saveFile` / `createFile` so they can report
  // honest success/failure to the agent. Install no-op shims here so
  // the tests can focus on the editor / model behaviour without
  // tripping the web-mode guard; tests that care about the IPC shape
  // override these to assert specific calls or simulate failure.
  type WriteShim = {
    readFile?: (path: string) => Promise<{ content: string; lineCount: number }>;
    saveFile?: (
      path: string,
      content: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    createFile?: (
      parent: string,
      name: string,
      content: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    createFolder?: (
      parent: string,
      name: string,
    ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  };
  let saveFile: jest.Mock;
  let createFile: jest.Mock;
  let createFolder: jest.Mock;
  let restoreMked: (() => void) | null = null;
  beforeEach(() => {
    saveFile = jest.fn(async (path: string) => ({ ok: true as const, path }));
    createFile = jest.fn(async (parent: string, name: string) => ({
      ok: true as const,
      path: `${parent}/${name}`,
    }));
    createFolder = jest.fn(async (parent: string, name: string) => ({
      ok: true as const,
      path: `${parent}/${name}`,
    }));
    const w = window as Window & { mked?: WriteShim };
    const prev = w.mked;
    w.mked = { saveFile, createFile, createFolder };
    restoreMked = () => {
      if (prev === undefined) delete w.mked;
      else w.mked = prev;
    };
  });
  afterEach(() => {
    restoreMked?.();
    restoreMked = null;
  });

  it('write_file replaces the model content and awaits the disk write via mked.saveFile', async () => {
    const model = makeModel('old');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ models });
    const tools = new AssistantTools(bm as never);
    await tools.execute('write_file', { path: '/x.md', content: 'new' });
    expect(model.setValue).toHaveBeenCalledWith('new');
    expect(saveFile).toHaveBeenCalledWith('/x.md', 'new');
  });

  it('write_file throws when mked.saveFile reports a failure (so the agent hears about it, not a misleading ok)', async () => {
    saveFile.mockResolvedValueOnce({ ok: false, error: 'EACCES: permission denied' });
    const model = makeModel('old');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ models });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('write_file', { path: '/x.md', content: 'new' }),
    ).rejects.toThrow(/Failed to save \/x\.md.*EACCES/);
  });

  it('edit_file finds oldText by raw substring match and replaces at that range (single-line)', async () => {
    const model = makeModel('alpha\nThnk you\nbeta\n');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await tools.execute('edit_file', {
      path: '/x.md',
      oldText: 'Thnk you',
      newText: 'Thank you',
    });
    expect(bm.mkeditor.executeEdits).toHaveBeenCalledTimes(1);
    const [label, edits] = (bm.mkeditor.executeEdits as jest.Mock).mock
      .calls[0] as [
      string,
      Array<{
        range: {
          startLineNumber: number;
          startColumn: number;
          endLineNumber: number;
          endColumn: number;
        };
        text: string;
      }>,
    ];
    expect(label).toBe('assistant-tool-edit_file');
    expect(edits[0].text).toBe('Thank you');
    // Translated via getPositionAt — line 2, cols 1..9 ("Thnk you" = 8 chars; end col = 9).
    expect(edits[0].range).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 9,
    });
  });

  it('edit_file finds oldText that spans multiple lines (Monaco findMatches regression)', async () => {
    // Regression: previously used model.findMatches which doesn't match
    // substrings spanning newlines under isRegex=false. Now uses a raw
    // string search on getValue() + getPositionAt for the range.
    const model = makeModel('# Heading\n\nThnk you\n\nIf you hve\n');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await tools.execute('edit_file', {
      path: '/x.md',
      oldText: 'Thnk you\n\nIf you hve',
      newText: 'Thank you\n\nIf you have',
    });
    expect(bm.mkeditor.executeEdits).toHaveBeenCalledTimes(1);
    const [, edits] = (bm.mkeditor.executeEdits as jest.Mock).mock.calls[0] as [
      string,
      Array<{ range: { startLineNumber: number; endLineNumber: number }; text: string }>,
    ];
    expect(edits[0].text).toBe('Thank you\n\nIf you have');
    // Spans line 3 ("Thnk you") through line 5 ("If you hve").
    expect(edits[0].range.startLineNumber).toBe(3);
    expect(edits[0].range.endLineNumber).toBe(5);
  });

  it('edit_file normalises oldText newlines to the model EOL before searching (CRLF file)', async () => {
    // File stored with CRLF. Agent passes oldText with LF-only newlines
    // (the natural shape from JSON). The tool should translate to CRLF
    // and still find the multi-line match.
    const model = makeModel(
      '# Heading\r\n\r\nThnk you\r\n\r\nIf you hve\r\n',
      '\r\n',
    );
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await tools.execute('edit_file', {
      path: '/x.md',
      oldText: 'Thnk you\n\nIf you hve', // LF-only — JSON wire shape
      newText: 'Thank you\n\nIf you have',
    });
    expect(bm.mkeditor.executeEdits).toHaveBeenCalledTimes(1);
    const [, edits] = (bm.mkeditor.executeEdits as jest.Mock).mock.calls[0] as [
      string,
      Array<{ range: { startLineNumber: number; endLineNumber: number }; text: string }>,
    ];
    // CRLF haystack: line 3 "Thnk you", line 5 "If you hve".
    expect(edits[0].range.startLineNumber).toBe(3);
    expect(edits[0].range.endLineNumber).toBe(5);
  });

  it('edit_file throws when oldText is not found (no partial / fuzzy match)', async () => {
    const model = makeModel('line A\nline B\n');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('edit_file', {
        path: '/x.md',
        oldText: 'line Z',
        newText: 'replaced',
      }),
    ).rejects.toThrow(/oldText not found/);
    expect(bm.mkeditor.executeEdits).not.toHaveBeenCalled();
  });

  it('edit_file throws when oldText matches multiple times (asks for more context)', async () => {
    const model = makeModel('TODO\nbody\nTODO\nmore\n');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('edit_file', {
        path: '/x.md',
        oldText: 'TODO',
        newText: 'DONE',
      }),
    ).rejects.toThrow(/matched multiple places/);
    expect(bm.mkeditor.executeEdits).not.toHaveBeenCalled();
  });

  it('edit_file throws when oldText is empty (no-op guard)', async () => {
    const model = makeModel('content\n');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({ activeFile: '/x.md', models });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('edit_file', { path: '/x.md', oldText: '', newText: 'X' }),
    ).rejects.toThrow(/oldText must not be empty/);
  });

  it('create_file ships parent + name + content via mked.createFile (awaited round-trip)', async () => {
    // P8 reliability: `create_file` was previously fire-and-forget
    // on `to:file:create` and always returned `ok: true` regardless
    // of whether main actually wrote the file. It now awaits the
    // invoke-style `mked.createFile` so a failure (read-only fs,
    // permission denied) reaches the agent instead of a misleading
    // success.
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    await tools.execute('create_file', {
      path: '/workspace/notes/todo.md',
      content: 'todo',
    });
    expect(createFile).toHaveBeenCalledWith(
      '/workspace/notes',
      'todo.md',
      'todo',
    );
  });

  it('create_file throws when mked.createFile reports a failure (agent gets honest feedback)', async () => {
    createFile.mockResolvedValueOnce({
      ok: false,
      error: 'EACCES: permission denied',
    });
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('create_file', {
        path: '/workspace/notes/todo.md',
        content: 'todo',
      }),
    ).rejects.toThrow(/Failed to create .*todo\.md.*EACCES/);
  });

  it('create_file does NOT fire to:file:openpath (main opens the new tab itself after the write resolves)', async () => {
    // Regression: previously fired `to:file:openpath` right after
    // the create channel; main's `fs.stat` could run before
    // `fs.writeFile` completed and emit a spurious "Unable to open
    // path" toast. Main's `createFile` now opens the new file via
    // `setActiveFile` once the awaited write resolves.
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    await tools.execute('create_file', {
      path: '/workspace/notes/todo.md',
      content: 'todo',
    });
    expect(bm.sent).not.toContainEqual(
      expect.objectContaining({ channel: 'to:file:openpath' }),
    );
  });

  it('create_folder ships parent + name via mked.createFolder (awaited round-trip)', async () => {
    // The agent used to fall back to `create_file('foo/.gitkeep')`
    // to make an empty folder visible, because no `create_folder`
    // tool existed. This pins the new path.
    const createFolder = jest.fn(async (parent: string, name: string) => ({
      ok: true as const,
      path: `${parent}/${name}`,
    }));
    const w = window as Window & {
      mked?: { createFolder?: typeof createFolder };
    };
    const prev = w.mked;
    w.mked = { ...prev, createFolder };
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      const result = (await tools.execute('create_folder', {
        path: '/workspace/essays',
      })) as { ok: boolean; path: string };
      expect(createFolder).toHaveBeenCalledWith('/workspace', 'essays');
      expect(result.ok).toBe(true);
      expect(result.path).toBe('/workspace/essays');
    } finally {
      if (prev === undefined) delete w.mked;
      else w.mked = prev;
    }
  });

  it('create_folder is classified as read so it auto-executes (no confirm dialog)', () => {
    // Creating an empty directory is trivially reversible and
    // doesn't touch user content — confirming every one would push
    // the agent right back to the `.gitkeep` workaround.
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    expect(tools.classify('create_folder')).toBe('read');
  });

  it('create_folder throws when mked.createFolder reports a failure', async () => {
    const createFolder = jest.fn(async () => ({
      ok: false as const,
      error: 'EACCES: permission denied',
    }));
    const w = window as Window & {
      mked?: { createFolder?: typeof createFolder };
    };
    const prev = w.mked;
    w.mked = { ...prev, createFolder };
    try {
      const bm = makeBridgeManager();
      const tools = new AssistantTools(bm as never);
      await expect(
        tools.execute('create_folder', { path: '/workspace/essays' }),
      ).rejects.toThrow(/Failed to create folder .*essays.*EACCES/);
    } finally {
      if (prev === undefined) delete w.mked;
      else w.mked = prev;
    }
  });

  it('create_file resolves a workspace-relative path before shipping IPC', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: { treeRoot: '/workspace', nodes: [] },
    });
    const tools = new AssistantTools(bm as never);
    await tools.execute('create_file', {
      path: 'notes/todo.md',
      content: 'body',
    });
    expect(createFile).toHaveBeenCalledWith(
      '/workspace/notes',
      'todo.md',
      'body',
    );
  });

  it('create_file uses LITERAL path resolution — same-basename file in another folder must NOT silently capture the create (regression)', async () => {
    // Reported user case: the agent asked to create
    // `ollama/introduction.md` while an `openai/introduction.md`
    // already existed in a sibling folder. The old read-style
    // resolver did fuzzy basename matching, so it silently
    // redirected the create to `openai/introduction.md`.
    // create paths must be honoured verbatim.
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          {
            type: 'directory',
            name: 'openai',
            path: '/workspace/openai',
            children: [
              {
                type: 'file',
                name: 'introduction.md',
                path: '/workspace/openai/introduction.md',
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    await tools.execute('create_file', {
      path: 'ollama/introduction.md',
      content: 'hi from ollama',
    });
    // The bug: createFile used to be called with
    // ('/workspace/openai', 'introduction.md', ...). The fix
    // honours the literal `ollama/` parent the agent specified.
    expect(createFile).toHaveBeenCalledWith(
      '/workspace/ollama',
      'introduction.md',
      'hi from ollama',
    );
    expect(createFile).not.toHaveBeenCalledWith(
      '/workspace/openai',
      expect.anything(),
      expect.anything(),
    );
  });

  it('create_folder also uses literal resolution — same-basename folder elsewhere is not picked up', async () => {
    const bm = makeBridgeManager({
      treeSnapshot: {
        treeRoot: '/workspace',
        nodes: [
          {
            type: 'directory',
            name: 'parent-a',
            path: '/workspace/parent-a',
            children: [
              {
                type: 'directory',
                name: 'shared',
                path: '/workspace/parent-a/shared',
              },
            ],
          },
        ],
      },
    });
    const tools = new AssistantTools(bm as never);
    await tools.execute('create_folder', {
      path: 'parent-b/shared',
    });
    expect(createFolder).toHaveBeenCalledWith(
      '/workspace/parent-b',
      'shared',
    );
  });

  it('replace_selection fires executeEdits using the current selection range', async () => {
    const model = makeModel('abc');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({
      activeFile: '/x.md',
      models,
      selection: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      },
    });
    const tools = new AssistantTools(bm as never);
    await tools.execute('replace_selection', { content: 'X' });
    expect(bm.mkeditor.executeEdits).toHaveBeenCalledTimes(1);
  });

  it('insert_at_cursor inserts at the current cursor position', async () => {
    const model = makeModel('abc');
    const models = new Map<string, FakeModel>();
    models.set('/x.md', model);
    const bm = makeBridgeManager({
      activeFile: '/x.md',
      models,
      cursorPosition: { lineNumber: 1, column: 2 },
    });
    const tools = new AssistantTools(bm as never);
    await tools.execute('insert_at_cursor', { content: 'X' });
    const [, edits] = (bm.mkeditor.executeEdits as jest.Mock).mock.calls[0] as [
      string,
      Array<{
        range: {
          startLineNumber: number;
          startColumn: number;
          endLineNumber: number;
          endColumn: number;
        };
        text: string;
      }>,
    ];
    expect(edits[0].range.startLineNumber).toBe(1);
    expect(edits[0].range.startColumn).toBe(2);
    expect(edits[0].range.endLineNumber).toBe(1);
    expect(edits[0].range.endColumn).toBe(2);
    expect(edits[0].text).toBe('X');
  });
});

describe('AssistantTools — preview building', () => {
  it('buildPreview returns null for read-class tools', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    expect(tools.buildPreview('read_file', { path: '/x.md' })).toBeNull();
    expect(tools.buildPreview('list_files', {})).toBeNull();
  });

  it('buildPreview for write_file includes before (from open model) + after', () => {
    const models = new Map<string, FakeModel>();
    models.set('/x.md', makeModel('old content'));
    const bm = makeBridgeManager({ models });
    const tools = new AssistantTools(bm as never);
    const preview = tools.buildPreview('write_file', {
      path: '/x.md',
      content: 'new content',
    });
    expect(preview).toEqual({
      kind: 'write',
      path: '/x.md',
      before: 'old content',
      after: 'new content',
    });
  });

  it('buildPreview for edit_file shows oldText (before) and newText (after) directly', () => {
    // Preview anchors on the same string `execute` searches for, so
    // the dialog can't ever disagree with the resulting edit — the
    // original line-range design hid the actual replacement target
    // behind line numbers the agent often miscounted on CRLF files.
    const models = new Map<string, FakeModel>();
    models.set('/x.md', makeModel('line A\nline B\nline C\nline D'));
    const bm = makeBridgeManager({ models });
    const tools = new AssistantTools(bm as never);
    const preview = tools.buildPreview('edit_file', {
      path: '/x.md',
      oldText: 'line B\nline C',
      newText: 'NEW',
    });
    expect(preview?.kind).toBe('edit');
    expect(preview?.path).toBe('/x.md');
    expect(preview?.before).toBe('line B\nline C');
    expect(preview?.after).toBe('NEW');
    // No more line-range detail — the before/after blocks are
    // self-describing now.
    expect(preview?.detail).toBeUndefined();
  });

  it('buildPreview for create_file omits before (file does not exist yet)', () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    const preview = tools.buildPreview('create_file', {
      path: '/new.md',
      content: 'content',
    });
    expect(preview?.kind).toBe('create');
    expect(preview?.before).toBeUndefined();
    expect(preview?.after).toBe('content');
  });
});

describe('AssistantTools — error paths', () => {
  it('execute() throws UnknownToolError for tools not in the catalog', async () => {
    const bm = makeBridgeManager();
    const tools = new AssistantTools(bm as never);
    await expect(tools.execute('not_a_tool', {})).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it('replace_selection without an active selection throws "No selection"', async () => {
    const bm = makeBridgeManager({ selection: null });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('replace_selection', { content: 'X' }),
    ).rejects.toThrow(/No selection/);
  });

  it('insert_at_cursor without a cursor position throws "No cursor"', async () => {
    const bm = makeBridgeManager({ cursorPosition: null });
    const tools = new AssistantTools(bm as never);
    await expect(
      tools.execute('insert_at_cursor', { content: 'X' }),
    ).rejects.toThrow(/No cursor/);
  });
});
