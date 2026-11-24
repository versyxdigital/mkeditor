import type {
  CloudCallbackCopy,
  CloudProviderId,
  RemoteItem,
  RemotePage,
} from '../../interfaces/Cloud';

export interface CloudTokens {
  access: string;
  refresh: string;
  expires: number;
  scopes?: string[];
}
export interface CloudRegistration {
  clientId: string;
  clientValue: string;
}
export interface RemoteContents {
  item: RemoteItem;
  content: string;
}
export interface CloudOrganization {
  metadata(
    access: string,
    id: string,
  ): Promise<{ id: string; parents?: string[] }>;
  createdBy(access: string, id: string, operationId: string): Promise<boolean>;
  contentValidator(access: string, id: string): Promise<{ etag: string }>;
  inspectItem(access: string, id: string): Promise<RemoteItem>;
  prepareCreate(
    access: string,
    folderId: string,
    name: string,
  ): Promise<string>;
  prepareMove(
    access: string,
    id: string,
    sourceFolderId: string,
    folderId: string,
  ): Promise<{ source: string; destination: string; validator: string }>;
  move(
    access: string,
    id: string,
    source: string,
    destination: string,
    validator: string,
    authorize: () => void,
  ): Promise<void>;
  createFolder(
    access: string,
    id: string,
    folderId: string,
    name: string,
    operationId: string,
    authorize: () => void,
  ): Promise<void>;
}
/** The two adapters share lifecycle and document safety; organization remains explicit. */
export interface CloudProvider {
  readonly provider: CloudProviderId;
  readonly organization?: CloudOrganization;
  authorizationScopes(editing: boolean): readonly string[];
  canWrite(tokens: CloudTokens): boolean;
  beginAuthorization(
    registration: CloudRegistration,
    openBrowser: (url: string) => Promise<void>,
    timeoutMs?: number,
    copy?: CloudCallbackCopy,
    scopes?: readonly string[],
  ): Promise<{ result: Promise<CloudTokens>; cancel: () => void }>;
  refresh(
    registration: CloudRegistration,
    refresh: string,
    scopes?: string[],
  ): Promise<CloudTokens>;
  account(access: string): Promise<{ id: string; name: string }>;
  list(
    access: string,
    folderId: string,
    driveId?: string,
    page?: string,
  ): Promise<RemotePage>;
  drives(access: string, page?: string): Promise<RemotePage>;
  read(access: string, id: string, editing?: boolean): Promise<RemoteContents>;
  update(
    access: string,
    id: string,
    validator: string,
    content: string,
    authorize: () => void,
  ): Promise<RemoteContents>;
  prepareCreate(
    access: string,
    folderId: string,
    name: string,
    operationId?: string,
  ): Promise<string>;
  create(
    access: string,
    id: string,
    folderId: string,
    name: string,
    content: string,
    operationId: string,
    authorize: () => void,
  ): Promise<RemoteContents | void>;
  createdBy(access: string, id: string, operationId: string): Promise<boolean>;
}
