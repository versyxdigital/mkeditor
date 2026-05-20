import * as React from 'react';
import { screen, fireEvent } from '@testing-library/react';

import { TabBar } from '../../src/browser/react/components/TabBar';
import { renderWithProviders, fakeFileManager } from '../utils/render';

describe('<TabBar>', () => {
  it('renders one <li> per tab with the active tab marked via data-active', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md', dirty: false },
        { path: '/b.md', name: 'b.md', dirty: false },
      ],
      activeFile: '/b.md',
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    // Both names render.
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();

    // Active tab carries data-active.
    const active = items.find((li) => li.dataset.active === 'true');
    expect(active).toBeDefined();
    expect(active?.dataset.path).toBe('/b.md');
  });

  it('activates a tab when the file-link is clicked', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/a.md', name: 'a.md', dirty: false }],
      activeFile: null,
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    fireEvent.click(screen.getByText('a.md'));
    expect(fileManager.activateFile).toHaveBeenCalledWith('/a.md');
  });

  it('closes a tab when the close button is clicked', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/a.md', name: 'a.md', dirty: false }],
      activeFile: '/a.md',
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    const closeButton = screen.getByRole('button', { name: 'Close a.md' });
    fireEvent.click(closeButton);
    expect(fileManager.closeTab).toHaveBeenCalledWith('/a.md');
    // The link's own click must not also fire activate() because the
    // close button stops propagation.
    expect(fileManager.activateFile).not.toHaveBeenCalled();
  });

  it('clicking the + button calls createUntitledTab', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/a.md', name: 'a.md', dirty: false }],
      activeFile: '/a.md',
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(fileManager.createUntitledTab).toHaveBeenCalledTimes(1);
  });

  it('renders the + button even when there are no tabs', () => {
    const fileManager = fakeFileManager({ tabs: [], activeFile: null });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    expect(screen.getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('marks dirty tabs via data-dirty and the close-button aria-label', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md', dirty: true },
        { path: '/b.md', name: 'b.md', dirty: false },
      ],
      activeFile: '/a.md',
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    const items = screen.getAllByRole('listitem');
    const aTab = items.find((li) => li.dataset.path === '/a.md');
    const bTab = items.find((li) => li.dataset.path === '/b.md');
    expect(aTab?.dataset.dirty).toBe('true');
    expect(bTab?.dataset.dirty).toBeUndefined();

    // The aria-label switches to flag unsaved changes, which is what
    // assistive tech reads to the user before they activate close.
    expect(
      screen.getByRole('button', { name: /Close a\.md \(unsaved changes\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close b.md' }),
    ).toBeInTheDocument();
  });
});
