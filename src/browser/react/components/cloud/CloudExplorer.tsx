import * as React from 'react';
import type { DriveItem } from '../../../../app/interfaces/Cloud';
import { MoveDriveDocument } from './MoveDriveDocument';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../ui/context-menu';
import { useCloud } from '../../hooks/useCloud';
import { useCloudTranslation } from '../../hooks/useCloudTranslation';
import { useModals } from '../../contexts/ModalsContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useFiles } from '../../contexts/FilesContext';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import { CloudLogo } from './CloudBrand';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
  TooltipPortal,
} from '../ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const actionClass =
  'h-7 w-6 shrink-0 rounded-sm p-0 text-muted-foreground hover:text-foreground';
const menuClass = 'whitespace-nowrap text-xs';

export const WorkspacePicker: React.FC = () => {
  const { manager, state } = useCloud();
  const { openModal } = useModals();
  const { mode } = useManagers();
  const connection = state.connections.find(
    (entry) => entry.id === state.workspace,
  );
  const { t } = useCloudTranslation(connection?.provider);
  if (mode !== 'desktop' || state.connections.length === 0) return null;
  return (
    <Select
      value={connection?.id ?? 'local'}
      onValueChange={(value) => {
        if (value === 'manage-connections')
          openModal('settings', { tab: 'connections' });
        else manager?.selectWorkspace(value);
      }}
    >
      <SelectTrigger
        aria-label={t('cloud:workspace')}
        title={
          connection
            ? `${connection.name}${connection.accountName ? ` · ${connection.accountName}` : ''}`
            : t('cloud:local')
        }
        className="h-7 w-36 max-w-[28vw] min-w-0 shrink-0 gap-2 rounded-sm border-0 bg-transparent px-2 text-xs shadow-none hover:bg-hover [&>svg]:ml-0 [&>svg]:shrink-0"
      >
        {connection ? (
          <CloudLogo provider={connection?.provider} />
        ) : (
          <Icon name="folder" className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue>{connection?.name ?? t('cloud:local')}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent className="min-w-[220px] max-w-[min(320px,calc(100vw-16px))]">
        <SelectItem value="local" className="text-xs">
          <span className="flex items-center gap-2">
            <Icon name="folder" />
            {t('cloud:local')}
          </span>
        </SelectItem>
        {state.connections.map((entry) => (
          <SelectItem
            key={entry.id}
            value={entry.id}
            textValue={`${entry.name} ${entry.accountName ?? ''}`}
            className="text-xs"
          >
            <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              <CloudLogo provider={entry.provider} />
              <span className="max-w-32 truncate">{entry.name}</span>
              <span className="max-w-40 truncate text-muted-foreground">
                {entry.accountName ?? t(`cloud:status_${entry.status}`)}
              </span>
            </span>
          </SelectItem>
        ))}
        <SelectItem
          value="manage-connections"
          className="mt-1 border-t border-subtle text-xs"
        >
          <span className="flex items-center gap-2">
            <Icon name="cog" />
            {t('cloud:manage')}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
};

export const CloudExplorer: React.FC = () => {
  const [contextItem, setContextItem] = React.useState<DriveItem>();
  const { manager, state } = useCloud();
  const { tabs, activeFile } = useFiles();
  const { openModal } = useModals();
  const connection = state.connections.find(
    (entry) => entry.id === state.workspace,
  );
  const { t } = useCloudTranslation(connection?.provider);
  const activeRemote = tabs.find((tab) => tab.path === activeFile)?.remote;
  const connected = connection?.status === 'connected';
  const location = state.folders.at(-1);
  const label = (name: string) =>
    name === 'my_drive' || name === 'shared_drives' || name === 'dropbox_root'
      ? t(`cloud:${name}`)
      : name;
  const pathLabel = state.folders
    .map((folder) => label(folder.name))
    .join(' / ');
  const manage = () => openModal('settings', { tab: 'connections' });
  const canCreate = Boolean(manager?.canCreate());
  const creating =
    state.creating?.connectionId === connection?.id &&
    state.creating?.accountId === connection?.accountId
      ? state.creating
      : undefined;
  return (
    <section
      aria-label={t('cloud:files')}
      className="flex min-h-0 min-w-0 flex-1 flex-col text-xs"
    >
      {!connected ? (
        <div className="space-y-3 px-2 py-4">
          <p role="status" className="text-muted-foreground">
            {t('cloud:disconnected')}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="max-w-full"
            onClick={manage}
          >
            <span className="truncate">{t('cloud:manage')}</span>
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-1 flex h-8 min-w-0 shrink-0 items-center border-b border-subtle">
            {state.folders.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className={actionClass}
                aria-label={t('cloud:back')}
                title={t('cloud:back')}
                onClick={() => void manager?.browse(state.folders.slice(0, -1))}
              >
                <Icon name="chevron-left" className="h-3 w-3" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-7 min-w-0 flex-1 justify-start gap-0.5 rounded-sm px-1 text-xs font-medium"
                  aria-label={t('cloud:location')}
                  title={pathLabel}
                >
                  <Icon
                    name="folder"
                    className="size-3.5 text-muted-foreground"
                  />
                  <span className="truncate">
                    {location
                      ? label(location.name)
                      : connection?.provider === 'dropbox'
                        ? 'Dropbox'
                        : t('cloud:my_drive')}
                  </span>
                  <Icon
                    name="chevron-down"
                    className="size-2.5 text-muted-foreground"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48 max-w-72">
                <DropdownMenuItem
                  className={menuClass}
                  onSelect={() =>
                    void manager?.browse([
                      {
                        id: 'root',
                        name:
                          connection?.provider === 'dropbox'
                            ? 'dropbox_root'
                            : 'my_drive',
                      },
                    ])
                  }
                >
                  <CloudLogo provider={connection?.provider} />
                  {connection?.provider === 'dropbox'
                    ? 'Dropbox'
                    : t('cloud:my_drive')}
                </DropdownMenuItem>
                {connection?.provider !== 'dropbox' && (
                  <DropdownMenuItem
                    className={menuClass}
                    onSelect={() =>
                      void manager?.browse([
                        { id: 'shared', name: 'shared_drives', shared: true },
                      ])
                    }
                  >
                    <Icon name="folder-open" />
                    {t('cloud:shared_drives')}
                  </DropdownMenuItem>
                )}
                {state.folders.length > 1 && <DropdownMenuSeparator />}
                {state.folders.slice(1).map((folder, index) => (
                  <DropdownMenuItem
                    key={folder.id}
                    className={menuClass}
                    title={folder.name}
                    onSelect={() =>
                      void manager?.browse(state.folders.slice(0, index + 2))
                    }
                  >
                    <Icon name="folder" />
                    <span className="truncate">{folder.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className={actionClass}
              disabled={!canCreate}
              aria-busy={Boolean(creating)}
              aria-label={t('cloud:new_file')}
              title={t('cloud:new_file')}
              onClick={() => void manager?.create()}
            >
              <Icon
                name={creating ? 'circle-notch' : 'file-circle-plus'}
                className={cn(
                  'size-3.5',
                  creating && 'animate-spin motion-reduce:animate-none',
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={actionClass}
              disabled={state.loading}
              aria-label={t('cloud:refresh')}
              title={t('cloud:refresh')}
              onClick={() => void manager?.browse()}
            >
              <Icon
                name="refresh"
                className={cn(
                  'size-3.5',
                  state.loading && 'animate-spin motion-reduce:animate-none',
                )}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={actionClass}
                  aria-label={t('cloud:actions')}
                  title={t('cloud:actions')}
                >
                  <Icon name="ellipsis" className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {manager?.canOrganize() && (
                  <>
                    <DropdownMenuItem
                      className={menuClass}
                      disabled={!canCreate}
                      onSelect={() => void manager?.createFolder()}
                    >
                      <Icon name="folder" />
                      {t('cloud:new_folder')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuItem
                        className={menuClass}
                        disabled={
                          !canCreate ||
                          !activeFile ||
                          !tabs.some(
                            (tab) =>
                              tab.path === activeFile && tab.kind !== 'diff',
                          )
                        }
                        onSelect={() => void manager?.create(true)}
                      >
                        <Icon name="copy" />
                        {t('cloud:save_copy')}
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent
                        side="right"
                        align="start"
                        className="max-w-72 whitespace-normal leading-relaxed"
                      >
                        {t('cloud:save_copy_help')}
                      </TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={menuClass} onSelect={manage}>
                  <Icon name="cog" />
                  {t('cloud:manage')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className="thin-scrollbars min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                tabIndex={0}
                onContextMenu={(event) => {
                  const id = (event.target as HTMLElement).closest<HTMLElement>(
                    '[data-drive-item]',
                  )?.dataset.driveItem;
                  setContextItem(state.items.find((item) => item.id === id));
                }}
              >
                {state.loading && (
                  <div
                    className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <Icon
                      name="circle-notch"
                      className="size-3.5 text-primary animate-spin motion-reduce:animate-none"
                    />
                    <span className="truncate">{t('cloud:loading')}</span>
                  </div>
                )}
                {creating && (
                  <div
                    className="flex h-8 min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground"
                    role="status"
                    title={t('cloud:creating_file', { name: creating.name })}
                  >
                    <Icon
                      name="circle-notch"
                      className="size-3.5 text-primary animate-spin motion-reduce:animate-none"
                    />
                    <span className="truncate">
                      {t('cloud:creating_file', { name: creating.name })}
                    </span>
                  </div>
                )}
                {manager?.canRecoverOperation(state.pendingCreate) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="my-1 max-w-full truncate"
                    disabled={state.busy.includes('create')}
                    onClick={() => void manager?.reconcileCreate()}
                  >
                    <span className="truncate">{t('cloud:check_create')}</span>
                  </Button>
                )}
                {manager?.canRecoverOperation(state.pendingItem) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="my-1 max-w-full truncate"
                    disabled={state.busy.includes('organize')}
                    onClick={() => void manager?.reconcileItem()}
                  >
                    {t('cloud:check_operation')}
                  </Button>
                )}
                {state.pendingOperations
                  ?.filter((operation) =>
                    manager?.canRecoverOperation(operation),
                  )
                  .map((operation) => (
                    <Button
                      key={operation.operationId}
                      size="sm"
                      variant="ghost"
                      className="flex h-8 w-full justify-start gap-2 px-2 text-xs"
                      disabled={state.busy.includes(operation.operationId)}
                      title={`${t('cloud:check_operation')} · ${operation.name ?? operation.itemId}`}
                      onClick={() =>
                        void manager?.checkRestoredOperation(operation)
                      }
                    >
                      <Icon name="refresh" className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {t('cloud:check_operation')} ·{' '}
                        {operation.name ?? operation.itemId}
                      </span>
                    </Button>
                  ))}
                {!state.loading &&
                  !state.error &&
                  !creating &&
                  state.items.length === 0 && (
                    <p
                      role="status"
                      className="truncate px-2 py-4 text-muted-foreground"
                      title={t('cloud:empty')}
                    >
                      {t('cloud:empty')}
                    </p>
                  )}
                <ul aria-label={t('cloud:files')} className="m-0 list-none p-0">
                  {state.items.map((item) => {
                    const opening = state.opening.some(
                      (operation) =>
                        operation.connectionId === connection.id &&
                        operation.accountId === connection.accountId &&
                        operation.itemId === item.id,
                    );
                    const selected =
                      activeRemote?.connectionId === connection.id &&
                      activeRemote.accountId === connection.accountId &&
                      activeRemote.item.id === item.id;
                    const details = [
                      item.name,
                      pathLabel,
                      item.modifiedTime
                        ? new Date(item.modifiedTime).toLocaleString()
                        : undefined,
                      item.id,
                    ]
                      .filter(Boolean)
                      .join('\n');
                    return (
                      <li key={item.id} data-drive-item={item.id}>
                        <button
                          type="button"
                          disabled={item.kind === 'unsupported' || opening}
                          aria-busy={opening}
                          aria-label={
                            opening
                              ? t('cloud:opening_file', { name: item.name })
                              : undefined
                          }
                          aria-current={selected ? 'page' : undefined}
                          onClick={() => void manager?.open(item)}
                          title={
                            item.kind === 'unsupported'
                              ? `${item.name}\n${t('cloud:unsupported')}`
                              : details
                          }
                          className={cn(
                            'flex h-[var(--sidebar-row-height)] w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-sm px-2 text-left text-[13px] text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-45',
                            selected &&
                              'bg-active font-medium text-foreground hover:bg-active',
                            opening && 'cursor-wait disabled:opacity-100',
                          )}
                        >
                          <Icon
                            name={
                              opening
                                ? 'circle-notch'
                                : item.kind === 'folder'
                                  ? 'folder'
                                  : 'file'
                            }
                            className={cn(
                              'size-3.5',
                              opening &&
                                'text-primary animate-spin motion-reduce:animate-none',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {item.name}
                          </span>
                          {item.kind === 'folder' && (
                            <Icon
                              name="chevron-right"
                              className="size-2.5 opacity-50"
                            />
                          )}
                        </button>
                        {opening && (
                          <span role="status" className="sr-only">
                            {t('cloud:opening_file', { name: item.name })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {state.nextPage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                    disabled={state.loading}
                    onClick={() => void manager?.browse(undefined, true)}
                  >
                    <span className="truncate">{t('cloud:load_more')}</span>
                  </Button>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-48">
              {contextItem && contextItem.kind !== 'unsupported' && (
                <>
                  <ContextMenuItem
                    className="gap-2 text-xs"
                    disabled={state.opening.some(
                      (op) => op.itemId === contextItem.id,
                    )}
                    onSelect={() => void manager?.open(contextItem)}
                  >
                    <Icon
                      name={
                        contextItem.kind === 'folder' ? 'folder-open' : 'file'
                      }
                    />
                    {t('cloud:open')}
                  </ContextMenuItem>
                  {contextItem.kind === 'markdown' &&
                    manager?.canOrganize() && (
                      <ContextMenuItem
                        className="gap-2 text-xs"
                        disabled={!manager?.canMove(contextItem)}
                        onSelect={() => manager?.startMove(contextItem)}
                      >
                        <Icon name="folder-open" />
                        {t('cloud:move_to')}
                      </ContextMenuItem>
                    )}
                  <ContextMenuSeparator />
                </>
              )}
              {(!contextItem || contextItem.kind === 'folder') && (
                <>
                  <ContextMenuItem
                    className="gap-2 text-xs"
                    disabled={!canCreate || Boolean(contextItem?.driveId)}
                    onSelect={() => void manager?.create(false, contextItem)}
                  >
                    <Icon name="file-circle-plus" />
                    {t('cloud:new_file')}
                  </ContextMenuItem>
                  {manager?.canOrganize() && (
                    <ContextMenuItem
                      className="gap-2 text-xs"
                      disabled={!canCreate || Boolean(contextItem?.driveId)}
                      onSelect={() => void manager?.createFolder(contextItem)}
                    >
                      <Icon name="folder" />
                      {t('cloud:new_folder')}
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem
                className="gap-2 text-xs"
                disabled={state.loading}
                onSelect={() => void manager?.browse()}
              >
                <Icon name="refresh" />
                {t('cloud:refresh')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <MoveDriveDocument />
        </>
      )}
    </section>
  );
};
