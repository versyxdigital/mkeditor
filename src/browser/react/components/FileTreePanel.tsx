import * as React from 'react';

import type { TreeNode } from '../../core/FileTreeManager';
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
import { Icon } from './Icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';

/**
 * Recursive React rendering of the file explorer tree. Phase 5 keeps the
 * legacy CSS classes (ft-node, directory, file, file-name) so the styling
 * in _sidebar.scss carries over unchanged.
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
  const { fileTreeManager, fileManager, bridgeManager } = useManagers();
  const { nodes, treeRoot } = useFileTree();
  const { activeFile } = useFiles();
  const { openModal } = useModals();
  const { toggleSidebar } = useUIState();
  // `getContextMenuItems` calls `t(...)` and bakes the resolved strings
  // into the items array. We need the memo to invalidate when i18next
  // finishes loading (its first init resolves AFTER React mounts) and
  // whenever the user picks a new language.
  const { language } = useTranslation();

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ul
          id="file-tree"
          className="list-none m-0 p-0 flex-1"
          onContextMenu={handleContextMenu}
        >
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
