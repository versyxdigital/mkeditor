import * as React from 'react';
import { useFiles } from '../../contexts/FilesContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useCloud } from '../../hooks/useCloud';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { useModals } from '../../contexts/ModalsContext';

export const RemoteDocumentNotice: React.FC = () => {
  const { tabs, activeFile } = useFiles();
  const { fileManager } = useManagers();
  const { state, manager } = useCloud();
  const { openModal } = useModals();
  const { t } = useTranslation();
  const tab = tabs.find((tab) => tab.path === activeFile);
  const remote = tab?.remote;
  if (!remote) return null;
  const connection = state.connections.find(
    (entry) => entry.id === remote.connectionId,
  );
  const connected =
    connection?.status === 'connected' &&
    connection.accountId === remote.accountId;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle bg-muted px-3 py-1 text-xs"
      role="status"
    >
      <span className="min-w-0 flex-1">
        {remote.connectionName} ·{' '}
        {t(manager?.canEdit(remote) ? 'cloud:editable' : 'cloud:read_only')}
        {!connected && ` · ${t('cloud:disconnected')}`}
        {connected &&
          remote.item.readOnlyReason === 'shared-drive' &&
          ` · ${t('cloud:shared_read_only')}`}
        {tab?.remoteSave && (
          <span className="block">
            {t(`cloud:save_${tab.remoteSave.phase}`)}
            {tab.remoteSave.error &&
              ` ${t(`cloud:error_${tab.remoteSave.error}`)}`}
          </span>
        )}
      </span>
      {connected && !connection?.writeAccess && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => openModal('settings', { tab: 'connections' })}
        >
          {t('cloud:enable_editing')}
        </Button>
      )}
      {connected &&
        !['saving', 'unconfirmed'].includes(tab?.remoteSave?.phase ?? '') && (
          <>
            {tab?.remoteSave?.phase === 'conflict' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void manager?.reload(activeFile!, true)}
              >
                {t('cloud:compare')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void manager?.reload(activeFile!)}
            >
              {t('cloud:reload')}
            </Button>
          </>
        )}
      {tab?.remoteSave?.phase === 'unconfirmed' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={!connected}
          onClick={() => void fileManager?.saveTab(activeFile!)}
        >
          {t('cloud:check_save')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          if (activeFile) fileManager?.copyRemoteToLocal(activeFile);
        }}
      >
        {t('cloud:local_copy')}
      </Button>
    </div>
  );
};
