import * as React from 'react';
import { useCloud } from '../../hooks/useCloud';
import { useTranslation } from '../../hooks/useTranslation';
import { useModals } from '../../contexts/ModalsContext';
import { useManagers } from '../../contexts/ManagersContext';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

export const WorkspacePicker: React.FC = () => {
  const { manager, state } = useCloud();
  const { t } = useTranslation();
  const { openModal } = useModals();
  const { mode } = useManagers();
  if (mode !== 'desktop') return null;
  return (
    <div className="my-2 space-y-1">
      <Select
        value={
          state.connections.some((entry) => entry.id === state.workspace)
            ? state.workspace
            : 'local'
        }
        onValueChange={(value) => manager?.selectWorkspace(value)}
      >
        <SelectTrigger
          aria-label={t('cloud:workspace')}
          className="h-8 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">{t('cloud:local')}</SelectItem>
          {state.connections.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              {connection.name}
              {connection.accountName ? ` · ${connection.accountName}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        onClick={() => openModal('settings', { tab: 'connections' })}
      >
        {t('cloud:manage')}
      </Button>
    </div>
  );
};

export const CloudExplorer: React.FC = () => {
  const { manager, state } = useCloud();
  const { t } = useTranslation();
  const { openModal } = useModals();
  const connection = state.connections.find(
    (entry) => entry.id === state.workspace,
  );
  const connected = connection?.status === 'connected';
  const location = state.folders[state.folders.length - 1];
  return (
    <section
      aria-label={t('cloud:workspace')}
      className="min-w-0 space-y-2 text-xs"
    >
      {!connected ? (
        <div className="space-y-2 py-3">
          <p role="status">{t('cloud:disconnected')}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openModal('settings', { tab: 'connections' })}
          >
            {t('cloud:manage')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!manager?.canCreate()}
              onClick={() => void manager?.create()}
            >
              {t('cloud:new_file')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={!manager?.canCreate()}
              onClick={() => void manager?.create(true)}
            >
              {t('cloud:save_copy')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                void manager?.browse([{ id: 'root', name: 'my_drive' }])
              }
            >
              {t('cloud:my_drive')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() =>
                void manager?.browse([
                  { id: 'shared', name: 'shared_drives', shared: true },
                ])
              }
            >
              {t('cloud:shared_drives')}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={state.folders.length < 2}
              aria-label={t('cloud:back')}
              onClick={() => void manager?.browse(state.folders.slice(0, -1))}
            >
              <Icon name="chevron-left" />
            </Button>
            <span
              className="min-w-0 flex-1 truncate"
              title={state.folders
                .map((folder) =>
                  folder.name === 'my_drive' || folder.name === 'shared_drives'
                    ? t(`cloud:${folder.name}`)
                    : folder.name,
                )
                .join(' / ')}
            >
              {location?.name === 'my_drive' ||
              location?.name === 'shared_drives'
                ? t(`cloud:${location.name}`)
                : location?.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={t('cloud:refresh')}
              disabled={state.loading}
              onClick={() => void manager?.browse()}
            >
              <Icon name="sync" />
            </Button>
          </div>
          {state.loading && <p role="status">{t('cloud:loading')}</p>}
          {state.error && (
            <p role="alert" className="break-words text-destructive">
              {t(`cloud:error_${state.error}`)}
            </p>
          )}
          {state.pendingCreate && (
            <Button
              size="sm"
              variant="outline"
              disabled={state.busy.includes('create')}
              onClick={() => void manager?.reconcileCreate()}
            >
              {t('cloud:check_create')}
            </Button>
          )}
          {!state.loading && !state.error && state.items.length === 0 && (
            <p role="status" className="py-3 text-muted-foreground">
              {t('cloud:empty')}
            </p>
          )}
          <ul className="space-y-1" aria-label={t('cloud:files')}>
            {state.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.kind === 'unsupported'}
                  onClick={() => void manager?.open(item)}
                  className="flex min-h-[30px] w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  title={
                    item.kind === 'unsupported'
                      ? t('cloud:unsupported')
                      : `${item.name} · ${item.id}`
                  }
                >
                  <Icon
                    name={item.kind === 'folder' ? 'folder' : 'file'}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    {item.kind !== 'folder' && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {item.modifiedTime
                          ? new Date(item.modifiedTime).toLocaleString()
                          : item.id}{' '}
                        · {item.id.slice(-6)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {state.nextPage && (
            <Button
              size="sm"
              variant="outline"
              disabled={state.loading}
              onClick={() => void manager?.browse(undefined, true)}
            >
              {t('cloud:load_more')}
            </Button>
          )}
        </>
      )}
    </section>
  );
};
