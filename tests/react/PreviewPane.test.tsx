import * as React from 'react';
import { act, waitFor } from '@testing-library/react';

import { PreviewPane } from '../../src/browser/react/components/PreviewPane';
import { renderMermaidDiagrams } from '../../src/browser/mermaid';
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
  renderAssistantMarkdown: jest.fn(
    () =>
      '<img src="relative.png"><a href="other.md">Other</a><a href="https://example.test">External</a>',
  ),
  Markdown: {
    render: jest.fn((src: string) => `<rendered>${src}</rendered>`),
  },
}));

jest.mock('../../src/browser/extensions/editor/ScrollSync', () => ({
  ScrollSync: jest.fn(),
  refreshLines: jest.fn(),
}));

jest.mock('../../src/browser/mermaid', () => ({
  renderMermaidDiagrams: jest.fn(async () => {}),
}));

describe('<PreviewPane>', () => {
  it('renders document diagrams and aborts obsolete work when text changes or the preview unmounts', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    const renderer = Markdown.render as jest.Mock;
    renderer.mockReturnValueOnce(
      '<div data-diagram="mermaid" data-source="QQ=="><pre>A</pre></div>',
    );
    const dispatcher = fakeDispatcher();
    let value = 'first diagram';
    const view = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as never,
        editorManager: { getValue: () => value } as never,
      },
    });
    await waitFor(() => expect(renderMermaidDiagrams).toHaveBeenCalledTimes(1));
    const first = jest.mocked(renderMermaidDiagrams).mock.calls[0][2];
    expect(first.aborted).toBe(false);
    renderer.mockReturnValueOnce(
      '<div data-diagram="mermaid" data-source="Qg=="><pre>B</pre></div>',
    );
    value = 'next diagram';
    act(() => dispatcher.render());
    expect(first.aborted).toBe(true);
    expect(view.container.querySelector('pre')?.textContent).toBe('B');
    const second = jest.mocked(renderMermaidDiagrams).mock.calls[1][2];
    view.unmount();
    expect(second.aborted).toBe(true);
  });
  it('remote documents use safe rendering and never resolve relative assets against a local workspace', async () => {
    const {
      renderAssistantMarkdown,
    } = require('../../src/browser/core/Markdown');
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        fileManager: fakeFileManager({
          activeFile: 'cloud-drive://connection/account/id',
        }) as never,
        fileTreeManager: fakeFileTreeManager({
          treeRoot: 'C:/private',
        }) as never,
        editorManager: { getValue: () => '![image](relative.png)' } as never,
      },
    });
    await waitFor(() =>
      expect(container.querySelector('img')).toBeInTheDocument(),
    );
    expect(renderAssistantMarkdown).toHaveBeenCalled();
    expect(container.querySelector('img')).not.toHaveAttribute('src');
    expect(container.querySelector('a')).not.toHaveAttribute('href');
    expect(container.querySelectorAll('a')[1]).toHaveAttribute(
      'href',
      'https://example.test',
    );
  });
  it('reuses unchanged Markdown and DOM across duplicate render events', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    const renderer = Markdown.render as jest.Mock;
    renderer.mockClear();
    const dispatcher = fakeDispatcher();
    let value = '# Cached';
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as any,
        editorManager: { getValue: () => value } as any,
      },
    });
    await waitFor(() =>
      expect(container.querySelector('rendered')?.textContent).toBe('# Cached'),
    );
    const original = container.querySelector('rendered');
    act(() => {
      dispatcher.render();
      dispatcher.render();
    });
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('rendered')).toBe(original);
    value = '# Changed';
    act(() => {
      dispatcher.render();
    });
    expect(renderer).toHaveBeenCalledTimes(2);
    expect(container.querySelector('rendered')?.textContent).toBe('# Changed');
  });

  it('reuses parsed Markdown while rewriting assets after a file switch', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    const renderer = Markdown.render as jest.Mock;
    renderer.mockClear();
    renderer.mockReturnValueOnce('<img src="logo.png">');
    const dispatcher = fakeDispatcher();
    const files = fakeFileManager({ activeFile: 'C:/work/first/readme.md' });
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: dispatcher as any,
        editorManager: { getValue: () => '![logo](logo.png)' } as any,
        fileManager: files as any,
        fileTreeManager: fakeFileTreeManager({ treeRoot: 'C:/work' }) as any,
      },
    });
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'file:///C:/work/first/logo.png',
      ),
    );
    act(() => {
      files.activateFile('C:/work/second/readme.md');
    });
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'file:///C:/work/second/logo.png',
      ),
    );
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it('strips rejected absolute and relative local paths before they reach the live DOM', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<img src="/etc/private.png"><img src="../../private.png"><a href="D:/private.pdf">outside</a>',
    );
    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        mode: 'desktop',
        dispatcher: fakeDispatcher() as any,
        editorManager: { getValue: () => 'local assets' } as any,
        fileManager: fakeFileManager({
          activeFile: 'C:/work/notes/readme.md',
        }) as any,
        fileTreeManager: fakeFileTreeManager({ treeRoot: 'C:/work' }) as any,
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('img')).toHaveLength(2),
    );
    expect(container.querySelector('img[src]')).toBeNull();
    expect(container.querySelector('a[href]')).toBeNull();
  });

  it('handles rejected clipboard promises without an unhandled rejection', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<div class="md-codeblock" data-source="aGVsbG8="><button class="md-codeblock-copy">Copy</button></div>',
    );
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = renderWithProviders(<PreviewPane />, {
        managers: {
          dispatcher: fakeDispatcher() as any,
          editorManager: { getValue: () => 'copy' } as any,
        },
      });
      await waitFor(() =>
        expect(container.querySelector('button')).not.toBeNull(),
      );
      await act(async () => {
        container.querySelector('button')!.click();
      });
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

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

  it('strips an out-of-workspace <img src="file:///..."> URL (workspace-containment guarantee)', async () => {
    // Preview HTML must not be able to reach arbitrary on-disk files
    // via an explicit `file://` URL. The resolver returns null on
    // policy reject; the caller strips the attribute so the browser
    // never issues the fetch.
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="file:///C:/Users/victim/Pictures/secret.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(
        () => '![](file:///C:/Users/victim/Pictures/secret.png)',
      ),
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
      expect(img!.hasAttribute('src')).toBe(false);
    });
  });

  it('rewrites an in-workspace <img src="file:///..."> URL through the resolver', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><img src="file:///C:/Users/chris/workspace/foo/cover.png"></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => ''),
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
      expect(img!.getAttribute('src')).toBe(
        'file:///C:/Users/chris/workspace/foo/cover.png',
      );
    });
  });

  it('strips an out-of-workspace <a href="file:///..."> link (no shell.openExternal escape)', async () => {
    const { Markdown } = require('../../src/browser/core/Markdown');
    (Markdown.render as jest.Mock).mockReturnValueOnce(
      '<p><a href="file:///C:/Users/victim/secret.pdf">link</a></p>',
    );
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => ''),
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
      const a = container.querySelector('a');
      expect(a).not.toBeNull();
      expect(a!.hasAttribute('href')).toBe(false);
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
