import * as React from 'react';

import {
  FILE_EXPLORER_EXTENSION_GROUPS,
  FILE_EXPLORER_CURATED_EXTENSIONS,
} from '../../config';
import { useSettings } from '../contexts/SettingsContext';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Icon } from './Icon';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * Filter bar above the file-tree listing. Two surfaces:
 *
 *   - Search box: case-insensitive substring match on file names.
 *     Per-session, lifted to the parent so the tree can read it.
 *   - Funnel popover: checkbox list of curated extensions. Persisted
 *     via SettingsProvider (settings.fileExplorer.extensions).
 *
 * The funnel groups (Markdown / Images / Documents) come from
 * [FILE_EXPLORER_EXTENSION_GROUPS](src/browser/config.ts). The defaults
 * ship with only `md` enabled so existing users see no change after
 * upgrade — they have to opt in to other types explicitly.
 */
export interface FileTreeFilterBarProps {
  search: string;
  onSearchChange: (next: string) => void;
}

export const FileTreeFilterBar: React.FC<FileTreeFilterBarProps> = ({
  search,
  onSearchChange,
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const extensions = settings.fileExplorer?.extensions ?? ['md'];

  const toggleExtension = React.useCallback(
    (ext: string, on: boolean) => {
      const set = new Set(extensions);
      if (on) set.add(ext);
      else set.delete(ext);
      // Preserve the curated order so the persisted shape is stable
      // across saves (avoids spurious settings.json diffs when the
      // only change is checkbox toggling).
      const next = FILE_EXPLORER_CURATED_EXTENSIONS.filter((e) => set.has(e));
      updateSetting('fileExplorer', { extensions: next });
    },
    [extensions, updateSetting],
  );

  const resetToMarkdownOnly = React.useCallback(() => {
    updateSetting('fileExplorer', { extensions: ['md'] });
  }, [updateSetting]);

  // Filter is "active" (badge dot) when the user has deviated from the
  // markdown-only default — either by adding more types or by clearing
  // markdown itself. Visual cue so the user can tell at a glance that
  // the tree is being filtered.
  const filterActive = extensions.length !== 1 || extensions[0] !== 'md';

  return (
    <div
      data-testid="file-tree-filter-bar"
      className="mb-1 flex items-center gap-1 px-2 py-1"
    >
      <div className="relative flex-1">
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('sidebar:search_placeholder')}
          aria-label={t('sidebar:search_placeholder')}
          className="h-7 pr-7 text-xs"
          data-testid="file-tree-search"
        />
        <Icon
          name="magnifying-glass"
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
        />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('sidebar:filter_label')}
            title={t('sidebar:filter_label')}
            className="relative h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            data-testid="file-tree-filter-button"
          >
            <Icon name="filter" />
            {filterActive && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-primary"
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-2 text-xs">
          <div className="mb-1 px-1 text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground">
            {t('sidebar:filter_types')}
          </div>
          <div className="flex flex-col gap-2">
            {FILE_EXPLORER_EXTENSION_GROUPS.map((group) => (
              <div key={group.key}>
                <div className="mb-1 px-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {t(`sidebar:filter_section_${group.key}`)}
                </div>
                <ul className="m-0 list-none p-0">
                  {group.extensions.map((ext) => {
                    const checked = extensions.includes(ext);
                    return (
                      <li
                        key={ext}
                        className="flex items-center gap-2 px-1 py-0.5"
                      >
                        <Checkbox
                          id={`ext-${ext}`}
                          checked={checked}
                          onCheckedChange={(v) =>
                            toggleExtension(ext, v === true)
                          }
                          data-testid={`file-tree-filter-${ext}`}
                        />
                        <label
                          htmlFor={`ext-${ext}`}
                          className="cursor-pointer select-none font-mono"
                        >
                          .{ext}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={resetToMarkdownOnly}
            className="mt-3 w-full rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            data-testid="file-tree-filter-reset"
          >
            {t('sidebar:filter_reset_to_md')}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
};
