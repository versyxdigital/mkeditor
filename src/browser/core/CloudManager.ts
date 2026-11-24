import type {
  CloudCommand,
  CloudWriteError,
  CloudResponse,
  CloudState,
  DriveItem,
  RemoteDocument,
} from '../../app/interfaces/Cloud';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { FileManager } from './FileManager';
import { t } from '../i18n';
import { confirmExternal, openPromptExternal } from '../prompts';

interface Location {
  id: string;
  name: string;
  driveId?: string;
  shared?: boolean;
}
export interface CloudSnapshot extends CloudState {
  movePicker?: {
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
      canEdit: (document) => this.canEdit(document),
      save: async ({ document, content, operationId }) => {
        const result = await this.request({
          action: 'save',
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
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<CloudSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private onState(state: CloudState) {
    if (state.revision < this.snapshot.revision) return;
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
    if (
      incoming?.status === 'connected' &&
      (current?.status !== 'connected' ||
        current.accountId !== incoming.accountId)
    )
      void this.browse([{ id: 'root', name: 'my_drive' }]);
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
  async run(command: CloudCommand): Promise<boolean> {
    if (
      command.action === 'connect' ||
      (command.action === 'add' && command.authorize)
    )
      command = {
        ...command,
        copy: {
          title: t('cloud:return_to_app'),
          accepted: t('cloud:callback_body'),
          cancelled: t('cloud:error_cancelled'),
          close: t('cloud:close_tab'),
          invalid: t('cloud:invalid_callback'),
        },
      };
    const id = 'connectionId' in command ? command.connectionId : 'settings';
    this.update({ busy: [...this.snapshot.busy, id], error: undefined });
    try {
      const response = await this.request(command);
      if (
        command.action === 'add' &&
        command.authorize &&
        response.connectionId
      )
        this.selectWorkspace(response.connectionId);
      return true;
    } catch (error) {
      this.update({ error: error as CloudWriteError });
      return false;
    } finally {
      const busy = [...this.snapshot.busy];
      const index = busy.indexOf(id);
      if (index >= 0) busy.splice(index, 1);
      this.update({ busy });
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
    if (workspace !== 'local')
      void this.browse([{ id: 'root', name: 'my_drive' }]);
  }
  async browse(folders = this.snapshot.folders, append = false) {
    if (this.snapshot.workspace === 'local') return;
    const connectionId = this.snapshot.workspace;
    const generation = ++this.browseGeneration;
    const last = folders[folders.length - 1] ?? {
      id: 'root',
      name: 'my_drive',
    };
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
        this.update({ error: error as CloudWriteError });
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
        this.update({ error: error as CloudWriteError });
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
          name: t('cloud:compare'),
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
          title: t('cloud:reload'),
          description: t('cloud:reload_confirm'),
          confirmLabel: t('cloud:reload'),
          cancelLabel: t('cloud:cancel'),
          destructive: true,
        }))
      )
        return;
      // A confirmation never authorizes discarding edits made while the request/dialog was open.
      if (
        model.getAlternativeVersionId() !== version ||
        this.files.models.get(path) !== model
      ) {
        this.update({ error: 'conflict' });
        return;
      }
      this.files.reloadRemoteDocument(path, result.document);
    } catch (error) {
      this.update({ error: error as CloudWriteError });
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
        title: t(copy ? 'cloud:save_copy' : 'cloud:new_file'),
        input: { defaultValue: t('cloud:new_file_name') },
        buttons: [
          { id: 'cancel', label: t('cloud:cancel') },
          { id: 'confirm', label: t('cloud:create'), variant: 'primary' },
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
      if (this.snapshot.workspace === connection.id) void this.browse();
    } catch (error) {
      this.update({
        error: error as CloudWriteError,
        ...(error === 'unconfirmed' ? { pendingCreate } : {}),
      });
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
    this.update({ busy: [...this.snapshot.busy, 'create'], error: undefined });
    try {
      const result = await this.request({ action: 'reconcile', ...pending });
      if (!result.document) throw 'unconfirmed';
      this.files.openRemoteDocument(result.document);
      this.update({ pendingCreate: undefined });
      if (this.snapshot.workspace === pending.connectionId) void this.browse();
    } catch (error) {
      this.update({ error: error as CloudWriteError });
    } finally {
      this.update({ busy: this.snapshot.busy.filter((id) => id !== 'create') });
    }
  }

  async createFolder(destination?: DriveItem): Promise<void> {
    if (!this.canCreate()) return;
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
        title: t('cloud:new_folder'),
        input: { defaultValue: t('cloud:new_folder_name') },
        buttons: [
          { id: 'cancel', label: t('cloud:cancel') },
          { id: 'confirm', label: t('cloud:create'), variant: 'primary' },
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
        if (this.snapshot.workspace === connection.id) void this.browse();
      } catch (error) {
        if (error === 'unconfirmed') this.update({ pendingItem });
        throw error;
      }
    } catch (error) {
      this.update({
        error:
          typeof error === 'string' ? (error as CloudWriteError) : 'cancelled',
      });
    } finally {
      this.update({
        creating: undefined,
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }

  canMove(item: DriveItem): boolean {
    if (
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
    void this.browseMove([{ id: 'root', name: 'my_drive' }]);
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
      this.update({ movePicker: undefined });
      if (this.snapshot.workspace === picker.connectionId) void this.browse();
    } catch (error) {
      const code = error as CloudWriteError;
      this.update({
        ...(code === 'unconfirmed'
          ? { pendingItem, movePicker: undefined, error: code }
          : {
              movePicker: this.snapshot.movePicker
                ? { ...this.snapshot.movePicker, moving: false, error: code }
                : undefined,
            }),
      });
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }

  async reconcileItem(): Promise<void> {
    const pending = this.snapshot.pendingItem;
    if (!pending || this.snapshot.busy.includes('organize')) return;
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
      this.update({ pendingItem: undefined });
      if (this.snapshot.workspace === pending.connectionId) void this.browse();
    } catch (error) {
      this.update({ error: error as CloudWriteError });
    } finally {
      this.update({
        busy: this.snapshot.busy.filter((id) => id !== 'organize'),
      });
    }
  }
  dispose() {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject('cancelled');
    });
    this.pending.clear();
    this.listeners.clear();
  }
}
