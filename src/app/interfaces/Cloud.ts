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
export type CloudWriteError = CloudErrorCode | 'unconfirmed' | 'duplicate';

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
  connectionId: string;
  accountId: string;
  connectionName: string;
  item: DriveItem;
  content: string;
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
      connectionId?: string;
    }
  | { ok: false; error: CloudWriteError }
);

export const remoteDocumentPath = (doc: RemoteDocument): string =>
  `cloud-drive://${encodeURIComponent(doc.connectionId)}/${encodeURIComponent(doc.accountId)}/${encodeURIComponent(doc.item.id)}`;
export const isRemotePath = (path: string | null | undefined): boolean =>
  path?.startsWith('cloud-drive://') ?? false;
