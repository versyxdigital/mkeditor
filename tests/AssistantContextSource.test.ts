/**
 * AssistantContextSource (P6) unit tests.
 *
 * The class is a thin adapter — its real job is the three guards
 * (untitled active-file filter, bare-cursor selection filter, open-
 * model preference in `readFile`). All three failure modes that
 * could surface a phantom chip or stale content are pinned here so
 * a future refactor can't silently regress them.
 */

import { AssistantContextSource } from '../src/browser/core/AssistantContextSource';

interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface FakeModel {
  getValue: jest.Mock<string, []>;
  getValueInRange: jest.Mock<string, [FakeRange]>;
}

interface FakeBridgeManager {
  fileManager: {
    activeFile: string | null;
    models: Map<string, FakeModel>;
  };
  mkeditor: {
    getSelection: jest.Mock;
    getModel: jest.Mock;
  };
}

function makeBridge(opts: {
  activeFile?: string | null;
  models?: Record<string, string>;
  selection?: FakeRange | null;
  selectionText?: string;
} = {}): FakeBridgeManager {
  const models = new Map<string, FakeModel>();
  for (const [path, content] of Object.entries(opts.models ?? {})) {
    models.set(path, {
      getValue: jest.fn(() => content),
      getValueInRange: jest.fn(() => opts.selectionText ?? ''),
    });
  }
  return {
    fileManager: {
      activeFile: opts.activeFile ?? null,
      models,
    },
    mkeditor: {
      getSelection: jest.fn(() => opts.selection ?? null),
      getModel: jest.fn(() => {
        const path = opts.activeFile;
        if (!path) return null;
        return models.get(path) ?? null;
      }),
    },
  };
}

/**
 * Test scaffold for the `mked.readFile` invoke helper. The
 * AssistantContextSource looks the symbol up off `window.mked` so we
 * mutate window.mked directly + restore on teardown. Mirrors the
 * pattern already used by the read_file tool tests.
 */
type MkedShim = {
  readFile: (path: string) => Promise<{ content: string; lineCount: number }>;
};

function setMked(shim: MkedShim | undefined): () => void {
  const w = window as Window & { mked?: MkedShim };
  const prev = w.mked;
  if (shim === undefined) delete w.mked;
  else w.mked = shim;
  return () => {
    if (prev === undefined) delete w.mked;
    else w.mked = prev;
  };
}

describe('AssistantContextSource.getActiveFile', () => {
  it('returns null when no file is active', () => {
    const src = new AssistantContextSource(makeBridge() as never);
    expect(src.getActiveFile()).toBeNull();
  });

  it('filters untitled scratch buffers so they do not surface as the active-file chip', () => {
    // Regression: agents seeing "untitled-3 (active)" as a context
    // chip would try to read the buffer via tools (no on-disk path)
    // and confuse themselves. Untitled buffers must be invisible to
    // the context surface.
    const src = new AssistantContextSource(
      makeBridge({ activeFile: 'untitled-3', models: { 'untitled-3': 'x' } }) as never,
    );
    expect(src.getActiveFile()).toBeNull();
  });

  it('returns the active file with the live Monaco model content (captures unsaved edits)', () => {
    const src = new AssistantContextSource(
      makeBridge({
        activeFile: '/w/a.md',
        models: { '/w/a.md': 'live unsaved buffer' },
      }) as never,
    );
    expect(src.getActiveFile()).toEqual({
      path: '/w/a.md',
      content: 'live unsaved buffer',
    });
  });

  it('returns null when the active path has no model (mid-tab-swap race)', () => {
    const src = new AssistantContextSource(
      makeBridge({ activeFile: '/w/gone.md' }) as never,
    );
    expect(src.getActiveFile()).toBeNull();
  });
});

describe('AssistantContextSource.getSelection', () => {
  it('returns null when there is no editor selection', () => {
    const src = new AssistantContextSource(makeBridge({ selection: null }) as never);
    expect(src.getSelection()).toBeNull();
  });

  it('returns null when the selection is empty (bare cursor)', () => {
    // Monaco fires onDidChangeCursorSelection even for plain cursor
    // movements — start==end. We filter those so the share-selection
    // chip doesn't appear spuriously when the user just clicks.
    const src = new AssistantContextSource(
      makeBridge({
        activeFile: '/w/a.md',
        models: { '/w/a.md': 'body' },
        selection: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 3 },
        selectionText: '',
      }) as never,
    );
    expect(src.getSelection()).toBeNull();
  });

  it('returns the selection with line range when text is selected', () => {
    const src = new AssistantContextSource(
      makeBridge({
        activeFile: '/w/a.md',
        models: { '/w/a.md': 'body' },
        selection: {
          startLineNumber: 12,
          startColumn: 1,
          endLineNumber: 14,
          endColumn: 5,
        },
        selectionText: 'three\nselected\nlines',
      }) as never,
    );
    expect(src.getSelection()).toEqual({
      path: '/w/a.md',
      text: 'three\nselected\nlines',
      startLine: 12,
      endLine: 14,
    });
  });

  it('reports path:null when the active file is an untitled buffer (selection still travels)', () => {
    const src = new AssistantContextSource(
      makeBridge({
        activeFile: 'untitled-1',
        models: { 'untitled-1': 'scratch' },
        selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
        selectionText: 'scr',
      }) as never,
    );
    expect(src.getSelection()).toEqual({
      path: null,
      text: 'scr',
      startLine: 1,
      endLine: 1,
    });
  });
});

describe('AssistantContextSource.readFile', () => {
  it('prefers the open Monaco model over disk so the agent sees unsaved edits', async () => {
    const mkedReadFile = jest.fn();
    const restore = setMked({ readFile: mkedReadFile });
    try {
      const src = new AssistantContextSource(
        makeBridge({ models: { '/w/a.md': 'live unsaved' } }) as never,
      );
      const result = await src.readFile('/w/a.md');
      expect(result).toEqual({ content: 'live unsaved' });
      // mked.readFile must NOT fire — the in-memory buffer wins.
      expect(mkedReadFile).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('falls back to window.mked.readFile when the file is not open as a tab', async () => {
    const restore = setMked({
      readFile: jest.fn(async () => ({ content: 'disk body', lineCount: 1 })),
    });
    try {
      const src = new AssistantContextSource(makeBridge() as never);
      const result = await src.readFile('/w/cold.md');
      expect(result).toEqual({ content: 'disk body' });
    } finally {
      restore();
    }
  });

  it('throws a descriptive web-mode error when no main-process bridge is available', async () => {
    const restore = setMked(undefined);
    try {
      const src = new AssistantContextSource(makeBridge() as never);
      await expect(src.readFile('/w/x.md')).rejects.toThrow(
        /main-process bridge unavailable/,
      );
    } finally {
      restore();
    }
  });
});
