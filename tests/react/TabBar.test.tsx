import * as React from 'react';
import { act, screen, fireEvent } from '@testing-library/react';

import { TabBar } from '../../src/browser/react/components/TabBar';
import { renderWithProviders, fakeFileManager } from '../utils/render';

// i18next is not initialised in the test env; return the key as the
// resolved string so the menu items have stable accessible names.
jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
}));

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

  it('right-click on a tab → context menu fires closeTab with the right-clicked path', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md', dirty: false },
        { path: '/b.md', name: 'b.md', dirty: false },
      ],
      activeFile: '/a.md',
    });
    const { container } = renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });
    // The panel's `onContextMenu` on `<ul>` reads `event.target.closest('li[data-path]')`,
    // so we dispatch contextMenu directly on the row and let it
    // bubble — same flow a real right-click follows.
    const bTab = container.querySelector(
      'li[data-path="/b.md"]',
    ) as HTMLLIElement;
    // Synthesise the contextmenu event with the right-clicked tab as
    // the target so the panel's `handleContextMenu` can read the
    // closest `<li[data-path]>` ancestor.
    act(() => {
      fireEvent.contextMenu(bTab);
    });
    // The menu's items now reflect `contextPath === '/b.md'`. The
    // ContextMenuTrigger doesn't actually open Radix's portal in
    // jsdom from a synthetic event, so we drive the close directly
    // through the menu items the panel rendered into the DOM (Radix
    // Portal renders into document.body in tests).
    const closeItem = screen.getByTestId('tab-context-close');
    fireEvent.click(closeItem);
    expect(fileManager.closeTab).toHaveBeenCalledWith('/b.md');
    expect(fileManager.closeOtherTabs).not.toHaveBeenCalled();
    expect(fileManager.closeAllTabs).not.toHaveBeenCalled();
  });

  it('right-click → "Close Others" fires closeOtherTabs with the right-clicked path', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md', dirty: false },
        { path: '/b.md', name: 'b.md', dirty: false },
        { path: '/c.md', name: 'c.md', dirty: false },
      ],
      activeFile: '/a.md',
    });
    const { container } = renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });
    // The panel's `onContextMenu` on `<ul>` reads `event.target.closest('li[data-path]')`,
    // so we dispatch contextMenu directly on the row and let it
    // bubble — same flow a real right-click follows.
    const bTab = container.querySelector(
      'li[data-path="/b.md"]',
    ) as HTMLLIElement;
    act(() => {
      fireEvent.contextMenu(bTab);
    });
    fireEvent.click(screen.getByTestId('tab-context-close-others'));
    expect(fileManager.closeOtherTabs).toHaveBeenCalledWith('/b.md');
    expect(fileManager.closeTab).not.toHaveBeenCalled();
  });

  it('right-click → "Close All" fires closeAllTabs regardless of which tab was right-clicked', () => {
    const fileManager = fakeFileManager({
      tabs: [
        { path: '/a.md', name: 'a.md', dirty: false },
        { path: '/b.md', name: 'b.md', dirty: false },
      ],
      activeFile: '/a.md',
    });
    const { container } = renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });
    // The panel's `onContextMenu` on `<ul>` reads `event.target.closest('li[data-path]')`,
    // so we dispatch contextMenu directly on the row and let it
    // bubble — same flow a real right-click follows.
    const aTab = container.querySelector(
      'li[data-path="/a.md"]',
    ) as HTMLLIElement;
    act(() => {
      fireEvent.contextMenu(aTab);
    });
    fireEvent.click(screen.getByTestId('tab-context-close-all'));
    expect(fileManager.closeAllTabs).toHaveBeenCalledTimes(1);
  });

  it('"Close Others" is disabled when there is only one tab open', () => {
    const fileManager = fakeFileManager({
      tabs: [{ path: '/only.md', name: 'only.md', dirty: false }],
      activeFile: '/only.md',
    });
    const { container } = renderWithProviders(<TabBar />, {
      managers: { fileManager: fileManager as any },
    });
    // The panel's `onContextMenu` on `<ul>` reads `event.target.closest('li[data-path]')`,
    // so we dispatch contextMenu directly on the row and let it
    // bubble — same flow a real right-click follows.
    const onlyTab = container.querySelector(
      'li[data-path="/only.md"]',
    ) as HTMLLIElement;
    act(() => {
      fireEvent.contextMenu(onlyTab);
    });
    const closeOthers = screen.getByTestId(
      'tab-context-close-others',
    ) as HTMLElement;
    // Radix sets `data-disabled` (also makes pointer-events: none)
    // when the `disabled` prop is true.
    expect(closeOthers.getAttribute('data-disabled')).not.toBeNull();
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
