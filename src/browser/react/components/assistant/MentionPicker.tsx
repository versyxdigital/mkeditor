import * as React from 'react';

import type { FileTreeManager, TreeNode } from '../../../core/FileTreeManager';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';

/**
 * `@`-mention file picker. Pops above the chat input when the user
 * types `@`; arrow keys + Enter pick a file, Escape closes.
 *
 * Source of truth is `FileTreeManager.getSnapshot()`, flattened to
 * the list of file paths. Lazy-loaded subdirectories are loaded on
 * first open (same approach as P5's `list_files` tool) so the user
 * sees the whole workspace from a freshly-restored session rather
 * than just top-level files.
 *
 * Filtering: case-insensitive substring on the path (basename gets
 * higher rank than parent-dir match). Plain substring is honest about
 * what it does — Cursor / Continue go heavier on character-skip fuzz
 * matching but for v1 substring is more predictable.
 */
export interface MentionPickerProps {
  /** Live query — the text after the `@` in the input. */
  query: string;
  /** True to render the popover. Caller toggles based on `@` presence. */
  open: boolean;
  /** Fires when the user picks a path (Enter or click). */
  onPick: (path: string) => void;
  /** Fires when the user dismisses with Escape or by clearing the `@`. */
  onClose: () => void;
  /** File tree manager — read snapshot + lazy-load directories. */
  fileTreeManager: FileTreeManager | null;
}

const MAX_RESULTS = 20;

interface FlatMatch {
  path: string;
  basename: string;
  /** Higher = better. Basename hit > path hit. */
  score: number;
}

export const MentionPicker: React.FC<MentionPickerProps> = ({
  query,
  open,
  onPick,
  onClose,
  fileTreeManager,
}) => {
  const { t } = useTranslation();
  const [highlight, setHighlight] = React.useState(0);

  // Subscribe to tree change events FIRST so newly-loaded
  // directories show up in the result list without the user
  // closing/reopening. `tick` is included in the matches-memo deps
  // so a `change` emission (eg. after `requestDirectoryContents`
  // resolves) actually re-walks the (now mutated) snapshot — useMemo
  // skips the callback otherwise.
  const [tick, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!fileTreeManager) return;
    return fileTreeManager.on('change', forceTick);
  }, [fileTreeManager]);

  // On-demand lazy-load: when the user types a query that looks like
  // a directory hint (`native/quick…`), request the prefix-matching
  // directory and re-rank as soon as its children arrive. We do NOT
  // bulk-load every unloaded directory on open — that previously
  // surprised users by triggering `from:folder:opened` for many
  // sibling subdirs at once, which the explorer perceives as the
  // workspace flickering. Top-level + already-expanded directories
  // are picker-visible without any extra IPC; deeper content comes
  // in only when the user signals interest.
  React.useEffect(() => {
    if (!open || !fileTreeManager || !query) return;
    const slashed = query.replace(/\\/g, '/');
    const slashIdx = slashed.lastIndexOf('/');
    if (slashIdx <= 0) return;
    const dirHint = slashed.slice(0, slashIdx);
    const target = findUnloadedDir(
      fileTreeManager.getSnapshot().nodes,
      dirHint,
    );
    if (target) fileTreeManager.requestDirectoryContents(target);
  }, [open, query, fileTreeManager, tick]);

  const matches = React.useMemo<FlatMatch[]>(() => {
    if (!fileTreeManager) return [];
    const snap = fileTreeManager.getSnapshot();
    if (!snap.treeRoot) return [];
    const needle = query.trim().toLowerCase();
    const flat: FlatMatch[] = [];
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') {
          const basename = baseName(n.path);
          const pathLower = n.path.toLowerCase();
          const baseLower = basename.toLowerCase();
          if (!needle) {
            flat.push({ path: n.path, basename, score: 1 });
          } else if (baseLower.includes(needle)) {
            // Basename hit. Exact prefix outranks substring; exact
            // basename outranks both.
            const score =
              baseLower === needle
                ? 1000
                : baseLower.startsWith(needle)
                  ? 100
                  : 50;
            flat.push({ path: n.path, basename, score });
          } else if (pathLower.includes(needle)) {
            flat.push({ path: n.path, basename, score: 10 });
          }
        } else if (n.children) {
          walk(n.children);
        }
      }
    };
    walk(snap.nodes);
    flat.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return flat.slice(0, MAX_RESULTS);
  }, [query, fileTreeManager, open, tick]);

  // Reset highlight when the query (or visibility) changes so the
  // user always starts at the top hit.
  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Keyboard navigation. Bound at window level while open — the
  // input doesn't lose focus when arrows are pressed.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, matches.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        const hit = matches[highlight];
        if (hit) {
          e.preventDefault();
          onPick(hit.path);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, matches, highlight, onPick, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md"
      role="listbox"
      aria-label={t('assistant-chat:mention_picker_aria')}
      data-testid="mention-picker"
    >
      {matches.length === 0 ? (
        <div className="px-2 py-1.5 text-xs italic text-muted-foreground">
          {t('assistant-chat:mention_picker_empty')}
        </div>
      ) : (
        matches.map((m, idx) => (
          <button
            key={m.path}
            type="button"
            onClick={() => onPick(m.path)}
            onMouseEnter={() => setHighlight(idx)}
            data-testid={`mention-option-${m.path}`}
            className={cn(
              'flex w-full min-w-0 flex-col items-start rounded px-2 py-1 text-left',
              idx === highlight && 'bg-muted',
            )}
            role="option"
            aria-selected={idx === highlight}
            title={m.path}
          >
            <span className="w-full truncate text-sm">{m.basename}</span>
            <span
              className="w-full truncate text-xs text-muted-foreground"
              dir="rtl"
            >
              {m.path}
            </span>
          </button>
        ))
      )}
    </div>
  );
};

function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Find the deepest unloaded directory whose path ends with `slashHint`
 * (forward-slash joined, no leading `/`). Used by the on-demand
 * lazy-load effect — when the user types `native/quick`, we look for
 * an unloaded directory ending with `/native` (or named `native`) and
 * request its children. Returns null when nothing matches OR the
 * candidate is already loaded.
 */
function findUnloadedDir(
  nodes: TreeNode[],
  slashHint: string,
): string | null {
  const cleanHint = slashHint.replace(/^\/+|\/+$/g, '');
  if (!cleanHint) return null;
  const stack: TreeNode[] = [...nodes];
  let best: string | null = null;
  let bestDepth = -1;
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type !== 'directory') continue;
    if (n.children) stack.push(...n.children);
    if (!n.hasChildren || n.loaded) continue;
    const norm = n.path.replace(/\\/g, '/');
    if (norm.endsWith('/' + cleanHint) || norm.endsWith(cleanHint)) {
      const depth = (n.path.match(/[\\/]/g) ?? []).length;
      if (depth > bestDepth) {
        best = n.path;
        bestDepth = depth;
      }
    }
  }
  return best;
}
