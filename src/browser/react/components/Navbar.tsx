import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useUIState } from '../contexts/UIStateContext';
import { useCounts } from '../hooks/useCounts';
import { useTranslation } from '../hooks/useTranslation';

/**
 * Top chrome. Replaces the legacy `<nav class="navbar navbar-expand">`
 * that used to live in views/index.html.
 *
 * The settings cog and shortcuts icon still carry `data-bs-toggle="modal"
 * data-bs-target="#..."` attributes — Bootstrap 5's event delegation
 * picks up dynamically-rendered triggers, so the legacy modal HTML in
 * index.html continues to work until Phase 7 swaps to shadcn dialogs.
 */
export const Navbar: React.FC = () => {
  const { toggleSidebar } = useUIState();
  const { t } = useTranslation();
  const { activeFile, tabs } = useFiles();
  const counts = useCounts();

  const activeTabName = React.useMemo(() => {
    if (!activeFile) return null;
    return tabs.find((tab) => tab.path === activeFile)?.name ?? null;
  }, [activeFile, tabs]);

  return (
    <nav className="navbar navbar-expand navbar-light bg-light">
      <ul className="navbar-nav mr-auto">
        <li className="nav-item d-flex align-items-center gap-2">
          <button
            id="sidebar-toggle"
            className="btn btn-sm btn-outline-secondary border-0 ms-2"
            type="button"
            title={t('navbar:toggle_sidebar')}
            onClick={toggleSidebar}
          >
            <i className="fas fa-bars" />
          </button>
          <img src="./icon.png" className="img-fluid app-logo-tiny ms-2" />
          <span id="active-file" className="text-muted">
            {activeTabName ?? t('app:brand_name')}
          </span>
        </li>
      </ul>
      <ul className="navbar-nav ms-auto">
        <li className="nav-item text-muted">
          <small>
            <span>{t('navbar:character_count')}</span>{' '}
            <span id="character-count">{counts.characters}</span>
          </small>
          <span className="mx-1 font-weight-lighter">|</span>
          <small>
            <span>{t('navbar:word_count')}</span>{' '}
            <span id="word-count">{counts.words}</span>
          </small>
        </li>
        <li
          className="nav-item"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title={t('navbar:settings_tooltip')}
        >
          <a
            className="text-muted hover-fade ms-3"
            href="#"
            data-bs-toggle="modal"
            data-bs-target="#app-settings"
          >
            <i className="fas fa-cogs hover-fade" />
          </a>
        </li>
        <li
          className="nav-item"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title={t('navbar:shortcuts_tooltip')}
        >
          <a
            className="text-muted hover-fade mx-3"
            href="#"
            data-bs-toggle="modal"
            data-bs-target="#app-shortcuts"
          >
            <i className="fa fa-question-circle hover-fade" />
          </a>
        </li>
      </ul>
    </nav>
  );
};
