import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useManagers } from '../contexts/ManagersContext';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';

/**
 * Tab strip. Renders one `<li>` per FileManager tab from FilesContext.
 *
 * Visual model (VSCode-inspired):
 *   - Inactive tabs sit on the muted strip bg, slightly recessed.
 *   - The active tab "lifts" to the editor's bg with a 2px primary
 *     accent stripe along the top edge. No font-weight change on
 *     activation (avoids text-width reflow that shifts neighbours).
 *   - The close-button slot shows a dirty dot when the tab has
 *     unsaved changes, swapping to ✕ on hover/focus (VSCode pattern).
 *
 * HTML5 drag-and-drop reorders the *visual* order; on dragend we read
 * the resulting DOM order and call `fileManager.reorderTabs(newOrder)`,
 * which re-emits and triggers a React re-render against the new order.
 */
export const TabBar: React.FC = () => {
  const { fileManager } = useManagers();
  const { tabs, activeFile } = useFiles();
  const { t } = useTranslation();
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

  const handleNewTab = React.useCallback(() => {
    fileManager?.createUntitledTab();
  }, [fileManager]);

  // The right-click target's path.
  const [contextPath, setContextPath] = React.useState<string | null>(null);
  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLUListElement>) => {
      const target = event.target as HTMLElement;
      const li = target.closest('li[data-path]') as HTMLLIElement | null;
      setContextPath(li?.dataset.path ?? null);
    },
    [],
  );

  const tabCount = tabs.length;
  const hasOthers = contextPath !== null && tabCount > 1;

  return (
    <div
      data-testid="editor-tabs-strip"
      className="flex items-stretch min-h-7 border-b border-border bg-muted/40 select-none"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ul
            ref={listRef}
            id="editor-tabs"
            className="flex items-stretch min-w-0 px-0 m-0 list-none text-[0.8125rem]"
            onDragOver={handleDragOver}
            onContextMenu={handleContextMenu}
          >
            {tabs.map((tab) => {
              const isActive = tab.path === activeFile;
              return (
                <li
                  key={tab.path}
                  data-path={tab.path}
                  data-active={isActive || undefined}
                  data-dirty={tab.dirty || undefined}
                  draggable
                  className={cn(
                    'group relative flex items-center cursor-grab',
                    'border-r border-border',
                    // Active tab "lifts" to the editor's bg; inactive sits
                    // on the muted strip and tints toward bg on hover.
                    isActive
                      ? 'bg-background text-foreground'
                      : 'bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    // The 2px primary accent stripe along the top of the
                    // active tab is the main "you are here" cue. A 2px
                    // transparent border on inactive tabs keeps heights
                    // aligned so the strip doesn't jump on activation.
                    'border-t-2',
                    isActive ? 'border-t-primary' : 'border-t-transparent',
                  )}
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
                    className={cn(
                      'block px-3 py-1 whitespace-nowrap no-underline cursor-pointer',
                      'text-current focus:outline-none text-xs',
                    )}
                    title={tab.path}
                  >
                    {tab.name}
                  </a>
                  <button
                    type="button"
                    className={cn(
                      'tab-close',
                      'mr-1.5 flex h-4 w-4 items-center justify-center rounded-sm',
                      'text-muted-foreground hover:bg-accent hover:text-foreground',
                      'focus:outline-none focus-visible:bg-accent',
                    )}
                    draggable={false}
                    aria-label={
                      tab.dirty
                        ? `Close ${tab.name} (unsaved changes)`
                        : `Close ${tab.name}`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void fileManager?.closeTab(tab.path);
                    }}
                  >
                    {tab.dirty ? (
                      <>
                        {/* Default: dirty dot. Hover/focus on the tab or
                      the button swaps it for the close ✕ so the
                      action stays reachable. */}
                        <DirtyDot className="group-hover:hidden group-focus-within:hidden" />
                        <CloseIcon className="hidden group-hover:block group-focus-within:block" />
                      </>
                    ) : (
                      <CloseIcon />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </ContextMenuTrigger>
        {contextPath !== null && (
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                if (contextPath) void fileManager?.closeTab(contextPath);
              }}
              data-testid="tab-context-close"
            >
              {t('menus-tabs:close_tab')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!hasOthers}
              onSelect={() => {
                if (contextPath) {
                  void fileManager?.closeOtherTabs(contextPath);
                }
              }}
              data-testid="tab-context-close-others"
            >
              {t('menus-tabs:close_others')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void fileManager?.closeAllTabs();
              }}
              data-testid="tab-context-close-all"
            >
              {t('menus-tabs:close_all')}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <button
        type="button"
        data-testid="new-tab-button"
        aria-label="New tab"
        title="New tab"
        onClick={handleNewTab}
        className={cn(
          'flex h-full items-center justify-center px-2',
          'border-t-2 border-t-transparent border-r border-border',
          'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          'focus:outline-none focus-visible:bg-accent',
          'cursor-pointer',
        )}
      >
        <PlusIcon />
      </button>
    </div>
  );
};

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    aria-hidden
    className={className}
  >
    <path d="M6 2 L6 10 M2 6 L10 6" />
  </svg>
);

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width={10}
    height={10}
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    aria-hidden
    className={className}
  >
    <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
  </svg>
);

const DirtyDot: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width={10}
    height={10}
    viewBox="0 0 10 10"
    fill="currentColor"
    aria-hidden
    className={className}
  >
    <circle cx={5} cy={5} r={3} />
  </svg>
);

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
