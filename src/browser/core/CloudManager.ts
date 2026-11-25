import type {
  CloudCommand,
  CloudConnection,
  CloudWriteError,
  CloudResponse,
  CloudState,
  DriveItem,
  RemoteDocument,
} from '../../app/interfaces/Cloud';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { FileManager } from './FileManager';
import { t } from '../i18n';
import { cloudMessageKey } from '../cloudLabels';
import type { CloudProviderId } from '../../app/interfaces/Cloud';
import { confirmExternal, openPromptExternal } from '../prompts';
import { sonnerToast } from '../notify';
import { providerName } from '../../app/interfaces/Cloud';

interface Location {
  id: string;
  name: string;
  driveId?: string;
  shared?: boolean;
}
export interface CloudSnapshot extends CloudState {
  movePicker?: {
    provider?: CloudProviderId;
    connectionId: string;
    accountId: string;
    item: DriveItem;
    sourceFolderId: string;
    folders: Location[];
    items: DriveItem[];
    nextPage?: string;
    loading: boolean;
    moving: boolean;
    error?: CloudWriteError;
  };
  pendingItem?: {
    provider?: CloudProviderId;
    connectionId: string;
    accountId: string;
    operationId: string;
    item?: DriveItem;
  };
  opening: {
    id: number;
    connectionId: string;
    accountId: string;
    itemId: string;
  }[];
  creating?: {
    connectionId: string;
    accountId: string;
    folderId: string;
    name: string;
  };
  workspace: string;
  folders: Location[];
  items: DriveItem[];
  nextPage?: string;
  loading: boolean;
  error?: CloudWriteError;
  pendingCreate?: {
    connectionId: string;
    accountId: string;
    operationId: string;
  };
  busy: string[];
}
export const EMPTY_CLOUD: CloudSnapshot = {
  revision: 0,
  connections: [],
  secureStorage: false,
  googleDriveAvailable: false,
  workspace: 'local',
  folders: [],
  items: [],
  loading: false,
  busy: [],
  opening: [],
};

/** Renderer orchestration only; tokens and provider HTTP live in main. */
export class CloudManager {
  private snapshot: CloudSnapshot = { ...EMPTY_CLOUD };
  private listeners = new Set<() => void>();
  private nextRequest = 0;
  private nextOpen = 0;
  private browseGeneration = 0;
  private pickerGeneration = 0;
  private initialized = false;
  private disposed = false;
  private pending = new Map<
    string,
    {
      resolve: (response: Extract<CloudResponse, { ok: true }>) => void;
      reject: (error: CloudWriteError) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly bridge: ContextBridgeAPI,
    private readonly files: FileManager,
  ) {
    files.setRemoteOperations?.({
      discard: async (document, operationIds) => {
        await this.request({
          action: 'discardDocument',
          document: {
            provider: document.provider,
            connectionId: document.connectionId,
            accountId: document.accountId,
            itemId: document.item.id,
            operationIds,
          },
        });
      },
      acknowledge: (operationId) => {
        void this.request({ action: 'acknowledge', operationId }).catch(
          () => {},
        );
      },
      canCheck: (document) =>
        this.snapshot.connections.some(
          (entry) =>
            entry.id === document.connectionId &&
            entry.accountId === document.accountId &&
            entry.status === 'connected',
        ),
      check: async (document) => {
        const response = await this.request({
          action: 'open',
          connectionId: document.connectionId,
          accountId: document.accountId,
          itemId: document.item.id,
        });
        if (!response.document) throw 'network';
        return response.document;
      },
      canEdit: (document) => this.canEdit(document),
      save: async ({ document, content, operationId, epoch, sequence }) => {
        const result = await this.request({
          action: 'save',
          epoch,
          sequence,
          name: document.item.name,
          connectionId: document.connectionId,
          accountId: document.accountId,
          itemId: document.item.id,
          validator: document.item.validator ?? '',
          content,
          operationId,
        });
        if (!result.document) throw 'unconfirmed';
        return result.document;
      },
      reconcile: async ({ document, operationId }) => {
        const result = await this.request({
          action: 'reconcile',
          connectionId: document.connectionId,
          accountId: document.accountId,
          operationId,
        });
        if (!result.document) throw 'unconfirmed';
        return result.document;
      },
    });
    bridge.receive('from:cloud:state', (state: CloudState) =>
      this.onState(state),
    );
    bridge.receive('from:cloud:result', (response: CloudResponse) => {
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.requestId);
      if (response.ok) {
        this.onState(response.state);
        pending.resolve(response);
      } else pending.reject(response.error);
    });
  }
  private label(
    key: string,
    provider: CloudProviderId | undefined = this.snapshot.connections.find(
      (c) => c.id === this.snapshot.workspace,
    )?.provider,
  ): string {
    return t(cloudMessageKey(key, provider));
  }
  private rootFolder(workspace = this.snapshot.workspace): Location {
    return {
      id: 'root',
      name:
        this.snapshot.connections.find((c) => c.id === workspace)?.provider ===
        'dropbox'
          ? 'dropbox_root'
          : 'my_drive',
    };
  }
  canOrganize(): boolean {
    return this.snapshot.connections.some(
      (connection) => connection.id === this.snapshot.workspace,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<CloudSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private reportExplorerError(
    error: CloudWriteError,
    provider?: CloudProviderId,
    itemOperation = false,
  ) {
    this.update({ error });
    if (error !== 'cancelled')
      sonnerToast(
        'error',
        t(
          cloudMessageKey(
            error === 'unconfirmed' && itemOperation
              ? 'operation_unconfirmed'
              : `error_${error}`,
            provider,
          ),
        ),
      );
  }
  private onState(state: CloudState) {
    if (state.revision < this.snapshot.revision) return;
    const shouldCheck =
      state.connections.some(
        (incoming) =>
          incoming.status === 'connected' &&
          !this.snapshot.connections.some(
            (previous) =>
              previous.id === incoming.id &&
              previous.accountId === incoming.accountId &&
              previous.status === 'connected' &&
              previous.writeAccess === incoming.writeAccess,
          ),
      ) ||
      (state.pendingOperations ?? []).map((op) => op.operationId).join() !==
        (this.snapshot.pendingOperations ?? [])
          .map((op) => op.operationId)
          .join();
    const current = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    );
    const incoming = state.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    );
    if (
      this.snapshot.workspace !== 'local' &&
      (!incoming ||
        incoming.status !== 'connected' ||
        current?.accountId !== incoming.accountId)
    ) {
      this.browseGeneration++;
      this.update({
        items: [],
        nextPage: undefined,
        folders: [],
        loading: false,
        ...(!incoming ? { workspace: 'local' } : {}),
      });
    }
    this.update({
      ...state,
      pendingOperations: state.pendingOperations ?? [],
      recoveryError: state.recoveryError ?? false,
      movePicker:
        this.snapshot.movePicker &&
        state.connections.some(
          (entry) =>
            entry.id === this.snapshot.movePicker!.connectionId &&
            entry.accountId === this.snapshot.movePicker!.accountId &&
            entry.status === 'connected',
        )
          ? this.snapshot.movePicker
          : undefined,
      opening: this.snapshot.opening.filter((operation) =>
        state.connections.some(
          (connection) =>
            connection.id === operation.connectionId &&
            connection.accountId === operation.accountId &&
            connection.status === 'connected',
        ),
      ),
    });
    this.files.refreshRemoteAccess?.();
    this.files.markRecoveredMoves?.(state.pendingOperations ?? []);
    if (shouldCheck) this.files.checkRecoveredRemoteDocuments?.();
    if (
      incoming?.status === 'connected' &&
      (current?.status !== 'connected' ||
        current.accountId !== incoming.accountId)
    )
      void this.browse([this.rootFolder()]);
  }
  private request(
    command: CloudCommand,
  ): Promise<Extract<CloudResponse, { ok: true }>> {
    const requestId = `cloud-${++this.nextRequest}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          reject(
            [
              'save',
              'create',
              'reconcile',
              'createFolder',
              'move',
              'reconcileItem',
            ].includes(command.action)
              ? 'unconfirmed'
              : 'network',
          );
        },
        command.action === 'connect' ||
          (command.action === 'add' && command.authorize)
          ? 210_000
          : 65_000,
      );
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.bridge.send('to:cloud:request', { requestId, command });
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject('network');
      }
    });
  }
  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    void this.run({ action: 'state' });
  }

  async checkRestoredOperation(
    operation: import('../../app/interfaces/Cloud').CloudPendingOperation,
  ): Promise<void> {
    if (this.snapshot.busy.includes(operation.operationId)) return;
    this.update({
      busy: [...this.snapshot.busy, operation.operationId],
      error: undefined,
    });
    try {
      const response = await this.request({
        action:
          operation.kind === 'save' || operation.kind === 'create'
            ? 'reconcile'
            : 'reconcileItem',
        connectionId: operation.connectionId,
        accountId: operation.accountId,
        operationId: operation.operationId,
      });
      if (response.document) {
        this.files.openRemoteDocument(response.document);
        this.files.checkRecoveredRemoteDocuments?.();
      } else {
        if (response.item && operation.kind === 'move')
          await this.files.moveRemoteDocument(
            {
              connectionId: operation.connectionId,
              accountId: operation.accountId,
              provider: operation.provider,
              item: response.item,
            },
            async () => ({
              item: response.item!,
              previousValidator: response.previousValidator,
            }),
          );
        await this.request({
          action: 'acknowledge',
          operationId: operation.operationId,
        });
      }
      if (this.snapshot.workspace === operation.connectionId)
        void this.browse();
    } catch (error) {
      this.reportExplorerError(
        error as CloudWriteError,
        operation.provider,
        operation.kind === 'move' || operation.kind === 'createFolder',
      );
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== operation.operationId),
      });
    }
  }
  async run(command: CloudCommand): Promise<boolean> {
    if (this.disposed) return false;
    const commandConnectionId =
      'connectionId' in command ? command.connectionId : undefined;
    const previous = this.snapshot.connections.find(
      (connection) => connection.id === commandConnectionId,
    );
    const firstConnection =
      (command.action === 'add' && command.authorize) ||
      (command.action === 'connect' &&
        !command.writeAccess &&
        !previous?.hasConnected &&
        !previous?.accountId);
    const commandProvider =
      'provider' in command
        ? command.provider
        : this.snapshot.connections.find((c) => c.id === commandConnectionId)
            ?.provider;
    if (
      command.action === 'connect' ||
      (command.action === 'add' && command.authorize)
    )
      command = {
        ...command,
        copy: {
          title: this.label('return_to_app'),
          accepted: this.label('callback_body', commandProvider),
          cancelled: this.label('error_cancelled'),
          close: this.label('close_tab'),
          invalid: this.label('invalid_callback'),
        },
      };
    const id = 'connectionId' in command ? command.connectionId : 'settings';
    let introduceEditing: CloudConnection | undefined;
    this.update({ busy: [...this.snapshot.busy, id], error: undefined });
    try {
      const response = await this.request(command);
      if (
        command.action === 'add' &&
        command.authorize &&
        response.connectionId
      )
        this.selectWorkspace(response.connectionId);
      if (firstConnection) {
        const connected = this.snapshot.connections.find(
          (entry) =>
            entry.id === (response.connectionId ?? commandConnectionId),
        );
        if (connected?.status === 'connected' && !connected.writeAccess)
          introduceEditing = connected;
      }
      return true;
    } catch (error) {
      this.update({ error: error as CloudWriteError });
      return false;
    } finally {
      const busy = [...this.snapshot.busy];
      const index = busy.indexOf(id);
      if (index >= 0) busy.splice(index, 1);
      this.update({ busy });
      if (introduceEditing) void this.introduceEditing(introduceEditing);
    }
  }
  private async introduceEditing(connection: CloudConnection): Promise<void> {
    try {
      const result = await openPromptExternal({
        title: t('cloud:editing_intro_title', {
          provider: providerName(connection.provider),
        }),
        description: this.label(
          'editing_intro_description',
          connection.provider,
        ),
        buttons: [
          { id: 'cancel', label: t('cloud:later'), variant: 'secondary' },
          {
            id: 'confirm',
            label: t('cloud:enable_editing_now'),
            variant: 'primary',
          },
        ],
      });
      const current = this.snapshot.connections.find(
        (entry) => entry.id === connection.id,
      );
      if (
        result.button !== 'confirm' ||
        this.disposed ||
        current?.status !== 'connected' ||
        current.accountId !== connection.accountId ||
        current.writeAccess ||
        this.snapshot.busy.includes(connection.id)
      )
        return;
      await this.run({
        action: 'connect',
        connectionId: connection.id,
        writeAccess: true,
      });
    } catch {
      // Dismissing an unavailable prompt leaves the established read-only connection intact.
    }
  }
  selectWorkspace(workspace: string) {
    this.browseGeneration++;
    this.update({
      workspace,
      items: [],
      folders: [],
      nextPage: undefined,
      error: undefined,
      loading: false,
    });
    if (workspace !== 'local') void this.browse([this.rootFolder()]);
  }
  async browse(folders = this.snapshot.folders, append = false) {
    if (this.snapshot.workspace === 'local') return;
    const connectionId = this.snapshot.workspace;
    const provider = this.snapshot.connections.find(
      (entry) => entry.id === connectionId,
    )?.provider;
    const generation = ++this.browseGeneration;
    const last = folders[folders.length - 1] ?? this.rootFolder();
    const page = append ? this.snapshot.nextPage : undefined;
    this.update({
      loading: true,
      error: undefined,
      folders,
      ...(append ? {} : { items: [], nextPage: undefined }),
    });
    try {
      const result = await this.request(
        last.shared
          ? { action: 'drives', connectionId, page }
          : {
              action: 'list',
              connectionId,
              folderId: last.id,
              driveId: last.driveId,
              page,
            },
      );
      if (generation !== this.browseGeneration) return;
      const items = append
        ? [...this.snapshot.items, ...(result.page?.items ?? [])]
        : (result.page?.items ?? []);
      this.update({
        items: items.filter(
          (entry, index) =>
            items.findIndex((other) => other.id === entry.id) === index,
        ),
        nextPage: result.page?.nextPage,
      });
    } catch (error) {
      if (generation === this.browseGeneration)
        this.reportExplorerError(error as CloudWriteError, provider);
    } finally {
      if (generation === this.browseGeneration) this.update({ loading: false });
    }
  }
  async open(item: DriveItem) {
    if (item.kind === 'folder') {
      await this.browse([
        ...this.snapshot.folders,
        { id: item.id, name: item.name, driveId: item.driveId },
      ]);
      return;
    }
    if (item.kind !== 'markdown') return;
    const connectionId = this.snapshot.workspace;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === connectionId,
    );
    const accountId = connection?.accountId;
    if (!accountId || connection.status !== 'connected') return;
    if (
      this.snapshot.opening.some(
        (operation) =>
          operation.connectionId === connectionId &&
          operation.accountId === accountId &&
          operation.itemId === item.id,
      )
    )
      return;
    const opening = {
      id: ++this.nextOpen,
      connectionId,
      accountId,
      itemId: item.id,
    };
    this.update({
      error: undefined,
      opening: [...this.snapshot.opening, opening],
    });
    try {
      const response = await this.request({
        action: 'open',
        connectionId,
        itemId: item.id,
        accountId,
      });
      const current = this.snapshot.connections.find(
        (entry) => entry.id === connectionId,
      );
      if (
        this.snapshot.opening.some(
          (operation) => operation.id === opening.id,
        ) &&
        response.document &&
        current?.status === 'connected' &&
        current.accountId === accountId &&
        response.document.accountId === accountId
      )
        this.files.openRemoteDocument(response.document);
    } catch (error) {
      if (
        this.snapshot.opening.some((operation) => operation.id === opening.id)
      )
        this.reportExplorerError(error as CloudWriteError, connection.provider);
    } finally {
      this.update({
        opening: this.snapshot.opening.filter(
          (operation) => operation.id !== opening.id,
        ),
      });
    }
  }
  canEdit(document: Omit<RemoteDocument, 'content'>): boolean {
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === document.connectionId,
    );
    return Boolean(
      connection?.status === 'connected' &&
      connection.writeAccess &&
      connection.accountId === document.accountId &&
      document.item.editable,
    );
  }
  async reload(path: string, compare = false): Promise<void> {
    const tab = this.files.tabs.get(path);
    const remote = tab?.remote;
    const model = this.files.models.get(path);
    if (!remote || !model || this.files.hasUnconfirmedRemoteSave(path)) return;
    const version = model.getAlternativeVersionId();
    try {
      const result = await this.request({
        action: 'open',
        connectionId: remote.connectionId,
        accountId: remote.accountId,
        itemId: remote.item.id,
      });
      if (!result.document || this.files.models.get(path) !== model) return;
      if (compare) {
        this.files.openDiffTab({
          id: `diff://drive/${encodeURIComponent(path)}`,
          name: this.label('compare'),
          original: result.document.content,
          modified: model.getValue(),
          sourcePath: path,
        });
        return;
      }
      if (
        this.files.getSnapshot().tabs.find((entry) => entry.path === path)
          ?.dirty &&
        !(await confirmExternal({
          title: this.label('reload'),
          description: this.label('reload_confirm'),
          confirmLabel: this.label('reload'),
          cancelLabel: this.label('cancel'),
          destructive: true,
        }))
      )
        return;
      // A confirmation never authorizes discarding edits made while the request/dialog was open.
      if (
        model.getAlternativeVersionId() !== version ||
        this.files.models.get(path) !== model
      ) {
        this.reportExplorerError('conflict', remote.provider);
        return;
      }
      this.files.reloadRemoteDocument(path, result.document);
    } catch (error) {
      this.reportExplorerError(error as CloudWriteError, remote.provider);
    }
  }
  canCreate(): boolean {
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    );
    const folder = this.snapshot.folders.at(-1);
    return Boolean(
      connection?.status === 'connected' &&
      connection.accountId &&
      connection.writeAccess &&
      folder &&
      !folder.driveId &&
      !folder.shared &&
      !this.snapshot.pendingCreate &&
      !this.snapshot.pendingItem &&
      !this.snapshot.busy.includes('organize') &&
      !this.snapshot.busy.includes('create'),
    );
  }
  async create(copy = false, destination?: DriveItem): Promise<void> {
    if (!this.canCreate()) return;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    )!;
    const folderId =
      destination?.kind === 'folder'
        ? destination.id
        : this.snapshot.folders.at(-1)!.id;
    const source = this.files.activeFile
      ? this.files.models.get(this.files.activeFile)
      : undefined;
    if (copy && !source) return;
    // Freeze the source and destination before prompting; copying never marks the source saved.
    const content = copy ? source!.getValue() : '';
    this.update({ busy: [...this.snapshot.busy, 'create'], error: undefined });
    let result: Awaited<ReturnType<typeof openPromptExternal>>;
    try {
      result = await openPromptExternal({
        title: this.label(copy ? 'save_copy' : 'new_file'),
        input: { defaultValue: this.label('new_file_name') },
        buttons: [
          { id: 'cancel', label: this.label('cancel') },
          { id: 'confirm', label: this.label('create'), variant: 'primary' },
        ],
      });
    } catch {
      this.update({
        error: 'cancelled',
        busy: this.snapshot.busy.filter((id) => id !== 'create'),
      });
      return;
    }
    if (result.button !== 'confirm') {
      this.update({ busy: this.snapshot.busy.filter((id) => id !== 'create') });
      return;
    }
    const name = result.value ?? '';
    const pendingCreate = {
      connectionId: connection.id,
      accountId: connection.accountId!,
      operationId: `create-${Date.now()}-${++this.nextRequest}`,
    };
    this.update({
      creating: {
        connectionId: connection.id,
        accountId: connection.accountId!,
        folderId,
        name,
      },
      error: undefined,
    });
    try {
      const result = await this.request({
        action: 'create',
        ...pendingCreate,
        folderId,
        name,
        content,
      });
      if (!result.document) throw 'unconfirmed';
      this.files.openRemoteDocument(result.document);
      sonnerToast(
        'success',
        t('cloud:created_file', { name: result.document.item.name }),
      );
      if (this.snapshot.workspace === connection.id) void this.browse();
    } catch (error) {
      if (error === 'unconfirmed') this.update({ pendingCreate });
      this.reportExplorerError(error as CloudWriteError, connection.provider);
      // Keep a local recovery buffer if the create outcome is unknown.
      if (error === 'unconfirmed' && content)
        this.files.createLocalCopy(content);
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== 'create'),
        creating: undefined,
      });
    }
  }
  async reconcileCreate(): Promise<void> {
    const pending = this.snapshot.pendingCreate;
    if (!pending || this.snapshot.busy.includes('create')) return;
    const provider = this.snapshot.connections.find(
      (entry) => entry.id === pending.connectionId,
    )?.provider;
    this.update({ busy: [...this.snapshot.busy, 'create'], error: undefined });
    try {
      const result = await this.request({ action: 'reconcile', ...pending });
      if (!result.document) throw 'unconfirmed';
      this.files.openRemoteDocument(result.document);
      this.update({ pendingCreate: undefined });
      sonnerToast(
        'success',
        t('cloud:created_file', { name: result.document.item.name }),
      );
      if (this.snapshot.workspace === pending.connectionId) void this.browse();
    } catch (error) {
      if (error === 'not_applied') this.update({ pendingCreate: undefined });
      this.reportExplorerError(error as CloudWriteError, provider);
    } finally {
      this.update({ busy: this.snapshot.busy.filter((id) => id !== 'create') });
    }
  }

  async createFolder(destination?: DriveItem): Promise<void> {
    if (!this.canOrganize() || !this.canCreate()) return;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    )!;
    const folderId =
      destination?.kind === 'folder'
        ? destination.id
        : this.snapshot.folders.at(-1)!.id;
    this.update({
      busy: [...this.snapshot.busy, 'organize'],
      error: undefined,
    });
    try {
      const prompt = await openPromptExternal({
        title: this.label('new_folder'),
        input: { defaultValue: this.label('new_folder_name') },
        buttons: [
          { id: 'cancel', label: this.label('cancel') },
          { id: 'confirm', label: this.label('create'), variant: 'primary' },
        ],
      });
      if (prompt.button !== 'confirm') return;
      const name = prompt.value?.trim() ?? '';
      if (
        !name ||
        /[/\\]/.test(name) ||
        [...name].some((character) => character.charCodeAt(0) < 32) ||
        name === '.' ||
        name === '..' ||
        name.length > 255
      )
        throw 'configuration';
      const pendingItem = {
        provider: connection.provider,
        connectionId: connection.id,
        accountId: connection.accountId!,
        operationId: `folder-${Date.now()}-${++this.nextRequest}`,
      };
      this.update({ creating: { ...pendingItem, folderId, name } });
      try {
        const result = await this.request({
          action: 'createFolder',
          ...pendingItem,
          folderId,
          name,
        });
        if (!result.item) throw 'unconfirmed';
        void this.request({
          action: 'acknowledge',
          operationId: pendingItem.operationId,
        }).catch(() => {});
        if (this.snapshot.workspace === connection.id) void this.browse();
      } catch (error) {
        if (error === 'unconfirmed') this.update({ pendingItem });
        throw error;
      }
    } catch (error) {
      this.reportExplorerError(
        typeof error === 'string' ? (error as CloudWriteError) : 'cancelled',
        connection.provider,
        true,
      );
    } finally {
      this.update({
        creating: undefined,
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }

  canMove(item: DriveItem): boolean {
    if (
      !this.canOrganize() ||
      !this.canCreate() ||
      item.kind !== 'markdown' ||
      item.driveId ||
      item.shortcut ||
      this.snapshot.opening.some(
        (op) =>
          op.itemId === item.id && op.connectionId === this.snapshot.workspace,
      )
    )
      return false;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    )!;
    const tab = [...this.files.tabs.values()].find(
      (tab) =>
        tab.remote?.connectionId === connection.id &&
        tab.remote.accountId === connection.accountId &&
        tab.remote.item.id === item.id,
    );
    return !tab || !this.files.hasUnconfirmedRemoteSave(tab.path);
  }

  startMove(item: DriveItem) {
    if (!this.canMove(item)) return;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    )!;
    this.update({
      movePicker: {
        provider: connection.provider,
        connectionId: connection.id,
        accountId: connection.accountId!,
        item,
        sourceFolderId: this.snapshot.folders.at(-1)!.id,
        folders: [],
        items: [],
        loading: false,
        moving: false,
      },
    });
    void this.browseMove([this.rootFolder()]);
  }

  closeMove() {
    if (this.snapshot.movePicker?.moving) return;
    this.pickerGeneration++;
    this.update({ movePicker: undefined });
  }

  async browseMove(folders: Location[], append = false) {
    const picker = this.snapshot.movePicker;
    if (!picker || picker.moving) return;
    const generation = ++this.pickerGeneration;
    this.update({
      movePicker: {
        ...picker,
        folders,
        loading: true,
        error: undefined,
        ...(append ? {} : { items: [], nextPage: undefined }),
      },
    });
    try {
      const result = await this.request({
        action: 'list',
        connectionId: picker.connectionId,
        folderId: folders.at(-1)!.id,
        page: append ? picker.nextPage : undefined,
      });
      if (generation !== this.pickerGeneration || !this.snapshot.movePicker)
        return;
      this.update({
        movePicker: {
          ...this.snapshot.movePicker,
          loading: false,
          items: [
            ...(append ? picker.items : []),
            ...(result.page?.items ?? []),
          ].filter((item) => item.kind === 'folder' && !item.driveId),
          nextPage: result.page?.nextPage,
        },
      });
    } catch (error) {
      if (generation === this.pickerGeneration && this.snapshot.movePicker)
        this.update({
          movePicker: {
            ...this.snapshot.movePicker,
            loading: false,
            error: error as CloudWriteError,
          },
        });
    }
  }

  async confirmMove(): Promise<void> {
    const picker = this.snapshot.movePicker;
    const destination = picker?.folders.at(-1);
    if (
      !picker ||
      picker.loading ||
      picker.moving ||
      !destination ||
      destination.id === picker.sourceFolderId ||
      this.snapshot.pendingItem
    )
      return;
    const pendingItem = {
      provider: picker.provider,
      connectionId: picker.connectionId,
      accountId: picker.accountId,
      operationId: `move-${Date.now()}-${++this.nextRequest}`,
      item: picker.item,
    };
    this.update({
      movePicker: { ...picker, moving: true, error: undefined },
      busy: [...this.snapshot.busy, 'organize'],
    });
    try {
      await this.files.moveRemoteDocument(
        { ...pendingItem, item: picker.item },
        async () => {
          const result = await this.request({
            action: 'move',
            connectionId: picker.connectionId,
            accountId: picker.accountId,
            itemId: picker.item.id,
            sourceFolderId: picker.sourceFolderId,
            folderId: destination.id,
            operationId: pendingItem.operationId,
          });
          if (!result.item) throw 'unconfirmed';
          return {
            item: result.item,
            previousValidator: result.previousValidator,
          };
        },
      );
      void this.request({
        action: 'acknowledge',
        operationId: pendingItem.operationId,
      }).catch(() => {});
      this.update({ movePicker: undefined });
      if (this.snapshot.workspace === picker.connectionId) void this.browse();
    } catch (error) {
      const code = error as CloudWriteError;
      this.update({
        ...(code === 'unconfirmed'
          ? { pendingItem, movePicker: undefined }
          : {
              movePicker: this.snapshot.movePicker
                ? { ...this.snapshot.movePicker, moving: false, error: code }
                : undefined,
            }),
      });
      if (code === 'unconfirmed')
        this.reportExplorerError(code, picker.provider, true);
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }

  async reconcileItem(): Promise<void> {
    const pending = this.snapshot.pendingItem;
    if (!pending || this.snapshot.busy.includes('organize')) return;
    const provider = this.snapshot.connections.find(
      (entry) => entry.id === pending.connectionId,
    )?.provider;
    this.update({
      busy: [...this.snapshot.busy, 'organize'],
      error: undefined,
    });
    try {
      const check = async () => {
        const result = await this.request({
          action: 'reconcileItem',
          connectionId: pending.connectionId,
          accountId: pending.accountId,
          operationId: pending.operationId,
        });
        if (!result.item) throw 'unconfirmed';
        return {
          item: result.item,
          previousValidator: result.previousValidator,
        };
      };
      if (pending.item)
        await this.files.moveRemoteDocument(
          { ...pending, item: pending.item },
          check,
        );
      else await check();
      void this.request({
        action: 'acknowledge',
        operationId: pending.operationId,
      }).catch(() => {});
      this.update({ pendingItem: undefined });
      if (this.snapshot.workspace === pending.connectionId) void this.browse();
    } catch (error) {
      if (error === 'not_applied') {
        if (pending.item)
          this.files.clearUnappliedMove?.(
            pending.connectionId,
            pending.accountId,
            pending.item.id,
            pending.provider,
          );
        this.update({ pendingItem: undefined });
      }
      this.reportExplorerError(error as CloudWriteError, provider, true);
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }
  dispose() {
    this.disposed = true;
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject('cancelled');
    });
    this.pending.clear();
    this.listeners.clear();
  }
}
