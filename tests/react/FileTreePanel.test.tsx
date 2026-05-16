import * as React from 'react';
import { fireEvent } from '@testing-library/react';

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
});
