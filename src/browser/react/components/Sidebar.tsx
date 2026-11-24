import * as React from 'react';

import { useTranslation } from '../hooks/useTranslation';
import { FileTreePanel } from './FileTreePanel';
import { CloudExplorer, WorkspacePicker } from './cloud/CloudExplorer';
import { useCloud } from '../hooks/useCloud';

/**
 * File explorer sidebar. React-rendered `<FileTreePanel>`, subscribes
 * to FileTreeContext for tree data and FilesContext for active-file
 * highlighting.
 */
export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const { state } = useCloud();

  return (
    <div id="sidebar" className="flex h-full flex-col px-3 py-4">
      <div className="explorer-title">{t('sidebar:explorer')}</div>
      <WorkspacePicker />
      {state.workspace === 'local' ? <FileTreePanel /> : <CloudExplorer />}
    </div>
  );
};
