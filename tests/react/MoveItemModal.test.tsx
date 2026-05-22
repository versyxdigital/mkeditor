import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react';

import { MoveItemModal } from '../../src/browser/react/components/modals/MoveItemModal';
import type { TreeNode } from '../../src/browser/core/FileTreeManager';
import { useModals } from '../../src/browser/react/contexts/ModalsContext';
import {
  renderWithProviders,
  fakeFileManager,
  fakeFileTreeManager,
} from '../utils/render';

// i18next is not initialised in the test env; return the key as the
// resolved string so the dialog has a stable accessible name.
jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
}));

jest.mock('../../src/browser/notify', () => ({
  sonnerToast: jest.fn(),
}));

function fakeBridgeManager(
  result:
    | { ok: true; oldPath: string; newPath: string }
    | { ok: false; error: string } = {
    ok: true,
    oldPath: '',
    newPath: '',
  },
) {
  return {
    bridge: { send: jest.fn(), receive: jest.fn() },
    moveItem: jest.fn(async (src: string, dst: string) => {
      if (result.ok) return { ok: true as const, oldPath: src, newPath: dst };
      return result;
    }),
  };
}

/** Pop the modal open with a source path. Stand-in for the menu-action callback. */
const OpenMove: React.FC<{ sourcePath: string }> = ({ sourcePath }) => {
  const { openModal } = useModals();
  React.useEffect(() => {
    openModal('moveItem', { sourcePath });
  }, [openModal, sourcePath]);
  return null;
};

const tree: TreeNode[] = [
  {
    type: 'directory',
    name: 'docs',
    path: '/root/docs',
    hasChildren: true,
    loaded: true,
    children: [
      {
        type: 'directory',
        name: 'inner',
        path: '/root/docs/inner',
        hasChildren: false,
        loaded: true,
        children: [],
      },
    ],
  },
  {
    type: 'directory',
    name: 'archive',
    path: '/root/archive',
    hasChildren: false,
    loaded: true,
    children: [],
  },
  { type: 'file', name: 'notes.md', path: '/root/notes.md' },
];

function renderModal(opts: {
  sourcePath: string;
  bm?: ReturnType<typeof fakeBridgeManager>;
}) {
  const bm = opts.bm ?? fakeBridgeManager();
  const result = renderWithProviders(
    <>
      <OpenMove sourcePath={opts.sourcePath} />
      <MoveItemModal />
    </>,
    {
      managers: {
        fileManager: fakeFileManager() as any,
        fileTreeManager: fakeFileTreeManager({
          nodes: tree,
          treeRoot: '/root',
        }) as any,
        bridgeManager: bm as any,
      },
    },
  );
  return { bm, ...result };
}

describe('<MoveItemModal>', () => {
  it('renders the source path and the workspace root + immediate folders', () => {
    renderModal({ sourcePath: '/root/notes.md' });
    expect(screen.getByTestId('move-item-source-path').textContent).toBe(
      '/root/notes.md',
    );
    expect(screen.getByTestId('move-folder-/root')).toBeTruthy();
    expect(screen.getByTestId('move-folder-/root/docs')).toBeTruthy();
    expect(screen.getByTestId('move-folder-/root/archive')).toBeTruthy();
    // Nested folders only appear after expand — `inner` lives inside
    // `docs` and is collapsed by default.
    expect(screen.queryByTestId('move-folder-/root/docs/inner')).toBeNull();
  });

  it('confirms with the workspace root by default → fires moveItem(src, treeRoot/<basename>)', async () => {
    const { bm } = renderModal({ sourcePath: '/root/docs/x.md' });
    // Default selection is the workspace root, which is /root. The
    // confirm should land at /root/x.md.
    fireEvent.click(screen.getByTestId('move-item-confirm'));
    // Drain the async moveItem call.
    await Promise.resolve();
    expect(bm.moveItem).toHaveBeenCalledWith('/root/docs/x.md', '/root/x.md');
  });

  it('clicking a folder updates the selection', async () => {
    const { bm } = renderModal({ sourcePath: '/root/notes.md' });
    fireEvent.click(screen.getByText('archive'));
    fireEvent.click(screen.getByTestId('move-item-confirm'));
    await Promise.resolve();
    expect(bm.moveItem).toHaveBeenCalledWith(
      '/root/notes.md',
      '/root/archive/notes.md',
    );
  });

  it('disables confirm when the selection would move a folder into itself', () => {
    renderModal({ sourcePath: '/root/docs' });
    // Default selection is workspace root → dst would be /root/docs
    // (same as source). The confirm button is disabled.
    const confirm = screen.getByTestId(
      'move-item-confirm',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('disables confirm when the destination would land inside the source folder', () => {
    renderModal({ sourcePath: '/root/docs' });
    // Expand docs and select its descendant `inner`.
    const docsRow = screen.getByText('docs');
    fireEvent.doubleClick(docsRow);
    fireEvent.click(screen.getByText('inner'));
    const confirm = screen.getByTestId(
      'move-item-confirm',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('cancel button closes the modal without calling moveItem', () => {
    const { bm } = renderModal({ sourcePath: '/root/notes.md' });
    fireEvent.click(screen.getByTestId('move-item-cancel'));
    expect(bm.moveItem).not.toHaveBeenCalled();
  });
});
