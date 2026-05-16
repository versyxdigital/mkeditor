import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useModals } from '../contexts/ModalsContext';
import { useUIState } from '../contexts/UIStateContext';
import { useCounts } from '../hooks/useCounts';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

/**
 * Top chrome. Replaces the legacy `<nav class="navbar navbar-expand">`
 * that used to live in views/index.html. Phase 9 swapped Bootstrap
 * utility classes for Tailwind and the Bootstrap-driven tooltips
 * (`data-bs-toggle="tooltip"`) for the shadcn `<Tooltip>` primitive.
 */
export const Navbar: React.FC = () => {
  const { toggleSidebar } = useUIState();
  const { openModal } = useModals();
  const { t } = useTranslation();
  const { activeFile, tabs } = useFiles();
  const counts = useCounts();

  const activeTabName = React.useMemo(() => {
    if (!activeFile) return null;
    return tabs.find((tab) => tab.path === activeFile)?.name ?? null;
  }, [activeFile, tabs]);

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex items-center justify-between border-b border-border bg-background px-2 py-1">
        <div className="flex items-center gap-2">
          <Button
            id="sidebar-toggle"
            size="icon"
            variant="ghost"
            type="button"
            title={t('navbar:toggle_sidebar')}
            onClick={toggleSidebar}
            className="h-7 w-7"
          >
            <Icon name="bars" />
          </Button>
          <img src="./icon.png" className="ml-1 h-6 w-6" />
          <span id="active-file" className="text-sm text-muted-foreground">
            {activeTabName ?? t('app:brand_name')}
          </span>
        </div>
        <div className="flex items-center gap-3 pr-3">
          <div className="text-xs text-muted-foreground">
            <span>{t('navbar:character_count')}</span>{' '}
            <span id="character-count">{counts.characters}</span>
            <span className="mx-1 opacity-50">|</span>
            <span>{t('navbar:word_count')}</span>{' '}
            <span id="word-count">{counts.words}</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                className="text-muted-foreground hover:text-foreground"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openModal('settings');
                }}
              >
                <Icon name="cogs" />
              </a>
            </TooltipTrigger>
            <TooltipContent>{t('navbar:settings_tooltip')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                className="text-muted-foreground hover:text-foreground"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openModal('shortcuts');
                }}
              >
                <Icon name="question-circle" />
              </a>
            </TooltipTrigger>
            <TooltipContent>{t('navbar:shortcuts_tooltip')}</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  );
};
