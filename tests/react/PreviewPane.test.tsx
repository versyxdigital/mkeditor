import * as React from 'react';
import { act, waitFor } from '@testing-library/react';

import { PreviewPane } from '../../src/browser/react/components/PreviewPane';
import {
  renderWithProviders,
  fakeDispatcher,
  fakeFileManager,
  fakeFileTreeManager,
} from '../utils/render';

// Stub the markdown renderer + ScrollSync helper so we exercise the
// dispatch-→-innerHTML wiring without depending on markdown-it / KaTeX
// /highlight.js being available in jsdom. PreviewPane dynamic-imports
// Markdown (so its bundle ends up in a separate webpack chunk); the
// mock is hooked under the same module path that the dynamic import
// resolves to.
jest.mock('../../src/browser/core/Markdown', () => ({
  Markdown: {
    render: jest.fn((src: string) => `<rendered>${src}</rendered>`),
  },
}));

jest.mock('../../src/browser/extensions/editor/ScrollSync', () => ({
  ScrollSync: jest.fn(),
  refreshLines: jest.fn(),
}));

describe('<PreviewPane>', () => {
  it('renders the initial markdown after the lazy Markdown chunk loads', async () => {
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '# Hello'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };

    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
      },
    });

    const content = container.querySelector('#preview-content');

    // The dynamic `import()` in PreviewPane resolves on a microtask;
    // wait for the first render to land.
    await waitFor(() => {
      expect(content?.innerHTML).toBe('<rendered># Hello</rendered>');
    });
  });

  it('rewrites a relative <img> src to a file:// URL rooted at the active file directory (desktop)', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="collector.png" alt="c"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![c](collector.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        fileManager: fakeFileManager({
          activeFile: 'C:/Users/chris/workspace/foo/readme.md',
        }) as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [],
          treeRoot: 'C:/Users/chris/workspace/foo',
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe(
        'file:///C:/Users/chris/workspace/foo/collector.png',
      );
    });
  });

  it('falls back to the workspace tree root when there is no active file (desktop)', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="cover.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![](cover.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        fileManager: fakeFileManager({ activeFile: null }) as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [],
          treeRoot: '/home/chris/notes',
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img!.getAttribute('src')).toBe(
        'file:///home/chris/notes/cover.png',
      );
    });
  });

  it('does not rewrite an http(s) <img> src', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="https://example.com/foo.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![](https://example.com/foo.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        fileManager: fakeFileManager({
          activeFile: 'C:/work/readme.md',
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img!.getAttribute('src')).toBe('https://example.com/foo.png');
    });
  });

  it('strips a relative <img> src on the first render before session restore propagates (avoids bundle-dir 404)', async () => {
    // Regression for the console error users saw on relaunch with a
    // saved tab open: PreviewPane's first paint runs after the
    // markdown chunk lands but before the restored activeFile makes
    // it through FilesContext, so the resolver has no baseDir to
    // work with. Leaving the relative src in place lets the browser
    // fetch `dist/collector.png` and 404. Blanking the src suppresses
    // the bad fetch; the next render (triggered by activeFile / tree
    // root effect) restores the proper file:// URL.
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="collector.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![](collector.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        // No active file and no tree root — the transitional state.
        fileManager: fakeFileManager({ activeFile: null }) as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [],
          treeRoot: null,
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      // The img element renders but with no src — no fetch issued.
      expect(img!.hasAttribute('src')).toBe(false);
    });
  });

  it('uses the last editable file path when the active tab is a diff:// overlay (desktop)', async () => {
    // Regression: when a tool-call inline diff is the active tab,
    // `FileManager.activeFile` holds a synthetic `diff://<toolCallId>`
    // id. Previously PreviewPane fed that straight into the asset
    // resolver as `baseDir`, producing `diff:/...` paths that
    // `isFilesystemPath` rejects, leaving the relative `<img src>`
    // intact and 404-ing against the bundle. Routing through
    // `getActiveEditablePath()` recovers the most-recent real file
    // and the preview keeps resolving images against it.
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="collector.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![](collector.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        fileManager: fakeFileManager({
          // Active tab is the diff overlay …
          activeFile: 'diff://tc-1',
          // … but the underlying real file is the editable path the
          // preview should resolve images against.
          activeEditablePath: 'C:/Users/chris/workspace/foo/readme.md',
        }) as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [],
          treeRoot: 'C:/Users/chris/workspace/foo',
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe(
        'file:///C:/Users/chris/workspace/foo/collector.png',
      );
    });
  });

  it('does not rewrite anything in web mode (separate blob-URL workstream)', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="cover.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '![](cover.png)'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'web',
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
        fileManager: fakeFileManager({
          activeFile: '/workspace/readme.md',
        }) as any,
      },
    });
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img!.getAttribute('src')).toBe('cover.png');
    });
  });

  it('re-renders the preview when the dispatcher fires editor:render', async () => {
    const dispatcher = fakeDispatcher();
    let value = '# v1';
    const editorManager = {
      getValue: jest.fn(() => value),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };

    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
      },
    });

    const content = container.querySelector('#preview-content');
    await waitFor(() => {
      expect(content?.innerHTML).toBe('<rendered># v1</rendered>');
    });

    // Mutate the value the manager returns and dispatch — the pane
    // should re-render with the new content.
    value = '# v2';
    act(() => {
      dispatcher.render();
    });

    expect(content?.innerHTML).toBe('<rendered># v2</rendered>');
  });
});
