import * as React from 'react';

import { useTranslation } from '../hooks/useTranslation';
import { FileTreePanel } from './FileTreePanel';

/**
 * File explorer sidebar. Phase 5 swaps the legacy `<ul id="file-tree">`
 * placeholder for the React-rendered `<FileTreePanel>`, which subscribes
 * to FileTreeContext for tree data and FilesContext for active-file
 * highlighting.
 */
export const Sidebar: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div id="sidebar" className="flex h-full flex-col p-3">
      <div className="explorer-title">{t('sidebar:explorer')}</div>
      <FileTreePanel />
    </div>
  );
};
