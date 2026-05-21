/**
 * `<EditorPaneDiffOverlay>` renders an InlineDiffPreview filling the
 * editor pane when the active tab is a popped-out diff. Returns null
 * otherwise so Monaco renders unobstructed.
 */

import * as React from 'react';
import { screen } from '@testing-library/react';

import { EditorPaneDiffOverlay } from '../../src/browser/react/components/EditorPaneDiffOverlay';
import { renderWithProviders, fakeFileManager } from '../utils/render';

// Stub the inner Monaco-mounted component — we test InlineDiffPreview
// itself in its own spec. Here we just verify the overlay's routing.
jest.mock(
  '../../src/browser/react/components/assistant/InlineDiffPreview',
  () => ({
    InlineDiffPreview: (props: {
      original: string;
      modified: string;
      fill?: boolean;
    }) => (
      <div
        data-testid="diff-preview-stub"
        data-original={props.original}
        data-modified={props.modified}
        data-fill={String(props.fill ?? false)}
      />
    ),
  }),
);

function fileManagerWithDiffTab(opts: {
  id: string;
  original: string;
  modified: string;
  language?: string;
  isActive?: boolean;
}) {
  const fm = fakeFileManager({
    tabs: [{ path: opts.id, name: 'Δ x' }],
    activeFile: opts.isActive === false ? null : opts.id,
  });
  // Mark the tab as a diff tab in the snapshot.
  const snapshot = fm.getSnapshot();
  fm._setSnapshot({
    tabs: snapshot.tabs.map((t) =>
      t.path === opts.id ? { ...t, kind: 'diff' as const } : t,
    ),
    activeFile: snapshot.activeFile,
  });
  // Augment the stub with `getDiffTab` so the overlay can read the
  // payload.
  (fm as unknown as { getDiffTab: (id: string) => unknown }).getDiffTab = (
    id: string,
  ) =>
    id === opts.id
      ? {
          original: opts.original,
          modified: opts.modified,
          language: opts.language ?? 'markdown',
        }
      : undefined;
  return fm;
}

describe('<EditorPaneDiffOverlay>', () => {
  it('renders the diff preview when the active tab is a diff tab', () => {
    const fm = fileManagerWithDiffTab({
      id: 'diff://tc-1',
      original: 'OLD CONTENT',
      modified: 'NEW CONTENT',
    });
    renderWithProviders(<EditorPaneDiffOverlay />, {
      managers: { fileManager: fm as never },
    });
    const stub = screen.getByTestId('diff-preview-stub');
    expect(stub.dataset.original).toBe('OLD CONTENT');
    expect(stub.dataset.modified).toBe('NEW CONTENT');
    // Fill mode is on so the diff stretches the editor pane.
    expect(stub.dataset.fill).toBe('true');
  });

  it('returns null when no tab is active', () => {
    const fm = fakeFileManager({ tabs: [], activeFile: null });
    renderWithProviders(<EditorPaneDiffOverlay />, {
      managers: { fileManager: fm as never },
    });
    expect(screen.queryByTestId('diff-preview-stub')).toBeNull();
    expect(screen.queryByTestId('editor-pane-diff-overlay')).toBeNull();
  });

  it('returns null when the active tab is a regular file (kind: undefined / "file")', () => {
    const fm = fakeFileManager({
      tabs: [{ path: '/abs/foo.md', name: 'foo.md' }],
      activeFile: '/abs/foo.md',
    });
    renderWithProviders(<EditorPaneDiffOverlay />, {
      managers: { fileManager: fm as never },
    });
    expect(screen.queryByTestId('diff-preview-stub')).toBeNull();
  });

  it('returns null when the diff tab is in the strip but NOT active', () => {
    const fm = fakeFileManager({
      tabs: [
        { path: '/abs/foo.md', name: 'foo.md' },
        { path: 'diff://tc-1', name: 'Δ foo.md' },
      ],
      activeFile: '/abs/foo.md',
    });
    fm._setSnapshot({
      tabs: fm
        .getSnapshot()
        .tabs.map((t) =>
          t.path === 'diff://tc-1' ? { ...t, kind: 'diff' as const } : t,
        ),
      activeFile: '/abs/foo.md',
    });
    (fm as unknown as { getDiffTab: (id: string) => unknown }).getDiffTab =
      () => ({
        original: 'o',
        modified: 'm',
      });
    renderWithProviders(<EditorPaneDiffOverlay />, {
      managers: { fileManager: fm as never },
    });
    expect(screen.queryByTestId('diff-preview-stub')).toBeNull();
  });
});
