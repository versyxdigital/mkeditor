import * as React from 'react';
import { screen, fireEvent } from '@testing-library/react';

import { TabBar } from '../../src/browser/react/components/TabBar';
import { renderWithProviders, fakeFileManager } from '../utils/render';

describe('<TabBar>', () => {
  it('renders one <li> per tab with the active tab marked', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md' },
        { path: '/b.md', name: 'b.md' },
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

    // Active tab carries the `.active` class.
    const active = items.find((li) => li.classList.contains('active'));
    expect(active).toBeDefined();
    expect(active?.dataset.path).toBe('/b.md');
  });

  it('activates a tab when the file-link is clicked', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/a.md', name: 'a.md' }],
      activeFile: null,
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    fireEvent.click(screen.getByText('a.md'));
    expect(fileManager.activateFile).toHaveBeenCalledWith('/a.md');
  });

  it('closes a tab when the × button is clicked', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/a.md', name: 'a.md' }],
      activeFile: '/a.md',
    });

    renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });

    const closeButtons = document.querySelectorAll('button.tab-close');
    expect(closeButtons).toHaveLength(1);
    fireEvent.click(closeButtons[0]);
    expect(fileManager.closeTab).toHaveBeenCalledWith('/a.md');
    // The link's own click must not also fire activate() because the
    // close button stops propagation.
    expect(fileManager.activateFile).not.toHaveBeenCalled();
  });
});
