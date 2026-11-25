import * as React from 'react';
import { useFiles } from '../../contexts/FilesContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useCloud } from '../../hooks/useCloud';
import { useCloudTranslation } from '../../hooks/useCloudTranslation';
import { Button } from '../ui/button';
import { Icon } from '../Icon';

/** A fixed-height recovery bar only when a remote document needs attention. */
export const RemoteDocumentNotice: React.FC = () => {
  const { tabs, activeFile } = useFiles();
  const { fileManager } = useManagers();
  const { state, manager } = useCloud();
  const { openModal } = useModals();
  const tab = tabs.find((entry) => entry.path === activeFile);
  const { t } = useCloudTranslation(tab?.remote?.provider);
  const remote = tab?.remote;
  if (!remote || !activeFile) return null;
  const connection = state.connections.find(
    (entry) => entry.id === remote.connectionId,
  );
  const connected =
    connection?.status === 'connected' &&
    connection.accountId === remote.accountId;
  const phase = tab.remoteSave?.phase;
  const recovery = tab.remoteRecovery;
  if (
    connected &&
    phase !== 'conflict' &&
    phase !== 'failed' &&
    phase !== 'unconfirmed' &&
    !recovery
  )
    return null;
  const unknown = phase === 'unconfirmed';
  const message =
    recovery && phase !== 'conflict' && phase !== 'unconfirmed'
      ? t(
          recovery.status === 'checking'
            ? 'cloud:checking_recovery'
            : recovery.error
              ? `cloud:error_${recovery.error}`
              : 'cloud:recovered_draft',
        )
      : !connected
        ? t('cloud:disconnected')
        : unknown
          ? t('cloud:error_unconfirmed')
          : phase === 'conflict'
            ? t('cloud:error_conflict')
            : `${t('cloud:save_failed')} ${tab.remoteSave?.error ? t(`cloud:error_${tab.remoteSave.error}`) : ''}`;
  const iconClass = 'h-7 w-7 shrink-0 rounded-sm p-0 text-muted-foreground';
  return (
    <div
      className="flex h-8 min-w-0 shrink-0 items-center gap-2 whitespace-nowrap border-b border-subtle bg-sidebar px-2 text-xs"
      role="status"
    >
      <Icon name="exclamation-circle" className="size-3.5 text-destructive" />
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      {!connected ? (
        <Button
          variant="ghost"
          size="icon"
          className={iconClass}
          title={t('cloud:manage')}
          aria-label={t('cloud:manage')}
          onClick={() => openModal('settings', { tab: 'connections' })}
        >
          <Icon name="cog" className="size-3.5" />
        </Button>
      ) : unknown ? (
        <Button
          variant="ghost"
          size="icon"
          className={iconClass}
          title={t('cloud:check_save')}
          aria-label={t('cloud:check_save')}
          onClick={() => void fileManager?.saveTab(activeFile)}
        >
          <Icon name="refresh" className="size-3.5" />
        </Button>
      ) : recovery && phase !== 'conflict' ? (
        <Button
          variant="ghost"
          size="icon"
          className={iconClass}
          disabled={recovery.status === 'checking'}
          title={t('cloud:check_recovery')}
          aria-label={t('cloud:check_recovery')}
          onClick={() => void fileManager?.checkRemoteRecovery(activeFile)}
        >
          <Icon name="refresh" className="size-3.5" />
        </Button>
      ) : phase === 'conflict' ? (
        <Button
          variant="ghost"
          size="icon"
          className={iconClass}
          title={t('cloud:compare')}
          aria-label={t('cloud:compare')}
          onClick={() => void manager?.reload(activeFile, true)}
        >
          <Icon name="code" className="size-3.5" />
        </Button>
      ) : null}
      {connected && !unknown && (!recovery || phase === 'conflict') && (
        <Button
          variant="ghost"
          size="icon"
          className={iconClass}
          aria-label={t('cloud:reload')}
          title={t('cloud:reload')}
          onClick={() => void manager?.reload(activeFile)}
        >
          <Icon name="refresh" className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={iconClass}
        aria-label={t('cloud:local_copy')}
        title={t('cloud:local_copy')}
        onClick={() => fileManager?.copyRemoteToLocal(activeFile)}
      >
        <Icon name="copy" className="size-3.5" />
      </Button>
    </div>
  );
};
