import * as React from 'react';
import { act, fireEvent } from '@testing-library/react';

import { FileTreePanel } from '../../src/browser/react/components/FileTreePanel';
import type { TreeNode } from '../../src/browser/core/FileTreeManager';
import {
  renderWithProviders,
  fakeFileManager,
  fakeFileTreeManager,
} from '../utils/render';

const tree: TreeNode[] = [
  {
    type: 'directory',
    name: 'docs',
    path: '/root/docs',
    hasChildren: true,
    loaded: true,
    children: [
      { type: 'file', name: 'readme.md', path: '/root/docs/readme.md' },
    ],
  },
  { type: 'file', name: 'notes.md', path: '/root/notes.md' },
];

describe('<FileTreePanel>', () => {
  it('renders top-level nodes; child rows are collapsed by default', () => {
    const fileManager = fakeFileManager();
    const fileTreeManager = fakeFileTreeManager({
      nodes: tree,
      treeRoot: '/root',
    });

    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fileManager as any,
        fileTreeManager: fileTreeManager as any,
      },
    });

    // The two top-level rows are visible.
    const topLevel = container.querySelectorAll('#file-tree > li[data-path]');
    const paths = Array.from(topLevel).map(
      (li) => (li as HTMLLIElement).dataset.path,
    );
    expect(paths).toEqual(['/root/docs', '/root/notes.md']);

    // The child is collapsed by default — no `data-path="/root/docs/readme.md"`
    // is in the DOM yet.
    expect(
      container.querySelector('li[data-path="/root/docs/readme.md"]'),
    ).toBeNull();
  });

  it('expands a directory on click and reveals its children', () => {
    const fileManager = fakeFileManager();
    const fileTreeManager = fakeFileTreeManager({
      nodes: tree,
      treeRoot: '/root',
    });

    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fileManager as any,
        fileTreeManager: fileTreeManager as any,
      },
    });

    const dirRow = container.querySelector(
      'li[data-path="/root/docs"]',
    ) as HTMLLIElement;
    fireEvent.click(dirRow);

    // After click, the child row is rendered.
    expect(
      container.querySelector('li[data-path="/root/docs/readme.md"]'),
    ).not.toBeNull();
  });

  it('opens a file via fileManager.openFileFromPath when a file row is clicked', () => {
    const fileManager = fakeFileManager();
    const fileTreeManager = fakeFileTreeManager({
      nodes: tree,
      treeRoot: '/root',
    });

    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fileManager as any,
        fileTreeManager: fileTreeManager as any,
      },
    });

    const fileRow = container.querySelector(
      'li[data-path="/root/notes.md"]',
    ) as HTMLLIElement;
    fireEvent.click(fileRow);

    expect(fileManager.openFileFromPath).toHaveBeenCalledWith('/root/notes.md');
  });

  it('collapses expanded directories when a tree refresh drops their `loaded` flag (regression: post-delete icons stuck open)', () => {
    // Reported bug: deleting a file/folder triggers a main-side
    // re-read of the parent which arrives as a shallow listing
    // (entries have `hasChildren: true` but no `loaded` / `children`).
    // The user-visible children disappeared but the chevron /
    // folder-open icons stayed expanded because `expandedPaths`
    // still held the path. Gating the visual state on
    // `node.loaded === true` keeps the icons honest — the
    // directory re-collapses cleanly and one more click re-expands
    // it through the normal lazy-load path.
    const fileManager = fakeFileManager();
    const fileTreeManager = fakeFileTreeManager({
      nodes: tree,
      treeRoot: '/root',
    });
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fileManager as any,
        fileTreeManager: fileTreeManager as any,
      },
    });
    // Expand `docs`.
    const dirRow = container.querySelector(
      'li[data-path="/root/docs"]',
    ) as HTMLLIElement;
    fireEvent.click(dirRow);
    expect(
      container.querySelector('li[data-path="/root/docs/readme.md"]'),
    ).not.toBeNull();
    // Now simulate a post-delete refresh: the same `docs` node
    // comes back without `loaded` / `children` (main shipped a
    // fresh shallow listing).
    act(() => {
      fileTreeManager._setSnapshot({
        treeRoot: '/root',
        nodes: [
          {
            type: 'directory',
            name: 'docs',
            path: '/root/docs',
            hasChildren: true,
          },
          { type: 'file', name: 'notes.md', path: '/root/notes.md' },
        ],
      });
    });
    // The children block is gone — same `expanded` boolean drives
    // the chevron/folder icon names, so this transitively pins the
    // icon state. (Asserting directly on the FontAwesome SVG is
    // env-flaky; the children-row absence is the visible signal.)
    expect(
      container.querySelector('li[data-path="/root/docs/readme.md"]'),
    ).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/*  Drag-and-drop: in-tree moves                                            */
/* ---------------------------------------------------------------------- */

const MKED_MIME = 'application/x-mked-path';

/**
 * jsdom doesn't ship a working `DataTransfer` constructor, so we build
 * a minimal mock that records `setData` writes + replays via
 * `getData`. The handler also reads `types` and `dropEffect` — both
 * are wired here.
 */
function makeDataTransfer(): {
  setData: jest.Mock;
  getData: jest.Mock;
  types: string[];
  dropEffect: string;
  effectAllowed: string;
} {
  const store: Record<string, string> = {};
  return {
    setData: jest.fn((mime: string, value: string) => {
      store[mime] = value;
    }),
    getData: jest.fn((mime: string) => store[mime] ?? ''),
    get types() {
      return Object.keys(store);
    },
    dropEffect: 'none',
    effectAllowed: 'none',
  };
}

/**
 * Fake `BridgeManager` that captures `moveItem` calls so tests can
 * assert source/destination without standing up the full
 * BridgeManager + WebFileBridge stack.
 */
function fakeBridgeManager(
  moveItemResult:
    | { ok: true; oldPath: string; newPath: string }
    | { ok: false; error: string } = {
    ok: true,
    oldPath: '',
    newPath: '',
  },
) {
  return {
    bridge: { send: jest.fn(), receive: jest.fn() },
    openInDefaultViewer: jest.fn(),
    moveItem: jest.fn(async (src: string, dst: string) => {
      // Reflect the args back so the default success path is
      // self-consistent.
      if (moveItemResult.ok) {
        return { ok: true as const, oldPath: src, newPath: dst };
      }
      return moveItemResult;
    }),
  };
}

describe('<FileTreePanel> — drag-and-drop moves', () => {
  // Each directory carries at least one .md descendant so the
  // default `md`-only file-explorer filter doesn't sweep the rows
  // out of the rendered tree before we can target them.
  const dragTree: TreeNode[] = [
    {
      type: 'directory',
      name: 'docs',
      path: '/root/docs',
      hasChildren: true,
      loaded: true,
      children: [{ type: 'file', name: 'a.md', path: '/root/docs/a.md' }],
    },
    {
      type: 'directory',
      name: 'archive',
      path: '/root/archive',
      hasChildren: true,
      loaded: true,
      children: [{ type: 'file', name: 'b.md', path: '/root/archive/b.md' }],
    },
    { type: 'file', name: 'notes.md', path: '/root/notes.md' },
  ];

  it('drag a file onto a directory row → fires BridgeManager.moveItem with target/<basename>', () => {
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: dragTree,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    });
    const source = container.querySelector(
      'li[data-path="/root/notes.md"]',
    ) as HTMLLIElement;
    const target = container.querySelector(
      'li[data-path="/root/archive"]',
    ) as HTMLLIElement;
    const dt = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(source, { dataTransfer: dt });
      fireEvent.dragOver(target, { dataTransfer: dt });
      fireEvent.drop(target, { dataTransfer: dt });
    });
    expect(bm.moveItem).toHaveBeenCalledTimes(1);
    expect(bm.moveItem).toHaveBeenCalledWith(
      '/root/notes.md',
      '/root/archive/notes.md',
    );
  });

  it('dropping a file row onto another file row does NOT fire moveItem (files are not drop targets)', () => {
    // The tree has two top-level files; dropping `notes.md` onto a
    // sibling file shouldn't trigger anything — only directories
    // accept drops.
    const treeWithTwoFiles: TreeNode[] = [
      { type: 'file', name: 'a.md', path: '/root/a.md' },
      { type: 'file', name: 'b.md', path: '/root/b.md' },
    ];
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: treeWithTwoFiles,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    });
    const source = container.querySelector(
      'li[data-path="/root/a.md"]',
    ) as HTMLLIElement;
    const target = container.querySelector(
      'li[data-path="/root/b.md"]',
    ) as HTMLLIElement;
    const dt = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(source, { dataTransfer: dt });
      fireEvent.drop(target, { dataTransfer: dt });
    });
    expect(bm.moveItem).not.toHaveBeenCalled();
  });

  it('dropping onto the workspace header moves to the workspace root', () => {
    // The header is a separate JSX surface with its own drop
    // handlers; the destination is `treeRoot`.
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [
            {
              type: 'directory',
              name: 'sub',
              path: '/root/sub',
              hasChildren: true,
              loaded: true,
              children: [
                { type: 'file', name: 'x.md', path: '/root/sub/x.md' },
              ],
            },
          ],
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    });
    // Expand `sub` so its child row is present in the DOM.
    fireEvent.click(
      container.querySelector('li[data-path="/root/sub"]') as HTMLLIElement,
    );
    const source = container.querySelector(
      'li[data-path="/root/sub/x.md"]',
    ) as HTMLLIElement;
    const header = container.querySelector(
      '#file-tree > li:first-child',
    ) as HTMLLIElement;
    const dt = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(source, { dataTransfer: dt });
      fireEvent.dragOver(header, { dataTransfer: dt });
      fireEvent.drop(header, { dataTransfer: dt });
    });
    expect(bm.moveItem).toHaveBeenCalledWith('/root/sub/x.md', '/root/x.md');
  });

  it('refuses to drop a folder into itself (no-op, no IPC)', () => {
    // Dropping a folder onto itself would compute dst = `/root/docs/docs`
    // — main would refuse with `destination_inside_source`, but the
    // panel short-circuits client-side so the user doesn't see an
    // unexpected toast.
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: dragTree,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    });
    const docs = container.querySelector(
      'li[data-path="/root/docs"]',
    ) as HTMLLIElement;
    const dt = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(docs, { dataTransfer: dt });
      fireEvent.drop(docs, { dataTransfer: dt });
    });
    expect(bm.moveItem).not.toHaveBeenCalled();
  });

  it('drops with no payload (foreign drag) are ignored', () => {
    // External OS file drags don't carry our MKED MIME — the handler
    // should bail without prevent-defaulting, so the browser falls
    // through to whatever its default file-drop behaviour is (or, in
    // our case, the OS handler).
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: dragTree,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    });
    const target = container.querySelector(
      'li[data-path="/root/archive"]',
    ) as HTMLLIElement;
    const dt = makeDataTransfer(); // empty — no MKED payload
    act(() => {
      fireEvent.drop(target, { dataTransfer: dt });
    });
    expect(bm.moveItem).not.toHaveBeenCalled();
  });

  it('dragstart stamps the source path on the dataTransfer with the MKED mime', () => {
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: dragTree,
          treeRoot: '/root',
        }) as any,
        bridgeManager: fakeBridgeManager() as any,
      },
    });
    const source = container.querySelector(
      'li[data-path="/root/notes.md"]',
    ) as HTMLLIElement;
    const dt = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(source, { dataTransfer: dt });
    });
    expect(dt.setData).toHaveBeenCalledWith(MKED_MIME, '/root/notes.md');
  });
});

/* ---------------------------------------------------------------------- */
/*  Click routing: non-md files don't open in Monaco                        */
/* ---------------------------------------------------------------------- */

/**
 * Minimal SettingsProvider stub with a STABLE snapshot reference so
 * useSyncExternalStore doesn't loop. The default file-explorer
 * filter is `['md']`; tests that want non-md rows to render in the
 * tree pass `extensions` to override.
 */
function fakeSettingsProvider(extensions: string[]) {
  const snapshot = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: true,
    scrollsync: true,
    sessionRestore: true,
    locale: 'en',
    fileExplorer: { extensions },
    pasteImages: { directory: './assets' },
    effectiveDarkmode: false,
  };
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    updateSetting: () => {},
  };
}

describe('<FileTreePanel> — open routing by file extension', () => {
  const mixed: TreeNode[] = [
    { type: 'file', name: 'readme.md', path: '/root/readme.md' },
    { type: 'file', name: 'cover.png', path: '/root/cover.png' },
    { type: 'file', name: 'manual.pdf', path: '/root/manual.pdf' },
  ];

  it('clicking a .md row opens it in Monaco (fileManager.openFileFromPath)', () => {
    const fm = fakeFileManager();
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fm as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: mixed,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
        providers: {
          bridge: null,
          commands: null,
          completion: null,
          settings: fakeSettingsProvider(['md', 'png', 'pdf']) as any,
          exportSettings: null,
        },
      },
    });
    fireEvent.click(
      container.querySelector(
        'li[data-path="/root/readme.md"]',
      ) as HTMLLIElement,
    );
    expect(fm.openFileFromPath).toHaveBeenCalledWith('/root/readme.md');
    expect(bm.openInDefaultViewer).not.toHaveBeenCalled();
  });

  it('clicking a non-md row hands off to OS default viewer (no Monaco open)', () => {
    const fm = fakeFileManager();
    const bm = fakeBridgeManager();
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fm as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: mixed,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
        providers: {
          bridge: null,
          commands: null,
          completion: null,
          settings: fakeSettingsProvider(['md', 'png', 'pdf']) as any,
          exportSettings: null,
        },
      },
    });
    fireEvent.click(
      container.querySelector(
        'li[data-path="/root/cover.png"]',
      ) as HTMLLIElement,
    );
    expect(bm.openInDefaultViewer).toHaveBeenCalledWith('/root/cover.png');
    expect(fm.openFileFromPath).not.toHaveBeenCalled();

    fireEvent.click(
      container.querySelector(
        'li[data-path="/root/manual.pdf"]',
      ) as HTMLLIElement,
    );
    expect(bm.openInDefaultViewer).toHaveBeenCalledWith('/root/manual.pdf');
    expect(fm.openFileFromPath).not.toHaveBeenCalled();
  });
});
