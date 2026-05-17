import * as React from 'react';

import type { TreeNode } from '../../core/FileTreeManager';
import type { WebFileBridge } from '../../core/WebFileBridge';
import {
  getContextMenuItems,
  type ContextMenuItem as MenuItem,
} from '../../core/mappings/explorerContextMenu';
import { useFiles } from '../contexts/FilesContext';
import { useFileTree } from '../contexts/FileTreeContext';
import { useManagers } from '../contexts/ManagersContext';
import { useModals } from '../contexts/ModalsContext';
import { useUIState } from '../contexts/UIStateContext';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from './ui/button';
import { Icon } from './Icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';

/**
 * Recursive React rendering of the file explorer tree.
 *
 * Structure:
 * - One Radix <ContextMenu> wraps the whole panel. The active "context
 *   node" is tracked in React state and updated synchronously by the
 *   onContextMenu handler from the closest `<li[data-path]>` ancestor of
 *   the event target.
 * - Each <NodeRow> is a plain `<li>` with onClick — no per-row Radix
 *   wrapping, which was causing event-handler loss during re-render
 *   storms (file open → FilesContext + FileTreeContext emits + auto-
 *   expand useEffect → Slot ref forwarding dropped clicks on `<li>`).
 * - Directories track expand state in a panel-level `expandedPaths` Set.
 *   First-expand of a `hasChildren && !loaded` directory fires the
 *   bridge via fileTreeManager.requestDirectoryContents; a ref guard
 *   keeps the IPC fire-exactly-once.
 */
export const FileTreePanel: React.FC = () => {
  const { mode, fileTreeManager, fileManager, bridgeManager } = useManagers();
  const { nodes, treeRoot } = useFileTree();
  const { activeFile } = useFiles();
  const { openModal } = useModals();
  const { sidebarOpen, setSidebarOpen, toggleSidebar } = useUIState();
  // `getContextMenuItems` calls `t(...)` and bakes the resolved strings
  // into the items array. We need the memo to invalidate when i18next
  // finishes loading (its first init resolves AFTER React mounts) and
  // whenever the user picks a new language.
  const { t, language } = useTranslation();

  // Web mode only: track whether a previously-opened workspace handle
  // exists in IndexedDB so we can offer a one-click "Restore previous
  // folder" button. Auto-restore on boot only succeeds when the
  // permission grant is still live; if the browser dropped permission
  // the user needs a fresh click to re-grant it.
  const [hasRestorable, setHasRestorable] = React.useState(false);
  React.useEffect(() => {
    if (mode !== 'web' || !bridgeManager) return;
    const webBridge = bridgeManager.bridge as WebFileBridge;
    if (typeof webBridge.hasRestorableWorkspace !== 'function') return;
    void webBridge.hasRestorableWorkspace().then((ok) => setHasRestorable(ok));
  }, [mode, bridgeManager, treeRoot]);

  // Open the sidebar automatically when a web workspace first lands,
  // since web mode starts with the sidebar collapsed and the user
  // would otherwise see no feedback after granting folder access.
  // Fires once per workspace-load via a ref guard so a user-initiated
  // collapse later in the session isn't fought.
  const sidebarPushedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (mode !== 'web' || !treeRoot) return;
    if (sidebarPushedRef.current === treeRoot) return;
    sidebarPushedRef.current = treeRoot;
    if (!sidebarOpen) setSidebarOpen(true);
  }, [mode, treeRoot, sidebarOpen, setSidebarOpen]);

  const handleOpenFolder = React.useCallback(() => {
    bridgeManager?.bridge.send('to:folder:open', true);
  }, [bridgeManager]);

  const handleRestoreWorkspace = React.useCallback(() => {
    if (!bridgeManager) return;
    const webBridge = bridgeManager.bridge as WebFileBridge;
    void webBridge.restoreWorkspace?.(true);
  }, [bridgeManager]);

  const handleDisconnectFolder = React.useCallback(() => {
    if (!bridgeManager || !fileTreeManager) return;
    const webBridge = bridgeManager.bridge as WebFileBridge;
    void webBridge.disconnectWorkspace?.();
    fileTreeManager.clearTree();
    // Reset the auto-open guard so a future folder open re-pops the
    // sidebar even if the user has manually collapsed it.
    sidebarPushedRef.current = null;
  }, [bridgeManager, fileTreeManager]);

  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [contextNode, setContextNode] = React.useState<TreeNode | null>(null);

  /**
   * Fire a bridge request for a directory's contents iff the *current*
   * TreeNode says it's a directory with `hasChildren && !loaded`. We
   * deliberately don't track in-flight paths separately: `buildFileTree`
   * overwrites `target.children` idempotently when the response arrives,
   * so a duplicate IPC on rapid clicks is wasteful but not corrupting.
   * The previous in-flight ref was a bug magnet: when the root tree was
   * replaced (e.g. after a delete at the root), the ref still held stale
   * paths from before the replace, so re-expanding those directories
   * silently dropped the IPC.
   */
  const requestLoad = React.useCallback(
    (node: TreeNode) => {
      if (node.type !== 'directory' || !node.hasChildren || node.loaded) {
        return;
      }
      fileTreeManager?.requestDirectoryContents(node.path);
    },
    [fileTreeManager],
  );

  const expandFolder = React.useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      const node = findNodeByPath(nodes, path);
      if (node) requestLoad(node);
    },
    [nodes, requestLoad],
  );

  const toggleExpanded = React.useCallback(
    (node: TreeNode) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      // requestLoad is idempotent (guards on `loaded`, `hasChildren` and
      // the in-flight ref), so calling it on every toggle is safe and
      // avoids the React-batching trap where a setState updater's side
      // effects don't run synchronously with the surrounding code.
      requestLoad(node);
    },
    [requestLoad],
  );

  // Auto-expand ancestors so an opened file is visible. Also kicks off
  // a lazy-load for any ancestor whose children haven't been fetched.
  React.useEffect(() => {
    if (!activeFile || !treeRoot || !activeFile.startsWith(treeRoot)) return;
    const sep = treeRoot.includes('\\') ? '\\' : '/';
    const segments = activeFile.split(/[/\\]/);
    const rootSegments = treeRoot.split(/[/\\]/);
    const rel = segments.slice(rootSegments.length);
    const ancestors: string[] = [];
    let cursor = treeRoot;
    for (let i = 0; i < rel.length - 1; i++) {
      cursor += sep + rel[i];
      ancestors.push(cursor);
    }
    if (ancestors.length === 0) return;
    setExpandedPaths((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const path of ancestors) {
      const node = findNodeByPath(nodes, path);
      if (node) requestLoad(node);
    }
  }, [activeFile, treeRoot, nodes, requestLoad]);

  const callbacks = React.useMemo(
    () => ({
      openFile: (path: string) => fileManager?.openFileFromPath(path),
      toggleSidebar,
      openSettings: () => openModal('settings'),
      expandFolder,
    }),
    [fileManager, toggleSidebar, openModal, expandFolder],
  );

  const items: MenuItem[] = React.useMemo(() => {
    if (!bridgeManager) return [];
    return getContextMenuItems(
      bridgeManager.bridge,
      treeRoot,
      contextNode,
      callbacks,
    );
    // `language` is in the deps so the menu rebuilds when i18next
    // finishes its async init or when the user switches locale.
  }, [bridgeManager, treeRoot, contextNode, callbacks, language]);

  const handleContextMenu = (event: React.MouseEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    const li = target.closest('li[data-path]') as HTMLLIElement | null;
    if (!li) {
      setContextNode(null);
      return;
    }
    const path = li.dataset.path;
    if (!path) {
      setContextNode(null);
      return;
    }
    const node = findNodeByPath(nodes, path);
    setContextNode(node ?? null);
  };

  // Web mode empty-state. Surfaces the "Open folder" affordance
  // inline so the user doesn't have to discover the right-click menu.
  // The "Restore previous folder" button appears only when a handle
  // is persisted in IndexedDB but its permission grant has expired —
  // re-granting requires a user gesture.
  const showWebEmptyState = mode === 'web' && !treeRoot;
  // Workspace header row (web only): shows the open folder's name
  // and a button to disconnect it.
  const showWorkspaceHeader = mode === 'web' && !!treeRoot;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ul
          id="file-tree"
          className="list-none m-0 p-0 flex-1"
          onContextMenu={handleContextMenu}
        >
          {showWorkspaceHeader && (
            <li className="mb-1 flex items-center gap-1 border-b border-border px-2 py-1 text-xs text-muted-foreground">
              <Icon name="folder-open" />
              <span className="flex-1 truncate" title={treeRoot ?? undefined}>
                {treeRoot}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleDisconnectFolder}
                className="h-5 w-5 p-0 text-base leading-none text-muted-foreground hover:text-foreground"
                aria-label={t('sidebar:disconnect_folder')}
                title={t('sidebar:disconnect_folder')}
              >
                &times;
              </Button>
            </li>
          )}
          {showWebEmptyState && (
            <li className="whitespace-normal! break-words px-2 py-3 text-xs text-muted-foreground">
              <div className="mb-2">{t('sidebar:no_workspace')}</div>
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleOpenFolder}
                  className="w-full justify-center"
                >
                  {t('sidebar:open_folder')}
                </Button>
                {hasRestorable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleRestoreWorkspace}
                    className="w-full justify-center"
                  >
                    {t('sidebar:restore_workspace')}
                  </Button>
                )}
              </div>
              {/* Mirrors the preview's `::: warning` block:
                  soft tinted bg, coloured left border, uppercase
                  "Warning" label. Body text inherits the sidebar's
                  muted foreground. */}
              <div className="mt-3 rounded-md border-l-4 border-[#9a6700] bg-[rgba(154,103,0,0.08)] px-3 py-2 dark:bg-[rgba(187,128,9,0.15)]">
                <div className="mb-1 text-[0.65rem] font-bold uppercase tracking-wider text-[#9a6700]">
                  Warning
                </div>
                <div className="text-foreground">
                  {t('sidebar:chromium_only_warning')}
                </div>
              </div>
            </li>
          )}
          {nodes.map((node) => (
            <NodeRow
              key={node.path}
              node={node}
              expandedPaths={expandedPaths}
              activeFile={activeFile}
              onToggle={toggleExpanded}
              onOpen={(p) => fileManager?.openFileFromPath(p)}
            />
          ))}
        </ul>
      </ContextMenuTrigger>
      {items.length > 0 && (
        <ContextMenuContent>
          {items.map((item, idx) =>
            item.divider ? (
              <ContextMenuSeparator key={`sep-${idx}`} />
            ) : (
              <ContextMenuItem
                key={`${item.label}-${idx}`}
                onSelect={item.action}
              >
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
};

interface NodeRowProps {
  node: TreeNode;
  expandedPaths: Set<string>;
  activeFile: string | null;
  onToggle: (node: TreeNode) => void;
  onOpen: (path: string) => void;
}

const NodeRow: React.FC<NodeRowProps> = ({
  node,
  expandedPaths,
  activeFile,
  onToggle,
  onOpen,
}) => {
  const expanded = node.type === 'directory' && expandedPaths.has(node.path);
  const isActiveFile = node.type === 'file' && node.path === activeFile;
  const hasChevron = node.type === 'directory' && node.hasChildren;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.type === 'directory') onToggle(node);
    else onOpen(node.path);
  };

  return (
    <li
      className={`ft-node ${node.type}`}
      data-path={node.path}
      onClick={handleClick}
    >
      <span className={`file-name ${isActiveFile ? 'active' : ''}`}>
        <span
          className={`mr-1 inline-block text-[0.7em] ${hasChevron ? '' : 'invisible'}`}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
        </span>
        <span className="mr-1">
          <Icon
            name={
              node.type === 'directory'
                ? expanded
                  ? 'folder-open'
                  : 'folder'
                : 'file'
            }
          />
        </span>
        {node.name}
      </span>
      {node.type === 'directory' && expanded && node.children && (
        <ul className="list-none m-0 pl-3">
          {node.children.map((child) => (
            <NodeRow
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              activeFile={activeFile}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

function findNodeByPath(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.type === 'directory' && node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}
