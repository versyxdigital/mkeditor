let mockHoverFactory:
  ((placement: string, instant: boolean) => unknown) | undefined;
let mockMarkdownCodeRenderer: { render: () => string } | undefined;
const mockCreateDiffEditor = jest.fn();
const mockComputeDiff = jest.fn();
const mockRootInstantiation = {
  createInstance: jest.fn((constructor: unknown) =>
    constructor === 'markdown-renderer'
      ? { render: () => 'persistent markdown renderer' }
      : { showHover: () => 'persistent hover' },
  ),
};
const mockRootHover = {};
const mockRootMarkdown = {
  setDefaultCodeBlockRenderer: jest.fn((renderer) => {
    mockMarkdownCodeRenderer = renderer;
  }),
};

jest.mock(
  'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js',
  () => ({}),
);
jest.mock(
  'monaco-editor/editor/contrib/suggest/browser/suggestController.js',
  () => ({}),
);
jest.mock('monaco-editor/editor/editor.api', () => ({
  editor: {
    createDiffEditor: mockCreateDiffEditor,
    createModel: jest.fn(),
    setTheme: jest.fn(),
  },
  languages: {},
}));
jest.mock(
  'monaco-editor/editor/standalone/browser/standaloneServices.js',
  () => ({
    StandaloneServices: {
      get: jest.fn((id) =>
        id === 'instantiation'
          ? mockRootInstantiation
          : id === 'hover'
            ? mockRootHover
            : mockRootMarkdown,
      ),
    },
  }),
);
jest.mock(
  'monaco-editor/platform/instantiation/common/instantiation.js',
  () => ({ IInstantiationService: 'instantiation' }),
);
jest.mock('monaco-editor/platform/hover/browser/hover.js', () => ({
  IHoverService: 'hover',
  WorkbenchHoverDelegate: 'hover-delegate',
}));
jest.mock(
  'monaco-editor/base/browser/ui/hover/hoverDelegateFactory.js',
  () => ({
    setHoverDelegateFactory: jest.fn((factory) => {
      mockHoverFactory = factory;
    }),
  }),
);
jest.mock('monaco-editor/base/browser/ui/hover/hoverDelegate2.js', () => ({
  setBaseLayerHoverDelegate: jest.fn(),
}));
jest.mock(
  'monaco-editor/platform/markdown/browser/markdownRenderer.js',
  () => ({ IMarkdownRendererService: 'markdown' }),
);
jest.mock(
  'monaco-editor/editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js',
  () => ({ EditorMarkdownCodeBlockRenderer: 'markdown-renderer' }),
);
jest.mock(
  'monaco-editor/editor/browser/widget/diffEditor/diffProviderFactoryService.js',
  () => ({
    WorkerBasedDocumentDiffProvider: class {
      computeDiff(...args: unknown[]) {
        return mockComputeDiff.apply(this, args);
      }
    },
  }),
);

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockComputeDiff.mockReset();
  mockCreateDiffEditor.mockReset();
  mockHoverFactory = undefined;
  mockMarkdownCodeRenderer = undefined;
});

describe('standalone diff UI service lifetime', () => {
  it('keeps main-editor hover and Markdown rendering alive after a diff is disposed', () => {
    mockCreateDiffEditor.mockImplementation(() => {
      let disposed = false;
      mockHoverFactory = () => {
        if (disposed) throw new Error('InstantiationService has been disposed');
        return { child: true };
      };
      mockMarkdownCodeRenderer = {
        render: () => {
          if (disposed)
            throw new Error('InstantiationService has been disposed');
          return 'child renderer';
        },
      };
      return {
        dispose: () => {
          disposed = true;
        },
      };
    });
    const api = require('../src/browser/monaco');
    const rawApi = require('monaco-editor/editor/editor.api');
    const host = document.createElement('div');
    const options = { readOnly: true };
    const diff = api.editor.createDiffEditor(host, options);
    diff.dispose();
    const hover = mockHoverFactory!('mouse', false) as {
      showHover: () => string;
    };
    expect(hover.showHover()).toBe('persistent hover');
    expect(mockMarkdownCodeRenderer!.render()).toBe(
      'persistent markdown renderer',
    );
    expect(api.editor).toBe(rawApi.editor);
    expect(api.editor.createModel).toBe(rawApi.editor.createModel);
    expect(mockCreateDiffEditor).toHaveBeenCalledWith(host, options);
  });

  it('restores persistent services even when diff construction fails', () => {
    const failure = new Error('partial construction failed');
    mockCreateDiffEditor.mockImplementation(() => {
      mockHoverFactory = () => {
        throw new Error('disposed child');
      };
      throw failure;
    });
    const api = require('../src/browser/monaco');
    expect(() =>
      api.editor.createDiffEditor(document.createElement('div')),
    ).toThrow(failure);
    expect(() => mockHoverFactory!('element', true)).not.toThrow();
    expect(mockMarkdownCodeRenderer!.render()).toBe(
      'persistent markdown renderer',
    );
  });
});

function loadProvider() {
  require('../src/browser/monaco');
  const {
    WorkerBasedDocumentDiffProvider,
  } = require('monaco-editor/editor/browser/widget/diffEditor/diffProviderFactoryService.js');
  return new WorkerBasedDocumentDiffProvider();
}

function models() {
  const state = { originalDisposed: false, modifiedDisposed: false };
  return {
    state,
    original: { isDisposed: () => state.originalDisposed },
    modified: { isDisposed: () => state.modifiedDisposed },
    token: { isCancellationRequested: false },
  };
}

describe('obsolete diff worker requests', () => {
  it('returns null for a rejected worker request after cancellation', async () => {
    const provider = loadProvider();
    const { original, modified, token } = models();
    mockComputeDiff.mockImplementation(async () => {
      token.isCancellationRequested = true;
      throw new Error('no diff result available');
    });
    await expect(
      provider.computeDiff(original, modified, {}, token),
    ).resolves.toBeNull();
  });

  it.each(['originalDisposed', 'modifiedDisposed'] as const)(
    'returns null after %s without suppressing active errors',
    async (key) => {
      const provider = loadProvider();
      const { original, modified, token, state } = models();
      mockComputeDiff.mockImplementation(async () => {
        state[key] = true;
        throw new Error('no diff result available');
      });
      await expect(
        provider.computeDiff(original, modified, {}, token),
      ).resolves.toBeNull();
    },
  );

  it('preserves a live worker failure', async () => {
    const provider = loadProvider();
    const { original, modified, token } = models();
    const error = new Error('genuine diff failure');
    mockComputeDiff.mockRejectedValue(error);
    await expect(
      provider.computeDiff(original, modified, {}, token),
    ).rejects.toBe(error);
  });

  it('preserves successful results, method receiver, and option arguments', async () => {
    const provider = loadProvider();
    const { original, modified, token } = models();
    const options = { computeMoves: false };
    const result = { changes: [], identical: false };
    mockComputeDiff.mockResolvedValue(result);
    await expect(
      provider.computeDiff(original, modified, options, token),
    ).resolves.toBe(result);
    expect(mockComputeDiff).toHaveBeenCalledWith(
      original,
      modified,
      options,
      token,
    );
    expect(mockComputeDiff.mock.contexts[0]).toBe(provider);
  });

  it('does not start work for already-cancelled requests', async () => {
    const provider = loadProvider();
    const { original, modified, token } = models();
    token.isCancellationRequested = true;
    await expect(
      provider.computeDiff(original, modified, {}, token),
    ).resolves.toBeNull();
    expect(mockComputeDiff).not.toHaveBeenCalled();
  });

  it('drops a successful result if its models were disposed during computation', async () => {
    const provider = loadProvider();
    const { original, modified, token, state } = models();
    mockComputeDiff.mockImplementation(async () => {
      state.modifiedDisposed = true;
      return { changes: [] };
    });
    await expect(
      provider.computeDiff(original, modified, {}, token),
    ).resolves.toBeNull();
  });
});
