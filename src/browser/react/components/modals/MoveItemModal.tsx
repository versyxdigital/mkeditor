import * as React from 'react';

import type { TreeNode } from '../../../core/FileTreeManager';
import { sonnerToast } from '../../../notify';
import { basename } from '../../../util';
import { useFileTree } from '../../contexts/FileTreeContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Icon } from '../Icon';

/**
 * "Move to…" folder picker. Opens from the file-explorer right-click
 * menu with the source path stashed in the modal payload; the user
 * picks a destination directory and confirms.
 *
 * Tree rendering details:
 *   - Folder-only (files are hidden; this is a destination picker,
 *     not a file picker).
 *   - Click-to-select; double-click — or the chevron — expands the
 *     row inline. Initial expansion mirrors what's loaded in the
 *     main FileTreeManager snapshot.
 *   - Lazy-loaded directories trigger a fileTreeManager fetch on
 *     first expand, identical to the main panel's behaviour.
 *
 * Refusal:
 *   - The OK button is disabled when the selection would move a
 *     folder into itself / its descendants (early UI feedback). The
 *     main-side check is still authoritative.
 */
export const MoveItemModal: React.FC = () => {
  const { open, payload, closeModal } = useModals();
  const { t } = useTranslation();
  const { fileTreeManager, bridgeManager } = useManagers();
  const { nodes, treeRoot } = useFileTree();

  // Pull the source path out of the payload. The modal only opens
  // when `open === 'moveItem'`, which the menu code path guarantees
  // a `{ sourcePath }` payload — we still defend against drift here.
  const sourcePath =
    payload && 'sourcePath' in payload && typeof payload.sourcePath === 'string'
      ? payload.sourcePath
      : null;
  const isOpen =
    open === 'moveItem' && sourcePath !== null && treeRoot !== null;

  // Selection defaults to the workspace root each time the modal
  // opens so consecutive moves don't carry over yesterday's choice.
  // The workspace-root row also starts expanded — without that the
  // tree shows a single closed row on first open, which forces the
  // user to expand it before they can pick anything.
  const [selected, setSelected] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (isOpen && treeRoot) {
      setSelected(treeRoot);
      setExpanded(new Set([treeRoot]));
    }
  }, [isOpen, treeRoot]);

  const handleExpand = React.useCallback(
    (node: TreeNode) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      if (node.hasChildren && !node.loaded) {
        fileTreeManager?.requestDirectoryContents(node.path);
      }
    },
    [fileTreeManager],
  );

  // Detect "selection would land the source inside itself" — disable
  // the confirm button rather than letting the user click into an
  // error.
  const sep = treeRoot && treeRoot.includes('\\') ? '\\' : '/';
  const isInvalidSelection = React.useMemo(() => {
    if (!sourcePath || !selected) return true;
    if (selected === sourcePath) return true;
    const srcWithSep = sourcePath.endsWith(sep) ? sourcePath : sourcePath + sep;
    if (selected.startsWith(srcWithSep)) return true;
    // Selecting the source's current parent is a no-op (dst === src
    // after composing). Refuse early; user gets nothing useful from
    // hitting OK in that state.
    const dst = `${selected}${sep}${basename(sourcePath)}`;
    if (dst === sourcePath) return true;
    return false;
  }, [sourcePath, selected, sep]);

  const handleConfirm = React.useCallback(async () => {
    if (!sourcePath || !selected || !bridgeManager) return;
    const dstPath = `${selected}${sep}${basename(sourcePath)}`;
    const result = await bridgeManager.moveItem(sourcePath, dstPath);
    if (!result.ok) {
      sonnerToast(
        'error',
        `${t('notifications:move_failed')} — ${result.error}`,
      );
      return;
    }
    closeModal();
  }, [bridgeManager, sourcePath, selected, sep, t, closeModal]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent aria-describedby={undefined} className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('modals-move:title')}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 text-sm">
          {sourcePath && (
            <p className="mb-2 text-xs text-muted-foreground">
              <span>{t('modals-move:moving_label')}</span>{' '}
              <span
                className="font-mono break-all text-foreground"
                data-testid="move-item-source-path"
              >
                {sourcePath}
              </span>
            </p>
          )}
          <div
            className="max-h-72 overflow-auto rounded border border-border bg-muted/30 p-2"
            data-testid="move-item-tree"
          >
            {treeRoot && (
              <FolderRow
                node={{
                  type: 'directory',
                  name: basename(treeRoot),
                  path: treeRoot,
                  hasChildren: true,
                  loaded: true,
                  children: nodes,
                }}
                depth={0}
                expanded={expanded}
                selected={selected}
                onSelect={setSelected}
                onToggle={handleExpand}
              />
            )}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={closeModal}
              data-testid="move-item-cancel"
            >
              {t('modals-move:cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={isInvalidSelection}
              data-testid="move-item-confirm"
            >
              {t('modals-move:confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------- */
/*  FolderRow — minimal recursive folder-only row                          */
/* -------------------------------------------------------------------- */

interface FolderRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onSelect: (path: string) => void;
  onToggle: (node: TreeNode) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({
  node,
  depth,
  expanded,
  selected,
  onSelect,
  onToggle,
}) => {
  const isExpanded = expanded.has(node.path) && node.loaded === true;
  const isSelected = selected === node.path;
  const hasChevron = node.hasChildren;
  const directoryChildren =
    node.children?.filter((c) => c.type === 'directory') ?? [];

  return (
    <div data-testid={`move-folder-${node.path}`}>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => onToggle(node)}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted ${
          isSelected ? 'bg-primary/20 font-semibold text-foreground' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span
          className={`inline-block w-3 text-[0.7em] ${
            hasChevron ? 'cursor-pointer' : 'invisible'
          }`}
          onClick={(e) => {
            if (!hasChevron) return;
            e.stopPropagation();
            onToggle(node);
          }}
        >
          <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />
        </span>
        <Icon name={isExpanded ? 'folder-open' : 'folder'} />
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded && directoryChildren.length > 0 && (
        <div>
          {directoryChildren.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};
