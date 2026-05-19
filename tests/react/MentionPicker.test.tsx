/**
 * MentionPicker (AI Assistant P6) unit tests.
 *
 * Stateless React component driven by a query + a stubbed
 * FileTreeManager surface. Asserts: filtering behaviour, ranking
 * (basename > substring), arrow + enter navigation, and the lazy-
 * load handoff for directories that aren't populated yet.
 */

import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { MentionPicker } from '../../src/browser/react/components/assistant/MentionPicker';
import type {
  FileTreeManager,
  TreeNode,
} from '../../src/browser/core/FileTreeManager';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
}));

function makeFileTree(opts: {
  treeRoot?: string | null;
  nodes?: TreeNode[];
  lazy?: (path: string) => TreeNode[] | undefined;
}): FileTreeManager & {
  _emit: () => void;
  _replace: (nodes: TreeNode[]) => void;
} {
  let nodes = opts.nodes ?? [];
  const listeners = new Set<() => void>();
  const stub = {
    getSnapshot: jest.fn(() => ({
      treeRoot: opts.treeRoot ?? null,
      nodes,
    })),
    on: jest.fn((event: string, listener: () => void) => {
      if (event !== 'change') throw new Error(`unsupported event ${event}`);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    requestDirectoryContents: jest.fn((path: string) => {
      const newChildren = opts.lazy?.(path);
      if (!newChildren) return;
      const walk = (nodeList: TreeNode[]): boolean => {
        for (const n of nodeList) {
          if (n.path === path && n.type === 'directory') {
            n.children = newChildren;
            n.loaded = true;
            return true;
          }
          if (n.type === 'directory' && n.children && walk(n.children))
            return true;
        }
        return false;
      };
      walk(nodes);
      listeners.forEach((l) => l());
    }),
    treeRoot: opts.treeRoot ?? null,
    _emit: () => listeners.forEach((l) => l()),
    _replace: (n: TreeNode[]) => {
      nodes = n;
      listeners.forEach((l) => l());
    },
  } as unknown as FileTreeManager & {
    _emit: () => void;
    _replace: (nodes: TreeNode[]) => void;
  };
  return stub;
}

describe('<MentionPicker>', () => {
  it('renders nothing when closed', () => {
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [{ type: 'file', name: 'a.md', path: '/w/a.md' }],
    });
    render(
      <MentionPicker
        query=""
        open={false}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    expect(screen.queryByTestId('mention-picker')).toBeNull();
  });

  it('shows all loaded files when the query is empty', () => {
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [
        { type: 'file', name: 'a.md', path: '/w/a.md' },
        { type: 'file', name: 'b.md', path: '/w/b.md' },
      ],
    });
    render(
      <MentionPicker
        query=""
        open={true}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    expect(screen.getByTestId('mention-option-/w/a.md')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-/w/b.md')).toBeInTheDocument();
  });

  it('ranks basename matches above path-substring matches', () => {
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [
        { type: 'file', name: 'notes.md', path: '/w/notes/notes.md' },
        // Path-only match for "no": parent dir contains "no".
        { type: 'file', name: 'other.md', path: '/w/no-dir/other.md' },
      ],
    });
    render(
      <MentionPicker
        query="no"
        open={true}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    const picker = screen.getByTestId('mention-picker');
    const options = Array.from(
      picker.querySelectorAll('[data-testid^="mention-option-"]'),
    );
    // notes.md (basename "no" prefix) should appear before other.md (path-only).
    expect(options[0].getAttribute('data-testid')).toBe(
      'mention-option-/w/notes/notes.md',
    );
  });

  it('fires onPick(path) when an option is clicked', () => {
    const onPick = jest.fn();
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [{ type: 'file', name: 'a.md', path: '/w/a.md' }],
    });
    render(
      <MentionPicker
        query=""
        open={true}
        onPick={onPick}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    fireEvent.click(screen.getByTestId('mention-option-/w/a.md'));
    expect(onPick).toHaveBeenCalledWith('/w/a.md');
  });

  it('Enter on the highlighted option fires onPick; Escape fires onClose', () => {
    const onPick = jest.fn();
    const onClose = jest.fn();
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [
        { type: 'file', name: 'first.md', path: '/w/first.md' },
        { type: 'file', name: 'second.md', path: '/w/second.md' },
      ],
    });
    render(
      <MentionPicker
        query=""
        open={true}
        onPick={onPick}
        onClose={onClose}
        fileTreeManager={ftm}
      />,
    );
    // Default highlight is index 0 → first.md.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('/w/first.md');
    onPick.mockClear();
    // ArrowDown bumps to second.md.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('/w/second.md');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('lazy-loads ONLY the directory hinted by the query (path/filename) — never bulk-loads on open', async () => {
    // Behaviour change: previously the picker eagerly requested EVERY
    // unloaded directory under the workspace root the moment it
    // opened. That fired many `to:file:openpath` round-trips at once
    // and visibly disrupted the file explorer (each response is a
    // `from:folder:opened` that the tree manager treats as a lazy-
    // load — but the user perceived the cascade as "the workspace
    // changed"). Now lazy-load fires only when the query contains a
    // `dir/file` prefix that names an unloaded directory.
    const lazyChildren: Record<string, TreeNode[]> = {
      '/w/native': [
        {
          type: 'file',
          name: 'quickstart.md',
          path: '/w/native/quickstart.md',
        },
      ],
    };
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [
        {
          type: 'directory',
          name: 'native',
          path: '/w/native',
          hasChildren: true,
          loaded: false,
        },
        {
          type: 'directory',
          name: 'other',
          path: '/w/other',
          hasChildren: true,
          loaded: false,
        },
      ],
      lazy: (path) => lazyChildren[path],
    });
    // Step 1: open with an empty query — picker should NOT request
    // either subdirectory. Top-level (already loaded) wins.
    const { rerender } = render(
      <MentionPicker
        query=""
        open={true}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    expect(ftm.requestDirectoryContents).not.toHaveBeenCalled();
    // Step 2: user types `native/qu` — picker requests `/w/native`
    // (and only that), and the picked deep file appears once it lands.
    rerender(
      <MentionPicker
        query="native/qu"
        open={true}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    await waitFor(() =>
      expect(ftm.requestDirectoryContents).toHaveBeenCalledWith('/w/native'),
    );
    expect(ftm.requestDirectoryContents).not.toHaveBeenCalledWith('/w/other');
    await waitFor(() =>
      expect(
        screen.getByTestId('mention-option-/w/native/quickstart.md'),
      ).toBeInTheDocument(),
    );
  });

  it('renders the empty-state copy when no files match the query', () => {
    const ftm = makeFileTree({
      treeRoot: '/w',
      nodes: [{ type: 'file', name: 'a.md', path: '/w/a.md' }],
    });
    render(
      <MentionPicker
        query="nope"
        open={true}
        onPick={jest.fn()}
        onClose={jest.fn()}
        fileTreeManager={ftm}
      />,
    );
    expect(
      screen.getByText('assistant-chat:mention_picker_empty'),
    ).toBeInTheDocument();
  });
});
