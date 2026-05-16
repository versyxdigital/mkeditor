import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useManagers } from '../contexts/ManagersContext';

/**
 * Tab strip. Renders one `<li>` per FileManager tab from FilesContext.
 * Click activates; the close button calls `fileManager.closeTab(path)`
 * which retains its SweetAlert unsaved-change prompt until Phase 8.
 *
 * HTML5 drag-and-drop reorders the *visual* order; on dragend we read
 * the resulting DOM order and call `fileManager.reorderTabs(newOrder)`,
 * which re-emits and triggers a React re-render against the new order.
 */
export const TabBar: React.FC = () => {
  const { fileManager } = useManagers();
  const { tabs, activeFile } = useFiles();
  const listRef = React.useRef<HTMLUListElement>(null);

  const handleDragStart = React.useCallback(
    (event: React.DragEvent<HTMLLIElement>) => {
      (event.currentTarget as HTMLLIElement).classList.add('dragging');
      // Setting effectAllowed/setData ensures Firefox emits drag events.
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
    },
    [],
  );

  const handleDragEnd = React.useCallback(
    (event: React.DragEvent<HTMLLIElement>) => {
      (event.currentTarget as HTMLLIElement).classList.remove('dragging');
      if (!listRef.current || !fileManager) return;
      const newOrder = Array.from(listRef.current.querySelectorAll('li'))
        .map((li) => (li as HTMLLIElement).dataset.path)
        .filter((path): path is string => !!path);
      fileManager.reorderTabs(newOrder);
    },
    [fileManager],
  );

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLUListElement>) => {
      event.preventDefault();
      const list = listRef.current;
      if (!list) return;
      const dragging = list.querySelector(
        'li.dragging',
      ) as HTMLLIElement | null;
      if (!dragging) return;
      const after = getDragAfterElement(list, event.clientX);
      if (after == null) list.appendChild(dragging);
      else list.insertBefore(dragging, after);
    },
    [],
  );

  return (
    <ul
      ref={listRef}
      id="editor-tabs"
      className="tab-bar"
      onDragOver={handleDragOver}
    >
      {tabs.map((tab) => (
        <li
          key={tab.path}
          data-path={tab.path}
          draggable
          className={tab.path === activeFile ? 'active' : undefined}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <a
            href="#"
            draggable={false}
            onClick={(event) => {
              event.preventDefault();
              fileManager?.activateFile(tab.path);
            }}
          >
            {tab.name}
          </a>
          <button
            type="button"
            className="tab-close"
            draggable={false}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void fileManager?.closeTab(tab.path);
            }}
            dangerouslySetInnerHTML={{ __html: '&times;' }}
          />
        </li>
      ))}
    </ul>
  );
};

function getDragAfterElement(container: HTMLElement, x: number) {
  const elements = Array.from(
    container.querySelectorAll('li:not(.dragging)'),
  ) as HTMLElement[];
  let closest: { offset: number; element: HTMLElement | null } = {
    offset: Number.NEGATIVE_INFINITY,
    element: null,
  };
  for (const child of elements) {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}
