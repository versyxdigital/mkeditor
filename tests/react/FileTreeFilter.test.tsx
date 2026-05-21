import * as React from 'react';
import { act, fireEvent } from '@testing-library/react';

import {
  FileTreePanel,
  filterTree,
} from '../../src/browser/react/components/FileTreePanel';
import type { TreeNode } from '../../src/browser/core/FileTreeManager';
import {
  renderWithProviders,
  fakeFileManager,
  fakeFileTreeManager,
} from '../utils/render';

/* ---------------------------------------------------------------------- */
/*  Pure-function tests — filterTree                                       */
/* ---------------------------------------------------------------------- */

describe('filterTree (pure)', () => {
  const sample: TreeNode[] = [
    {
      type: 'directory',
      name: 'docs',
      path: '/root/docs',
      hasChildren: true,
      loaded: true,
      children: [
        { type: 'file', name: 'readme.md', path: '/root/docs/readme.md' },
        { type: 'file', name: 'logo.png', path: '/root/docs/logo.png' },
      ],
    },
    { type: 'file', name: 'notes.md', path: '/root/notes.md' },
    { type: 'file', name: 'photo.jpg', path: '/root/photo.jpg' },
  ];

  it('keeps only files whose extension is in the active set (md-only default)', () => {
    const { filteredNodes } = filterTree(sample, new Set(['md']), '');
    // photo.jpg drops; docs/logo.png drops; docs survives because it
    // still contains readme.md.
    const flat = collectFiles(filteredNodes);
    expect(flat.sort()).toEqual(['notes.md', 'readme.md']);
  });

  it('shows additional extensions when they are in the active set', () => {
    const { filteredNodes } = filterTree(
      sample,
      new Set(['md', 'png', 'jpg']),
      '',
    );
    const flat = collectFiles(filteredNodes);
    expect(flat.sort()).toEqual([
      'logo.png',
      'notes.md',
      'photo.jpg',
      'readme.md',
    ]);
  });

  it('drops a directory when no descendant survives the filter', () => {
    const tree: TreeNode[] = [
      {
        type: 'directory',
        name: 'images',
        path: '/root/images',
        hasChildren: true,
        loaded: true,
        children: [
          { type: 'file', name: 'a.png', path: '/root/images/a.png' },
          { type: 'file', name: 'b.png', path: '/root/images/b.png' },
        ],
      },
      { type: 'file', name: 'note.md', path: '/root/note.md' },
    ];
    const { filteredNodes } = filterTree(tree, new Set(['md']), '');
    expect(filteredNodes.map((n) => n.name)).toEqual(['note.md']);
  });

  it('keeps a lazy-loaded directory even when no children match yet (its contents could match once loaded)', () => {
    const tree: TreeNode[] = [
      {
        type: 'directory',
        name: 'unloaded',
        path: '/root/unloaded',
        hasChildren: true,
        loaded: false,
      },
      { type: 'file', name: 'note.md', path: '/root/note.md' },
    ];
    const { filteredNodes } = filterTree(tree, new Set(['md']), '');
    expect(filteredNodes.map((n) => n.name)).toEqual(['unloaded', 'note.md']);
  });

  it('search narrows by case-insensitive substring on file name', () => {
    const { filteredNodes } = filterTree(
      sample,
      new Set(['md', 'png', 'jpg']),
      'NOTE',
    );
    const flat = collectFiles(filteredNodes);
    expect(flat).toEqual(['notes.md']);
  });

  it('populates searchExpansion with every surviving ancestor when searching', () => {
    const tree: TreeNode[] = [
      {
        type: 'directory',
        name: 'a',
        path: '/a',
        hasChildren: true,
        loaded: true,
        children: [
          {
            type: 'directory',
            name: 'b',
            path: '/a/b',
            hasChildren: true,
            loaded: true,
            children: [{ type: 'file', name: 'deep.md', path: '/a/b/deep.md' }],
          },
        ],
      },
    ];
    const { searchExpansion } = filterTree(tree, new Set(['md']), 'deep');
    expect(searchExpansion.has('/a')).toBe(true);
    expect(searchExpansion.has('/a/b')).toBe(true);
  });

  it('leaves searchExpansion empty when the search box is empty (preserves user-driven expansion)', () => {
    const { searchExpansion } = filterTree(sample, new Set(['md']), '');
    expect(searchExpansion.size).toBe(0);
  });
});

function collectFiles(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.name);
    else if (n.children) out.push(...collectFiles(n.children));
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/*  Component tests — FileTreePanel with the filter bar                     */
/* ---------------------------------------------------------------------- */

const mixedTree: TreeNode[] = [
  { type: 'file', name: 'notes.md', path: '/root/notes.md' },
  { type: 'file', name: 'logo.png', path: '/root/logo.png' },
  { type: 'file', name: 'guide.html', path: '/root/guide.html' },
];

describe('<FileTreePanel> — filter bar integration', () => {
  it('renders the filter bar when a workspace is open', () => {
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: mixedTree,
          treeRoot: '/root',
        }) as any,
      },
    });
    expect(
      container.querySelector('[data-testid="file-tree-filter-bar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="file-tree-search"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="file-tree-filter-button"]'),
    ).not.toBeNull();
  });

  it('does not render the filter bar in the web empty-state (no workspace)', () => {
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        mode: 'web',
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [],
          treeRoot: null,
        }) as any,
      },
    });
    expect(
      container.querySelector('[data-testid="file-tree-filter-bar"]'),
    ).toBeNull();
  });

  it('hides non-md files by default (only `md` is in the persisted default)', () => {
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: mixedTree,
          treeRoot: '/root',
        }) as any,
      },
    });
    expect(
      container.querySelector('li[data-path="/root/notes.md"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('li[data-path="/root/logo.png"]'),
    ).toBeNull();
    expect(
      container.querySelector('li[data-path="/root/guide.html"]'),
    ).toBeNull();
  });

  it('search box hides files whose name does not match (case-insensitive substring)', async () => {
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: [
            { type: 'file', name: 'notes.md', path: '/root/notes.md' },
            { type: 'file', name: 'spring.md', path: '/root/spring.md' },
          ],
          treeRoot: '/root',
        }) as any,
      },
    });
    expect(
      container.querySelector('li[data-path="/root/notes.md"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('li[data-path="/root/spring.md"]'),
    ).not.toBeNull();

    const input = container.querySelector(
      '[data-testid="file-tree-search"]',
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'SPRING' } });
    });

    expect(
      container.querySelector('li[data-path="/root/notes.md"]'),
    ).toBeNull();
    expect(
      container.querySelector('li[data-path="/root/spring.md"]'),
    ).not.toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/*  Component tests — muted styling on non-md files                         */
/* ---------------------------------------------------------------------- */

describe('<FileTreePanel> — muted non-markdown rows', () => {
  it('applies the muted class to non-md file rows when they are visible', () => {
    // Inject a fake SettingsProvider that surfaces multiple extensions
    // so non-md files actually render — the default-state tests above
    // already cover the .md-only case.
    const fakeSettingsProvider = makeFakeSettingsProvider({
      extensions: ['md', 'png'],
    });
    const { container } = renderWithProviders(<FileTreePanel />, {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: mixedTree,
          treeRoot: '/root',
        }) as any,
        providers: {
          bridge: null,
          commands: null,
          completion: null,
          settings: fakeSettingsProvider as any,
          exportSettings: null,
        },
      },
    });
    const mdRow = container.querySelector(
      'li[data-path="/root/notes.md"]',
    ) as HTMLLIElement;
    const pngRow = container.querySelector(
      'li[data-path="/root/logo.png"]',
    ) as HTMLLIElement;
    expect(mdRow).not.toBeNull();
    expect(pngRow).not.toBeNull();
    expect(mdRow.dataset.muted).toBeUndefined();
    expect(pngRow.dataset.muted).toBe('true');
  });
});

/**
 * Minimal fake SettingsProvider — just the surface
 * `SettingsContextProvider` consumes via `useSyncExternalStore`.
 */
function makeFakeSettingsProvider(opts: { extensions: string[] }) {
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
    fileExplorer: { extensions: opts.extensions },
    effectiveDarkmode: false,
  };
  return {
    subscribe: jest.fn(() => () => {}),
    getSnapshot: jest.fn(() => snapshot),
    updateSetting: jest.fn(),
  };
}
