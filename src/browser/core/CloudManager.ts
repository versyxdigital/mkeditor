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
};

/** Renderer orchestration only; tokens and provider HTTP live in main. */
export class CloudManager {
  private snapshot: CloudSnapshot = { ...EMPTY_CLOUD };
  private listeners = new Set<() => void>();
  private nextRequest = 0;
  private browseGeneration = 0;
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
    this.update(state);
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
            ['save', 'create', 'reconcile'].includes(command.action)
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
    const accountId = this.snapshot.connections.find(
      (entry) => entry.id === connectionId,
    )?.accountId;
    this.update({ error: undefined });
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
        response.document &&
        current?.status === 'connected' &&
        current.accountId === accountId &&
        response.document.accountId === accountId
      )
        this.files.openRemoteDocument(response.document);
    } catch (error) {
      this.update({ error: error as CloudWriteError });
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
      !this.snapshot.busy.includes('create'),
    );
  }
  async create(copy = false): Promise<void> {
    if (!this.canCreate()) return;
    const connection = this.snapshot.connections.find(
      (entry) => entry.id === this.snapshot.workspace,
    )!;
    const folderId = this.snapshot.folders.at(-1)!.id;
    const source = this.files.activeFile
      ? this.files.models.get(this.files.activeFile)
      : undefined;
    if (copy && !source) return;
    // Freeze the source and destination before prompting; copying never marks the source saved.
    const content = copy ? source!.getValue() : '';
    this.update({ busy: [...this.snapshot.busy, 'create'], error: undefined });
    const result = await openPromptExternal({
      title: t(copy ? 'cloud:save_copy' : 'cloud:new_file'),
      input: { defaultValue: t('cloud:new_file_name') },
      buttons: [
        { id: 'cancel', label: t('cloud:cancel') },
        { id: 'confirm', label: t('cloud:create'), variant: 'primary' },
      ],
    });
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
    this.update({ busy: [...this.snapshot.busy, 'create'], error: undefined });
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
      this.update({ busy: this.snapshot.busy.filter((id) => id !== 'create') });
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
  dispose() {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject('cancelled');
    });
    this.pending.clear();
    this.listeners.clear();
  }
}
