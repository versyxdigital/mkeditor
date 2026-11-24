import * as React from 'react';
import { useCloud } from '../../hooks/useCloud';
import { useFiles } from '../../contexts/FilesContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { GoogleDriveLogo } from './GoogleBrand';

/** File actions stay beside the filename; normal remote editing adds no banner. */
export const RemoteDocumentMenu: React.FC = () => {
  const { tabs, activeFile } = useFiles();
  const { state, manager } = useCloud();
  const { fileManager, mode } = useManagers();
  const { openModal } = useModals();
  const { t } = useTranslation();
  const tab = tabs.find((entry) => entry.path === activeFile);
  const remote = tab?.remote;
  if (mode !== 'desktop' || !remote || !activeFile) return null;
  const connection = state.connections.find(
    (entry) => entry.id === remote.connectionId,
  );
  const connected =
    connection?.status === 'connected' &&
    connection.accountId === remote.accountId;
  const saving = tab.remoteSave?.phase === 'saving';
  const unknown = tab.remoteSave?.phase === 'unconfirmed';
  const failure = ['conflict', 'failed', 'unconfirmed'].includes(
    tab.remoteSave?.phase ?? '',
  );
  const status = !connected
    ? t('cloud:disconnected')
    : tab.remoteSave
      ? t(`cloud:save_${tab.remoteSave.phase}`)
      : t(manager?.canEdit(remote) ? 'cloud:editable' : 'cloud:read_only');
  const canReload = connected && !saving && !unknown;
  const menuClass = 'whitespace-nowrap text-xs';
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-sm p-0"
            aria-label={t('cloud:document_actions')}
            title={`Google Drive · ${status}`}
          >
            {saving ? (
              <Icon
                name="refresh"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : failure ? (
              <Icon
                name="exclamation-circle"
                className="size-3.5 text-destructive"
              />
            ) : (
              <GoogleDriveLogo />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-[calc(100vw-16px)]">
          <DropdownMenuLabel className="flex h-8 items-center gap-2 text-xs font-medium">
            <GoogleDriveLogo />
            Google Drive
          </DropdownMenuLabel>
          <div
            role="status"
            title={connected ? status : t('cloud:disconnected')}
            className="h-6 max-w-72 truncate px-3 text-xs leading-6 text-muted-foreground"
          >
            {connected ? status : t('cloud:disconnected')}
          </div>
          <DropdownMenuSeparator />
          {connected && !connection?.writeAccess && (
            <DropdownMenuItem
              className={menuClass}
              onSelect={() => openModal('settings', { tab: 'connections' })}
            >
              {t('cloud:enable_editing')}
            </DropdownMenuItem>
          )}
          {tab.remoteSave?.phase === 'conflict' && (
            <DropdownMenuItem
              className={menuClass}
              disabled={!canReload}
              onSelect={() => void manager?.reload(activeFile, true)}
            >
              <Icon name="code" />
              {t('cloud:compare')}
            </DropdownMenuItem>
          )}
          {unknown && (
            <DropdownMenuItem
              className={menuClass}
              disabled={!connected}
              onSelect={() => void fileManager?.saveTab(activeFile)}
            >
              <Icon name="refresh" />
              {t('cloud:check_save')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className={menuClass}
            disabled={!canReload}
            onSelect={() => void manager?.reload(activeFile)}
          >
            <Icon name="refresh" />
            {t('cloud:reload')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={menuClass}
            onSelect={() => fileManager?.copyRemoteToLocal(activeFile)}
          >
            <Icon name="copy" />
            {t('cloud:local_copy')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={menuClass}
            onSelect={() => openModal('settings', { tab: 'connections' })}
          >
            <Icon name="cog" />
            {t('cloud:manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {connected && !manager?.canEdit(remote) && (
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
          {t('cloud:read_only')}
        </span>
      )}
    </>
  );
};
