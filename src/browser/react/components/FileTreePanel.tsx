import * as React from 'react';

import type { TreeNode } from '../../core/FileTreeManager';
import type { WebFileBridge } from '../../core/WebFileBridge';
import {
  getContextMenuItems,
  type ContextMenuItem as MenuItem,
} from '../../core/mappings/explorerContextMenu';
import { sonnerToast } from '../../notify';
import { basename } from '../../util';
import { useFiles } from '../contexts/FilesContext';
import { useFileTree } from '../contexts/FileTreeContext';
import { useManagers } from '../contexts/ManagersContext';
import { useModals } from '../contexts/ModalsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useUIState } from '../contexts/UIStateContext';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from './ui/button';
import { FileTreeFilterBar } from './FileTreeFilterBar';
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
  const { settings } = useSettings();
  const activeExtensions = React.useMemo(
    () => new Set(settings.fileExplorer?.extensions ?? ['md']),
    [settings.fileExplorer?.extensions],
  );
  const [search, setSearch] = React.useState('');
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

  // Re-pop the sidebar when a web workspace first lands, in case the
  // user manually collapsed it before opening a folder. Fires once
  // per workspace-load via a ref guard so a user-initiated collapse
  // *after* the workspace is loaded isn't fought.
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

  // Drag-and-drop move handler. Triggered from `<NodeRow>` (when a
  // file or folder is dropped on a directory) and from the workspace
  // header (drop on workspace root). The destination directory +
  // source path are passed in; we compute the final dst path here so
  // separator handling lives in one place.
  //
  // Toasts on every refusal so the user always gets feedback. The
  // main-side `moveItem` is the source of truth — UI checks here are
  // a fast path for the obvious cases (no-op, into-self) so the user
  // sees feedback without an IPC round-trip.
  const handleMoveDrop = React.useCallback(
    async (srcPath: string, targetDir: string) => {
      if (!bridgeManager) return;
      const sep = pickSeparator(treeRoot, srcPath, targetDir);
      const dstPath = `${targetDir}${sep}${basename(srcPath)}`;
      // Fast refusal: dropping onto the source's current parent is a
      // no-op (the file is already there). Main would refuse with
      // `destination_same_as_source`; we short-circuit so the user
      // doesn't see a toast for what they probably consider an
      // accidental drop.
      if (dstPath === srcPath) return;
      // Fast refusal: dropping a folder onto itself / a descendant.
      // Both checks happen authoritatively on the main side too, but
      // catching them client-side avoids a wasted IPC + the brief
      // "destination_inside_source" toast the user wouldn't expect.
      const srcWithSep = srcPath.endsWith(sep) ? srcPath : srcPath + sep;
      if (dstPath === srcPath || dstPath.startsWith(srcWithSep)) {
        sonnerToast('warning', t('notifications:move_into_self_refused'));
        return;
      }
      const result = await bridgeManager.moveItem(srcPath, dstPath);
      if (!result.ok) {
        const key =
          MOVE_ERROR_KEYS[result.error] ?? 'notifications:move_failed';
        sonnerToast('error', `${t(key)} — ${result.error}`);
      }
    },
    [bridgeManager, treeRoot, t],
  );

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
      openMoveItem: (path: string) =>
        openModal('moveItem', { sourcePath: path }),
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

  // Apply the extension + search filter to the tree. Files are kept
  // only if their extension is in the active set AND (search empty
  // OR name matches case-insensitive substring). Directories are kept
  // only if some descendant survives. When the user is searching, the
  // surviving directories must auto-expand so the matches are visible
  // without further clicks — collected in `searchExpansion` and OR'd
  // with the user-driven `expandedPaths` set inside `<NodeRow>`.
  const { filteredNodes, searchExpansion } = React.useMemo(
    () => filterTree(nodes, activeExtensions, search),
    [nodes, activeExtensions, search],
  );

  // Web mode empty-state. Surfaces the "Open folder" affordance
  // inline so the user doesn't have to discover the right-click menu.
  // The "Restore previous folder" button appears only when a handle
  // is persisted in IndexedDB but its permission grant has expired —
  // re-granting requires a user gesture.
  const showWebEmptyState = mode === 'web' && !treeRoot;
  // Workspace header row: shows the open folder's name as a top-level
  // label (VSCode-style). Both modes get the label so an open folder
  // is always visible even when it has no children; only web shows
  // the X disconnect button (desktop has no equivalent action — the
  // folder is forgotten by main when the app closes anyway).
  const showWorkspaceHeader = !!treeRoot;
  const workspaceLabel = treeRoot ? basename(treeRoot) : '';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ul
          id="file-tree"
          className="list-none m-0 p-0 flex-1"
          onContextMenu={handleContextMenu}
        >
          {showWorkspaceHeader && (
            <li
              className="mb-1 flex items-center gap-1 border-b border-border px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground data-[drop-target=true]:bg-primary/10 data-[drop-target=true]:text-foreground"
              onDragOver={(e) => {
                if (!treeRoot) return;
                if (!e.dataTransfer.types.includes(MKED_DRAG_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                (e.currentTarget as HTMLElement).dataset.dropTarget = 'true';
              }}
              onDragLeave={(e) => {
                (e.currentTarget as HTMLElement).dataset.dropTarget = 'false';
              }}
              onDrop={(e) => {
                (e.currentTarget as HTMLElement).dataset.dropTarget = 'false';
                if (!treeRoot) return;
                const src = e.dataTransfer.getData(MKED_DRAG_MIME);
                if (!src) return;
                e.preventDefault();
                e.stopPropagation();
                void handleMoveDrop(src, treeRoot);
              }}
            >
              <Icon name="folder-open" />
              <span className="flex-1 truncate" title={treeRoot ?? undefined}>
                {workspaceLabel}
              </span>
              {mode === 'web' && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleDisconnectFolder}
                  className="h-5 w-5 p-0 text-base leading-none normal-case text-muted-foreground hover:text-foreground"
                  aria-label={t('sidebar:disconnect_folder')}
                  title={t('sidebar:disconnect_folder')}
                >
                  &times;
                </Button>
              )}
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
          {showWorkspaceHeader && (
            <li className="list-none">
              <FileTreeFilterBar search={search} onSearchChange={setSearch} />
            </li>
          )}
          {filteredNodes.map((node) => (
            <NodeRow
              key={node.path}
              node={node}
              expandedPaths={expandedPaths}
              searchExpansion={searchExpansion}
              activeFile={activeFile}
              onToggle={toggleExpanded}
              onOpen={(p) => fileManager?.openFileFromPath(p)}
              onMove={handleMoveDrop}
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
  /**
   * Paths that should be force-expanded while a search query is active.
   * OR'd with `expandedPaths` so the user's manual collapse state is
   * preserved once they clear the search.
   */
  searchExpansion: Set<string>;
  activeFile: string | null;
  onToggle: (node: TreeNode) => void;
  onOpen: (path: string) => void;
  /**
   * Drag-and-drop move handler. Fires when a file or folder is
   * dropped on this row (directory rows only act as drop targets).
   * The panel computes the final destination path and routes through
   * `BridgeManager.moveItem`.
   */
  onMove: (srcPath: string, targetDir: string) => void;
}

const NodeRow: React.FC<NodeRowProps> = ({
  node,
  expandedPaths,
  searchExpansion,
  activeFile,
  onToggle,
  onOpen,
  onMove,
}) => {
  const [isDropTarget, setIsDropTarget] = React.useState(false);
  // "Visually expanded" requires both the user intent (path in
  // expandedPaths or search expansion) AND that the directory's
  // children have actually been loaded. Without the `loaded` gate,
  // a tree refresh that replaces a previously-expanded directory's
  // children with a fresh shallow listing (e.g. after a file/folder
  // delete) would leave the chevron / folder-open icons in the
  // expanded pose while the children block bails on the undefined
  // `children` array — a visual mismatch the user reads as "tree
  // collapsed but icons stuck". Gating on `loaded` keeps the icons
  // honest; when the user re-clicks, the lazy-load repopulates and
  // the icons flip back open.
  const expanded =
    node.type === 'directory' &&
    (expandedPaths.has(node.path) || searchExpansion.has(node.path)) &&
    node.loaded === true;
  const isActiveFile = node.type === 'file' && node.path === activeFile;
  const hasChevron = node.type === 'directory' && node.hasChildren;
  // Non-markdown files render dimmed to reinforce that markdown is
  // still MKEditor's focus. Directories aren't muted (they're
  // organisational, not content).
  const muted =
    node.type === 'file' && !node.name.toLowerCase().endsWith('.md');

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.type === 'directory') onToggle(node);
    else onOpen(node.path);
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Stamp the source path on the dataTransfer with our own MIME so
    // external file drags from the OS file manager don't get
    // mistaken for in-tree moves (those have other MIME types).
    e.dataTransfer.setData(MKED_DRAG_MIME, node.path);
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  // Only directory rows accept drops. Stopping propagation prevents
  // a nested directory drop from also firing the parent directory's
  // drop handler — the most specific (innermost) drop target wins.
  const acceptsDrops = node.type === 'directory';
  const handleDragOver = (e: React.DragEvent) => {
    if (!acceptsDrops) return;
    if (!e.dataTransfer.types.includes(MKED_DRAG_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDropTarget(true);
  };
  const handleDragLeave = () => {
    if (isDropTarget) setIsDropTarget(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    setIsDropTarget(false);
    if (!acceptsDrops) return;
    const src = e.dataTransfer.getData(MKED_DRAG_MIME);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    onMove(src, node.path);
  };

  return (
    <li
      className={`ft-node ${node.type}${muted ? ' ft-node-muted' : ''}${isDropTarget ? ' bg-primary/10' : ''}`}
      data-path={node.path}
      data-muted={muted ? 'true' : undefined}
      data-drop-target={isDropTarget ? 'true' : undefined}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <span
        className={`file-name ${isActiveFile ? 'active' : ''} ${muted ? 'text-muted-foreground' : ''}`}
      >
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
              searchExpansion={searchExpansion}
              activeFile={activeFile}
              onToggle={onToggle}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * Walk the tree, dropping files whose extension isn't in the active
 * set or whose name doesn't match `searchQuery` (when non-empty), and
 * dropping directories whose entire subtree disappeared as a result.
 */
export function filterTree(
  nodes: TreeNode[],
  activeExtensions: Set<string>,
  searchQuery: string,
): { filteredNodes: TreeNode[]; searchExpansion: Set<string> } {
  // Normalise once so callers don't have to remember. Search is
  // case-insensitive substring on the file name.
  const query = searchQuery.trim().toLowerCase();
  const searchExpansion = new Set<string>();

  function visit(input: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of input) {
      if (node.type === 'file') {
        if (!fileExtensionMatches(node.name, activeExtensions)) continue;
        if (query && !node.name.toLowerCase().includes(query)) {
          continue;
        }
        out.push(node);
        continue;
      }
      // Directory
      if (node.children && node.children.length > 0) {
        const filteredChildren = visit(node.children);
        if (filteredChildren.length > 0) {
          if (query) searchExpansion.add(node.path);
          out.push({ ...node, children: filteredChildren });
          continue;
        }
        // No surviving descendants. Drop the directory unless its
        // subtree might still load in (hasChildren && !loaded).
        if (node.hasChildren && !node.loaded) {
          out.push(node);
        }
        continue;
      }
      // No children loaded yet (or known-empty directory).
      if (node.hasChildren && !node.loaded) {
        out.push(node);
      }
    }
    return out;
  }

  return { filteredNodes: visit(nodes), searchExpansion };
}

function fileExtensionMatches(name: string, active: Set<string>): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return active.has(name.slice(dot + 1).toLowerCase());
}

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

/**
 * Custom MIME used to mark drag payloads that originate inside the
 * file tree. Lets dragover handlers distinguish in-tree moves from
 * external OS file drags (which we don't accept — drag-and-drop of
 * files from the OS would conflict with the paste-image-from-OS path
 * and is intentionally not supported, see PasteImageHandler).
 */
const MKED_DRAG_MIME = 'application/x-mked-path';

/**
 * Map the structured error codes `AppStorage.moveItem` returns onto
 * the i18n keys for the toast strings. Falls back to a generic
 * `move_failed` key for unmapped messages (e.g. raw fs error text
 * surfaced from main).
 */
const MOVE_ERROR_KEYS: Record<string, string> = {
  destination_same_as_source: 'notifications:move_same_source',
  destination_inside_source: 'notifications:move_into_self_refused',
  destination_exists: 'notifications:move_collision',
  destination_parent_missing: 'notifications:move_parent_missing',
  destination_parent_not_directory: 'notifications:move_parent_missing',
  move_unsupported_in_this_mode: 'notifications:move_failed',
};

/**
 * Pick the path separator to use when joining a target directory
 * with a source basename. Prefers the workspace root's separator,
 * then the source path's, then the target dir's. Mixed-separator
 * workspaces are rare but possible (e.g. session restore on a
 * platform other than the one that wrote the session).
 */
function pickSeparator(
  treeRoot: string | null,
  srcPath: string,
  targetDir: string,
): '\\' | '/' {
  if (treeRoot && treeRoot.includes('\\')) return '\\';
  if (srcPath.includes('\\')) return '\\';
  if (targetDir.includes('\\')) return '\\';
  return '/';
}
