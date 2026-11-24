/** Public cloud contracts. Credentials never cross this boundary. */
export type CloudErrorCode =
  | 'auth'
  | 'permission'
  | 'missing'
  | 'network'
  | 'throttled'
  | 'quota'
  | 'conflict'
  | 'configuration'
  | 'unsupported'
  | 'storage'
  | 'cancelled';
export type CloudWriteError =
  | CloudErrorCode
  | 'unconfirmed'
  | 'duplicate'
  | 'not_applied'
  | 'pending_operation';

export interface CloudConnection {
  id: string;
  name: string;
  clientId: string;
  /** Google Desktop client value is public configuration, not a secret. */
  clientValue: string;
  registration?: 'mkeditor' | 'custom';
  writeAccess?: boolean;
  accountId?: string;
  accountName?: string;
  status: 'connected' | 'disconnected' | 'reauthorize' | 'connecting';
}
export interface CloudState {
  pendingOperations?: CloudPendingOperation[];
  recoveryError?: boolean;
  revision: number;
  connections: CloudConnection[];
  secureStorage: boolean;
  googleDriveAvailable: boolean;
}
export interface DriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'markdown' | 'unsupported';
  modifiedTime?: string;
  revision?: string;
  parents: string[];
  driveId?: string;
  shortcut?: boolean;
  validator?: string;
  contentRevision?: string;
  editable?: boolean;
  readOnlyReason?: 'permission' | 'shared-drive' | 'validator';
}
export interface DrivePage {
  items: DriveItem[];
  nextPage?: string;
}
export interface RemoteDocument {
  operationId?: string;
  connectionId: string;
  accountId: string;
  connectionName: string;
  item: DriveItem;
  content: string;
}

export interface RemoteTabRecovery {
  epoch?: string;
  sequence?: number;
  dirty: boolean;
  document: RemoteDocument;
  baseline: string;
  pendingSave?: { operationId: string; content: string; validator: string };
}
export interface CloudPendingOperation {
  operationId: string;
  connectionId: string;
  accountId: string;
  kind: 'save' | 'create' | 'move' | 'createFolder';
  itemId: string;
  name?: string;
}
export interface CloudCallbackCopy {
  title: string;
  accepted: string;
  cancelled: string;
  close: string;
  invalid: string;
}
export type CloudCommand =
  | { action: 'state' }
  | { action: 'acknowledge'; operationId: string }
  | {
      action: 'add';
      name: string;
      clientId?: string;
      clientValue?: string;
      authorize?: boolean;
      copy?: CloudCallbackCopy;
    }
  | { action: 'rename'; connectionId: string; name: string }
  | {
      action: 'connect';
      connectionId: string;
      copy?: CloudCallbackCopy;
      writeAccess?: boolean;
    }
  | { action: 'disconnect' | 'remove' | 'test'; connectionId: string }
  | {
      action: 'list';
      connectionId: string;
      folderId: string;
      driveId?: string;
      page?: string;
    }
  | { action: 'drives'; connectionId: string; page?: string }
  | { action: 'open'; connectionId: string; itemId: string; accountId?: string }
  | {
      action: 'save';
      epoch?: string;
      sequence?: number;
      name?: string;
      connectionId: string;
      accountId: string;
      itemId: string;
      validator: string;
      content: string;
      operationId: string;
    }
  | {
      action: 'create';
      connectionId: string;
      accountId: string;
      folderId: string;
      name: string;
      content: string;
      operationId: string;
    }
  | {
      action: 'createFolder';
      connectionId: string;
      accountId: string;
      folderId: string;
      name: string;
      operationId: string;
    }
  | {
      action: 'move';
      connectionId: string;
      accountId: string;
      itemId: string;
      sourceFolderId: string;
      folderId: string;
      operationId: string;
    }
  | {
      action: 'reconcileItem';
      connectionId: string;
      accountId: string;
      operationId: string;
    }
  | {
      action: 'reconcile';
      connectionId: string;
      accountId: string;
      operationId: string;
    };

export interface CloudRequest {
  requestId: string;
  command: CloudCommand;
}
export type CloudResponse = { requestId: string } & (
  | {
      ok: true;
      state: CloudState;
      page?: DrivePage;
      document?: RemoteDocument;
      item?: DriveItem;
      previousValidator?: string;
      connectionId?: string;
    }
  | { ok: false; error: CloudWriteError }
);

export const remoteDocumentPath = (
  doc: Pick<RemoteDocument, 'connectionId' | 'accountId'> & {
    item: Pick<DriveItem, 'id'> & Partial<DriveItem>;
  },
): string =>
  `cloud-drive://${encodeURIComponent(doc.connectionId)}/${encodeURIComponent(doc.accountId)}/${encodeURIComponent(doc.item.id)}`;
export const isRemotePath = (path: string | null | undefined): boolean =>
  path?.startsWith('cloud-drive://') ?? false;
