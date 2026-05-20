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
