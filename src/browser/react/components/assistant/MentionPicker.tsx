import * as React from 'react';

import type { FileTreeManager } from '../../../core/FileTreeManager';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';

/**
 * `@`-mention file picker. Pops above the chat input when the user
 * types `@`; arrow keys + Enter pick a file, Escape closes.
 *
 * Uses the manager's read-only workspace inventory, independently of
 * explorer expansion and filters. File contents are read only on pick.
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
  /** Supplies the active workspace and independent file inventory. */
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
  const [listing, setListing] = React.useState<{
    root: string | null;
    paths: string[];
    loading: boolean;
    error: boolean;
  }>({ root: null, paths: [], loading: false, error: false });

  // Scan on open/focus. Tree changes reuse the cache unless its inventory
  // revision changed; query edits only filter the in-memory paths.
  React.useEffect(() => {
    if (!open || !fileTreeManager) return;
    let active = true;
    let generation = 0;
    let snapshot = fileTreeManager.getSnapshot();
    const refresh = async (force: boolean) => {
      if (!active || document.visibilityState === 'hidden') return;
      const root = fileTreeManager.getSnapshot().treeRoot;
      const request = ++generation;
      setListing({ root, paths: [], loading: !!root, error: false });
      if (!root) return;
      try {
        const { paths } = await fileTreeManager.listWorkspaceFiles(force);
        if (
          active &&
          request === generation &&
          root === fileTreeManager.getSnapshot().treeRoot
        )
          setListing({ root, paths, loading: false, error: false });
      } catch {
        if (active && request === generation)
          setListing({ root, paths: [], loading: false, error: true });
      }
    };
    const onFocus = () => void refresh(true);
    const unsubscribe = fileTreeManager.on('change', () => {
      const next = fileTreeManager.getSnapshot();
      if (
        next.treeRoot === snapshot.treeRoot &&
        next.fileListingRevision === snapshot.fileListingRevision
      )
        return;
      snapshot = next;
      void refresh(false);
    });
    void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      generation++;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [open, fileTreeManager]);

  const entries = React.useMemo(
    () =>
      listing.paths.map((path) => ({
        path,
        basename: baseName(path),
        pathLower: path.replace(/\\/g, '/').toLowerCase(),
        baseLower: baseName(path).toLowerCase(),
      })),
    [listing.paths],
  );

  const matches = React.useMemo<FlatMatch[]>(() => {
    if (!open || !fileTreeManager) return [];
    const snap = fileTreeManager.getSnapshot();
    if (!snap.treeRoot) return [];
    if (listing.root !== snap.treeRoot) return [];
    const needle = query.trim().replace(/\\/g, '/').toLowerCase();
    const flat: FlatMatch[] = [];
    const compare = (a: FlatMatch, b: FlatMatch) =>
      b.score - a.score || a.path.localeCompare(b.path);
    for (const entry of entries) {
      const score = !needle
        ? 1
        : entry.baseLower === needle
          ? 1000
          : entry.baseLower.startsWith(needle)
            ? 100
            : entry.baseLower.includes(needle)
              ? 50
              : entry.pathLower.includes(needle)
                ? 10
                : 0;
      if (!score) continue;
      const match = { path: entry.path, basename: entry.basename, score };
      if (
        flat.length === MAX_RESULTS &&
        compare(match, flat[flat.length - 1]) >= 0
      )
        continue;
      flat.push(match);
      flat.sort(compare);
      if (flat.length > MAX_RESULTS) flat.pop();
    }
    return flat;
  }, [query, fileTreeManager, open, entries, listing.root]);

  // Reset highlight when the query (or visibility) changes so the
  // user always starts at the top hit.
  React.useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  React.useEffect(() => {
    setHighlight((current) =>
      Math.min(current, Math.max(0, matches.length - 1)),
    );
  }, [matches]);

  // Keyboard navigation. Bound at window level while open — the
  // input doesn't lose focus when arrows are pressed.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.max(0, Math.min(h + 1, matches.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = matches[highlight];
        if (hit) {
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
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-[var(--shadow-floating)]"
      role="listbox"
      aria-label={t('assistant-chat:mention_picker_aria')}
      data-testid="mention-picker"
    >
      {matches.length === 0 ? (
        <div
          role="status"
          className="px-2 py-1.5 text-xs italic text-muted-foreground"
        >
          {t(
            listing.loading
              ? 'assistant-chat:mention_picker_loading'
              : listing.error
                ? 'assistant-chat:mention_picker_error'
                : 'assistant-chat:mention_picker_empty',
          )}
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
