import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useModals } from '../contexts/ModalsContext';
import { useUIState } from '../contexts/UIStateContext';
import { useManagers } from '../contexts/ManagersContext';
import { sonnerToast } from '../../notify';
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
 * Top navbar.
 */
export const Navbar: React.FC = () => {
  const { toggleSidebar, toggleRightSidebar, rightSidebarOpen } = useUIState();
  const { openModal } = useModals();
  const { mode } = useManagers();
  const { t } = useTranslation();
  const { activeFile, tabs } = useFiles();

  // Hide the AI sidebar toggle on web — AI Assistant is desktop-only
  // (see docs/AI_ASSISTANT.md "Decisions" → "API call location").
  const showAssistantToggle = mode !== 'web';

  // Navbar shows the full path of the active file (the tab itself
  // shows just the filename via tab.name). For untitled scratch
  // buffers the path is a synthetic `untitled-N` id — fall back to
  // the tab's name so the label reads "Untitled 1" instead.
  const isUntitled = !activeFile || activeFile.startsWith('untitled');
  const activeFileLabel = React.useMemo(() => {
    if (!activeFile) return null;
    if (isUntitled) {
      return tabs.find((tab) => tab.path === activeFile)?.name ?? null;
    }
    return activeFile;
  }, [activeFile, tabs, isUntitled]);

  // Copy the active file's path to the clipboard. Only wired up when
  // there's a real on-disk path (untitled scratch buffers don't have
  // one worth copying).
  const handleCopyPath = React.useCallback(() => {
    if (!activeFile || isUntitled) return;
    void navigator.clipboard
      .writeText(activeFile)
      .then(() => sonnerToast('success', t('navbar:path_copied')));
  }, [activeFile, isUntitled, t]);

  return (
    <TooltipProvider delayDuration={200}>
      <nav className="flex h-[var(--toolbar-height)] shrink-0 min-w-0 items-center justify-between gap-2 border-b border-subtle bg-background px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            id="sidebar-toggle"
            size="icon"
            variant="ghost"
            type="button"
            title={t('navbar:toggle_sidebar')}
            aria-label={t('navbar:toggle_sidebar')}
            onClick={toggleSidebar}
            className="h-7 w-7 shrink-0 text-muted-foreground"
          >
            <Icon name="bars" className="h-3.5 w-3.5" />
          </Button>
          <span
            id="active-file"
            className="truncate text-xs font-medium text-muted-foreground"
            title={activeFileLabel ?? undefined}
          >
            {activeFileLabel ?? t('app:brand_name')}
          </span>
          {!isUntitled && activeFile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopyPath}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground text-xs"
                  aria-label={t('navbar:copy_path_tooltip')}
                >
                  <Icon name="copy" className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('navbar:copy_path_tooltip')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                title={t('navbar:settings_tooltip')}
                aria-label={t('navbar:settings_tooltip')}
                onClick={(e) => {
                  e.preventDefault();
                  openModal('settings');
                }}
              >
                <Icon name="cogs" className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('navbar:settings_tooltip')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                title={t('navbar:shortcuts_tooltip')}
                aria-label={t('navbar:shortcuts_tooltip')}
                onClick={(e) => {
                  e.preventDefault();
                  openModal('shortcuts');
                }}
              >
                <Icon name="question-circle" className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('navbar:shortcuts_tooltip')}</TooltipContent>
          </Tooltip>
          {showAssistantToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="assistant-toggle"
                  size="icon"
                  variant="ghost"
                  type="button"
                  aria-pressed={rightSidebarOpen}
                  aria-label={t('navbar:toggle_assistant_tooltip')}
                  title={t('navbar:toggle_assistant_tooltip')}
                  onClick={toggleRightSidebar}
                  className="h-7 w-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Icon name="comments" className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('navbar:toggle_assistant_tooltip')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </nav>
    </TooltipProvider>
  );
};
