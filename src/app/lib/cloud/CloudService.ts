import { randomUUID } from 'crypto';
import { Dropbox } from './Dropbox';
import {
  dropboxRegistration,
  dropboxRegistrationSchema,
} from './DropboxRegistration';
import type {
  CloudProvider,
  CloudRegistration,
  CloudTokens,
  RemoteContents,
} from './CloudProvider';
import { z } from 'zod';
import type {
  CloudCommand,
  CloudConnection,
  CloudResponse,
  CloudState,
  RemoteDocument,
  DriveItem,
} from '../../interfaces/Cloud';
import { CloudError } from './CloudError';
import type { CloudPersistence } from './CloudStore';
import { GoogleDrive, type DriveRegistration } from './GoogleDrive';
import {
  driveRegistrationSchema,
  googleDriveRegistration,
} from './GoogleDriveRegistration';
import type {
  CloudRecoveryStore,
  RecoveryOperation,
} from './CloudRecoveryStore';

const id = z.string().min(1).max(1024);
const connection = { connectionId: id };
const copyString = z.string().min(1).max(1500);
const copySchema = z.object({
  title: copyString,
  accepted: copyString,
  cancelled: copyString,
  close: copyString,
  invalid: copyString,
});
const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }),
  z.object({
    action: z.literal('discardDocument'),
    document: z.object({
      provider: z.enum(['google-drive', 'dropbox']).optional(),
      connectionId: id,
      accountId: id,
      itemId: id,
      operationIds: z.array(id).max(200),
    }),
  }),
  z.object({ action: z.literal('acknowledge'), operationId: id }),
  z.object({
    action: z.literal('add'),
    name: z.string().trim().min(1).max(100),
    provider: z.enum(['google-drive', 'dropbox']).optional(),
    clientId: z.string().min(1).max(512).optional(),
    clientValue: z.string().max(512).optional(),
    authorize: z.boolean().optional(),
    copy: copySchema.optional(),
  }),
  z.object({
    action: z.literal('rename'),
    ...connection,
    name: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal('connect'),
    ...connection,
    copy: copySchema.optional(),
    writeAccess: z.boolean().optional(),
  }),
  ...(['disconnect', 'remove', 'test'] as const).map((action) =>
    z.object({ action: z.literal(action), ...connection }),
  ),
  z.object({
    action: z.literal('list'),
    ...connection,
    folderId: id,
    driveId: id.optional(),
    page: z.string().max(8192).optional(),
  }),
  z.object({
    action: z.literal('drives'),
    ...connection,
    page: z.string().max(8192).optional(),
  }),
  z.object({
    action: z.literal('open'),
    ...connection,
    itemId: id,
    accountId: id.optional(),
  }),
  z.object({
    action: z.literal('save'),
    epoch: z.string().max(128).optional(),
    sequence: z.number().int().nonnegative().optional(),
    name: z.string().max(1024).optional(),
    ...connection,
    accountId: id,
    itemId: id,
    validator: z.string().regex(/^"[^"\r\n]{1,1024}"$/),
    content: z.string().max(4 * 1024 * 1024),
    operationId: id,
  }),
  z.object({
    action: z.literal('create'),
    ...connection,
    accountId: id,
    folderId: id,
    name: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\]+\.md$/i)
      .refine((name) =>
        [...name].every((character) => character.charCodeAt(0) >= 32),
      ),
    content: z.string().max(4 * 1024 * 1024),
    operationId: id,
  }),
  z.object({
    action: z.literal('createFolder'),
    ...connection,
    accountId: id,
    folderId: id,
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^/\\]+$/)
      .refine(
        (name) =>
          name !== '.' &&
          name !== '..' &&
          [...name].every((character) => character.charCodeAt(0) >= 32),
      ),
    operationId: id,
  }),
  z.object({
    action: z.literal('move'),
    ...connection,
    accountId: id,
    itemId: id,
    sourceFolderId: id,
    folderId: id,
    operationId: id,
  }),
  z.object({
    action: z.literal('reconcileItem'),
    ...connection,
    accountId: id,
    operationId: id,
  }),
  z.object({
    action: z.literal('reconcile'),
    ...connection,
    accountId: id,
    operationId: id,
  }),
]);
const requestSchema = z.object({
  requestId: z.string().min(1).max(100),
  command: commandSchema,
});
type StoredConnection = CloudConnection & { credential?: string };
interface WriteOperation {
  provider?: import('../../interfaces/Cloud').CloudProviderId;
  epoch?: string;
  sequence?: number;
  name?: string;
  folderId?: string;
  notApplied?: boolean;
  connectionId: string;
  accountId: string;
  itemId: string;
  content: string;
  kind: 'save' | 'create';
  validator?: string;
  document?: RemoteDocument;
}
interface ItemOperation {
  provider?: import('../../interfaces/Cloud').CloudProviderId;
  name?: string;
  sourceFolderId?: string;
  notApplied?: boolean;
  connectionId: string;
  accountId: string;
  fingerprint: string;
  itemId: string;
  folderId: string;
  kind: 'move' | 'createFolder';
  previousValidator?: string;
  item?: DriveItem;
}

/** Main owns auth, account binding, conditional writes and outcome reconciliation. */
export class CloudService {
  private connections: StoredConnection[] | null = null;
  private generations = new Map<string, number>();
  private refreshes = new Map<string, Promise<CloudTokens>>();
  private cancellations = new Map<string, () => void>();
  private tokens = new Map<string, CloudTokens>();
  private disposed = false;
  private revision = 0;
  private operations = new Map<string, WriteOperation>();
  private itemOperations = new Map<string, ItemOperation>();
  private writes = new Map<string, Promise<unknown>>();
  private journalLoaded = false;
  private journalLoading?: Promise<void>;
  private restoredOperations = new Set<string>();
  constructor(
    private readonly store: CloudPersistence,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly push: (state: CloudState) => void,
    private readonly drive = new GoogleDrive(),
    private readonly registration: Readonly<DriveRegistration> | null = googleDriveRegistration,
    private readonly recovery?: CloudRecoveryStore,
    private readonly additional: {
      dropbox?: CloudProvider;
      dropboxRegistration?: CloudRegistration | null;
    } = {},
  ) {}
  private readonly dropbox = new Dropbox();
  private adapter(entry: CloudConnection): CloudProvider {
    return entry.provider === 'dropbox'
      ? (this.additional.dropbox ?? this.dropbox)
      : this.drive;
  }

  private async loadJournal(): Promise<void> {
    if (!this.recovery || this.journalLoaded) return;
    if (this.journalLoading) return this.journalLoading;
    this.journalLoading = (async () => {
      const data = await this.recovery!.load();
      for (const { operationId, ...op } of data.operations) {
        if (data.acknowledged.includes(operationId)) continue;
        if (op.kind === 'save' || op.kind === 'create') {
          if (op.content === undefined) throw new CloudError('storage');
          this.operations.set(operationId, {
            ...op,
            kind: op.kind,
            content: op.content,
          });
        } else {
          if (!op.folderId || !op.fingerprint) throw new CloudError('storage');
          this.itemOperations.set(operationId, {
            ...op,
            kind: op.kind,
            folderId: op.folderId,
            fingerprint: op.fingerprint,
          });
        }
        this.restoredOperations.add(operationId);
      }
      this.journalLoaded = true;
    })();
    try {
      await this.journalLoading;
    } finally {
      this.journalLoading = undefined;
    }
  }
  private async persistJournal(): Promise<void> {
    if (!this.recovery) return;
    const operations: RecoveryOperation[] = [
      ...[...this.operations].map(([operationId, op]) => ({
        ...op,
        operationId,
      })),
      ...[...this.itemOperations].map(([operationId, op]) => ({
        ...op,
        operationId,
      })),
    ];
    await this.recovery.saveOperations(operations);
  }

  private data(): StoredConnection[] {
    return (this.connections ??= this.store.load());
  }
  private find(id: string): StoredConnection {
    const found = this.data().find((entry) => entry.id === id);
    if (!found) throw new CloudError('missing');
    return found;
  }
  private generation(id: string) {
    return this.generations.get(id) ?? 0;
  }
  private assertCurrent(id: string, generation: number) {
    if (this.disposed || this.generation(id) !== generation)
      throw new CloudError('cancelled');
  }
  private replace(value: StoredConnection) {
    const next = this.data().map((entry) =>
      entry.id === value.id ? value : entry,
    );
    this.store.save(next);
    this.connections = next;
    this.revision++;
  }
  async state(): Promise<CloudState> {
    let recoveryError = false;
    try {
      await this.loadJournal();
    } catch {
      recoveryError = true;
    }
    const acknowledged = this.recovery
      ? (await this.recovery.load().catch(() => ({ acknowledged: [] })))
          .acknowledged
      : [];
    const pendingOperations = [...this.operations, ...this.itemOperations]
      .filter(
        ([id, op]) =>
          this.restoredOperations.has(id) &&
          !acknowledged.includes(id) &&
          !op.notApplied,
      )
      .map(([operationId, op]) => ({
        operationId,
        ...(op.provider ? { provider: op.provider } : {}),
        connectionId: op.connectionId,
        accountId: op.accountId,
        itemId: op.itemId,
        name: op.name,
        kind: op.kind,
      }));
    return {
      ...(recoveryError ? { recoveryError: true } : {}),
      ...(pendingOperations.length ? { pendingOperations } : {}),
      secureStorage: await this.store.available(),
      googleDriveAvailable: this.registration !== null,
      dropboxAvailable:
        (this.additional.dropboxRegistration !== undefined
          ? this.additional.dropboxRegistration
          : dropboxRegistration) !== null,
      revision: this.revision,
      connections: this.data().map(({ credential, ...entry }) => ({
        ...entry,
        status:
          !credential && entry.status === 'connected'
            ? 'disconnected'
            : entry.status,
      })),
    };
  }
  private async changed() {
    if (!this.disposed) this.push(await this.state());
  }

  private invalidate(id: string) {
    this.generations.set(id, this.generation(id) + 1);
    this.cancellations.get(id)?.();
    this.cancellations.delete(id);
    this.tokens.delete(id);
    this.refreshes.delete(id);
  }

  async handle(input: unknown): Promise<CloudResponse> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      return {
        requestId:
          typeof input === 'object' &&
          input &&
          'requestId' in input &&
          typeof input.requestId === 'string'
            ? input.requestId.slice(0, 100)
            : '',
        ok: false,
        error: 'configuration',
      };
    const { requestId, command } = parsed.data;
    try {
      if (this.disposed) throw new CloudError('cancelled');
      const result = await this.execute(command);
      return { requestId, ok: true, state: await this.state(), ...result };
    } catch (error) {
      // Never forward raw fetch/OAuth/provider exceptions or their URLs.
      return {
        requestId,
        ok: false,
        error: error instanceof CloudError ? error.code : 'network',
      };
    } finally {
      await this.changed().catch(() => {});
    }
  }

  private async execute(command: CloudCommand): Promise<{
    page?: import('../../interfaces/Cloud').DrivePage;
    document?: import('../../interfaces/Cloud').RemoteDocument;
    item?: DriveItem;
    previousValidator?: string;
    connectionId?: string;
  }> {
    if (command.action === 'state') return {};
    if (command.action === 'discardDocument') {
      if (!this.recovery) throw new CloudError('storage');
      await this.recovery.discardDocument(command.document);
      return {};
    }
    if (command.action === 'acknowledge') {
      await this.recovery?.acknowledge(command.operationId);
      this.restoredOperations.delete(command.operationId);
      this.operations.delete(command.operationId);
      this.itemOperations.delete(command.operationId);
      return {};
    }
    if (
      [
        'save',
        'create',
        'move',
        'createFolder',
        'reconcile',
        'reconcileItem',
      ].includes(command.action)
    )
      await this.loadJournal();
    if (
      this.recovery &&
      'operationId' in command &&
      ['save', 'create', 'move', 'createFolder'].includes(command.action) &&
      (await this.recovery.load()).acknowledged.includes(command.operationId)
    )
      throw new CloudError('duplicate');
    if (command.action === 'add') {
      const custom = command.clientId !== undefined;
      if (!custom && command.clientValue !== undefined)
        throw new CloudError('configuration');
      const providerId = command.provider ?? 'google-drive';
      const registration = custom
        ? {
            clientId: command.clientId!,
            clientValue: command.clientValue ?? '',
          }
        : providerId === 'dropbox'
          ? this.additional.dropboxRegistration !== undefined
            ? this.additional.dropboxRegistration
            : dropboxRegistration
          : this.registration;
      if (
        !registration ||
        !(
          providerId === 'dropbox'
            ? dropboxRegistrationSchema
            : driveRegistrationSchema
        ).safeParse(registration).success
      )
        throw new CloudError('configuration');
      if (command.authorize && !(await this.store.available()))
        throw new CloudError('storage');
      if (this.disposed) throw new CloudError('cancelled');
      let name = command.name;
      if (
        !custom &&
        name === (providerId === 'dropbox' ? 'Dropbox' : 'Google Drive')
      ) {
        let number = 2;
        const names = new Set(this.data().map((entry) => entry.name));
        while (names.has(name))
          name = `${providerId === 'dropbox' ? 'Dropbox' : 'Google Drive'} (${number++})`;
      }
      const next: StoredConnection = {
        id: randomUUID(),
        ...(command.provider ? { provider: providerId } : {}),
        name,
        ...registration,
        registration: custom ? 'custom' : 'mkeditor',
        status: 'disconnected',
      };
      const updated = [...this.data(), next];
      this.store.save(updated);
      this.connections = updated;
      this.revision++;
      if (command.authorize)
        await this.execute({
          action: 'connect',
          connectionId: next.id,
          copy: command.copy,
        });
      return { connectionId: next.id };
    }
    const entry = this.find(command.connectionId);
    const provider = this.adapter(entry);
    const organization = provider.organization;
    if (command.action === 'disconnect' || command.action === 'remove') {
      this.invalidate(entry.id);
      // In-memory access is blocked even if the disk write fails. Keep the
      // error visible so the user knows persisted credentials were not cleared.
      const next = this.data().filter((value) => value.id !== entry.id);
      if (command.action === 'disconnect')
        next.push({
          ...entry,
          credential: undefined,
          accountId: undefined,
          accountName: undefined,
          status: 'disconnected',
        });
      this.connections = next;
      this.revision++;
      this.store.save(next);
      return {};
    }
    if (command.action === 'rename') {
      this.replace({ ...entry, name: command.name });
      return {};
    }
    if (command.action === 'connect') {
      this.invalidate(entry.id);
      const generation = this.generation(entry.id);
      if (!(await this.store.available())) throw new CloudError('storage');
      this.assertCurrent(entry.id, generation);
      this.replace({ ...entry, status: 'connecting' });
      await this.changed();
      try {
        const flow = await provider.beginAuthorization(
          entry,
          this.openBrowser,
          180_000,
          command.copy,
          provider.authorizationScopes(
            Boolean(command.writeAccess ?? entry.writeAccess),
          ),
        );
        if (this.disposed || this.generation(entry.id) !== generation)
          flow.cancel();
        this.assertCurrent(entry.id, generation);
        this.cancellations.set(entry.id, flow.cancel);
        const tokens = await flow.result;
        this.assertCurrent(entry.id, generation);
        const writeAccess = Boolean(command.writeAccess ?? entry.writeAccess);
        if (writeAccess && !provider.canWrite(tokens))
          throw new CloudError('permission');
        const account = await provider.account(tokens.access);
        this.assertCurrent(entry.id, generation);
        const credential = await this.store.encrypt(tokens);
        this.assertCurrent(entry.id, generation);
        this.replace({
          ...this.find(entry.id),
          credential,
          accountId: account.id,
          accountName: account.name,
          status: 'connected',
          writeAccess,
          hasConnected: true,
        });
        this.tokens.set(entry.id, tokens);
      } catch (error) {
        if (this.generation(entry.id) === generation && !this.disposed)
          this.replace({
            ...this.find(entry.id),
            credential: entry.credential,
            status: entry.credential ? 'connected' : 'disconnected',
          });
        throw error;
      } finally {
        if (this.generation(entry.id) === generation)
          this.cancellations.delete(entry.id);
      }
      return {};
    }
    const generation = this.generation(entry.id);
    const tokens = await this.access(entry.id);
    this.assertCurrent(entry.id, generation);
    if (
      'accountId' in command &&
      command.accountId !== undefined &&
      command.accountId !== entry.accountId
    )
      throw new CloudError('auth');
    try {
      const editing = entry.writeAccess === true && provider.canWrite(tokens);
      const document = (value: RemoteContents): RemoteDocument => ({
        ...value,
        ...(entry.provider ? { provider: entry.provider } : {}),
        connectionId: entry.id,
        connectionName: entry.name,
        accountId: entry.accountId!,
      });
      if (command.action === 'reconcileItem') {
        if (!organization) throw new CloudError('unsupported');
        const operation = this.itemOperations.get(command.operationId);
        if (
          !operation ||
          operation.connectionId !== entry.id ||
          operation.accountId !== entry.accountId
        )
          throw new CloudError('missing');
        if (operation.notApplied) throw new CloudError('not_applied');
        if (!operation.item) {
          try {
            const meta = await organization!.metadata(
              tokens.access,
              operation.itemId,
            );
            if (
              !meta.parents?.includes(operation.folderId) ||
              (operation.kind === 'createFolder' &&
                !(await organization.createdBy(
                  tokens.access,
                  operation.itemId,
                  command.operationId,
                )))
            ) {
              if (
                operation.kind === 'move' &&
                operation.sourceFolderId &&
                meta.parents?.includes(operation.sourceFolderId) &&
                (
                  await organization!.contentValidator(
                    tokens.access,
                    operation.itemId,
                  )
                ).etag === operation.previousValidator
              ) {
                operation.notApplied = true;
                await this.persistJournal();
                throw new CloudError('not_applied');
              }
              throw new CloudError('unconfirmed');
            }
            operation.item = await organization!.inspectItem(
              tokens.access,
              operation.itemId,
            );
            operation.itemId = operation.item.id;
            this.assertCurrent(entry.id, generation);
            await this.persistJournal();
          } catch (error) {
            if (
              error instanceof CloudError &&
              error.code === 'missing' &&
              operation.kind === 'createFolder'
            ) {
              operation.notApplied = true;
              await this.persistJournal();
              throw new CloudError('not_applied');
            }
            if (
              error instanceof CloudError &&
              ['auth', 'cancelled', 'not_applied'].includes(error.code)
            )
              throw error;
            throw new CloudError('unconfirmed');
          }
        }
        return {
          item: operation.item,
          previousValidator: operation.previousValidator,
        };
      }
      if (command.action === 'createFolder' || command.action === 'move') {
        if (!organization) throw new CloudError('unsupported');
        if (!editing) throw new CloudError('permission');
        const fingerprint = JSON.stringify(command);
        const key = `${entry.id}:${entry.accountId}:${command.action === 'move' ? command.itemId : command.folderId}`;
        const pending = this.writes.get(key) ?? Promise.resolve();
        const run = pending
          .catch(() => {})
          .then(async () => {
            this.assertCurrent(entry.id, generation);
            const previous = this.itemOperations.get(command.operationId);
            if (previous) {
              if (previous.notApplied) throw new CloudError('not_applied');
              if (previous.fingerprint !== fingerprint)
                throw new CloudError('configuration');
              if (!previous.item) throw new CloudError('unconfirmed');
              return {
                item: previous.item,
                previousValidator: previous.previousValidator,
              };
            }
            if (
              [...this.itemOperations.values()].filter(
                (op) => !op.item && !op.notApplied,
              ).length >= 20 ||
              (command.action === 'move' &&
                [...this.operations.values()].some(
                  (op) =>
                    !op.document &&
                    !op.notApplied &&
                    op.connectionId === entry.id &&
                    op.accountId === entry.accountId &&
                    op.itemId === command.itemId,
                )) ||
              [...this.itemOperations.values()].some(
                (op) =>
                  !op.item &&
                  !op.notApplied &&
                  op.connectionId === entry.id &&
                  op.accountId === entry.accountId &&
                  (command.action === 'move'
                    ? op.itemId === command.itemId
                    : op.folderId === command.folderId),
              )
            )
              throw new CloudError('pending_operation');
            const prepared =
              command.action === 'move'
                ? await organization!.prepareMove(
                    tokens.access,
                    command.itemId,
                    command.sourceFolderId,
                    command.folderId,
                  )
                : undefined;
            const itemId =
              command.action === 'move'
                ? command.itemId
                : await organization!.prepareCreate(
                    tokens.access,
                    command.folderId,
                    command.name,
                    command.operationId,
                  );
            const folderId =
              prepared?.destination ??
              (await organization!.metadata(tokens.access, command.folderId))
                .id;
            this.assertCurrent(entry.id, generation);
            const operation: ItemOperation = {
              ...(entry.provider ? { provider: entry.provider } : {}),
              name:
                command.action === 'createFolder' ? command.name : undefined,
              sourceFolderId: prepared?.source,
              connectionId: entry.id,
              accountId: entry.accountId!,
              fingerprint,
              itemId,
              folderId,
              kind: command.action,
              previousValidator: prepared?.validator,
            };
            this.itemOperations.set(command.operationId, operation);
            try {
              await this.persistJournal();
            } catch (error) {
              this.itemOperations.delete(command.operationId);
              throw error;
            }
            try {
              // A source conflict must propagate before checking the destination:
              // its final parent alone cannot prove that this request moved it.
              if (command.action === 'move')
                await organization!.move(
                  tokens.access,
                  itemId,
                  prepared!.source,
                  folderId,
                  prepared!.validator,
                  () => this.assertCurrent(entry.id, generation),
                );
              else {
                const created = await organization!.createFolder(
                  tokens.access,
                  itemId,
                  folderId,
                  command.name,
                  command.operationId,
                  () => this.assertCurrent(entry.id, generation),
                );
                if (created) operation.itemId = created.id;
              }
              try {
                operation.item = await organization!.inspectItem(
                  tokens.access,
                  operation.itemId,
                );
                this.assertCurrent(entry.id, generation);
                if (!operation.item.parents.includes(folderId))
                  throw new CloudError('unconfirmed');
              } catch {
                operation.item = undefined;
                throw new CloudError('unconfirmed');
              }
              if (this.itemOperations.size > 100)
                for (const [id, old] of this.itemOperations) {
                  if (id !== command.operationId && old.item) {
                    this.itemOperations.delete(id);
                    break;
                  }
                }
              try {
                await this.persistJournal();
              } catch {
                throw new CloudError('unconfirmed');
              }
              return {
                item: operation.item,
                previousValidator: operation.previousValidator,
              };
            } catch (error) {
              if (
                !(error instanceof CloudError) ||
                error.code !== 'unconfirmed'
              ) {
                operation.notApplied = true;
                await this.persistJournal();
              } else await this.persistJournal().catch(() => {});
              throw error;
            }
          });
        this.writes.set(key, run);
        try {
          return await run;
        } finally {
          if (this.writes.get(key) === run) this.writes.delete(key);
        }
      }
      if (command.action === 'reconcile') {
        const operation = this.operations.get(command.operationId);
        if (
          !operation ||
          operation.connectionId !== entry.id ||
          operation.accountId !== entry.accountId
        )
          throw new CloudError('missing');
        if (operation.notApplied) throw new CloudError('not_applied');
        if (operation.document)
          return {
            document: {
              ...operation.document,
              operationId: command.operationId,
            },
          };
        try {
          const latest = await provider.read(
            tokens.access,
            operation.itemId,
            editing,
          );
          this.assertCurrent(entry.id, generation);
          if (operation.kind === 'create') {
            if (
              !(await provider.createdBy(
                tokens.access,
                operation.itemId,
                command.operationId,
              ))
            )
              throw new CloudError('unconfirmed');
          }
          if (
            latest.content !== operation.content ||
            (operation.kind === 'save' &&
              latest.item.validator === operation.validator)
          ) {
            if (
              operation.kind === 'save' &&
              latest.item.validator === operation.validator
            ) {
              operation.notApplied = true;
              await this.persistJournal();
              throw new CloudError('not_applied');
            }
            throw new CloudError('unconfirmed');
          }
          operation.document = {
            ...document(latest),
            operationId: command.operationId,
          };
          await this.persistJournal();
          return { document: operation.document };
        } catch (error) {
          if (
            error instanceof CloudError &&
            error.code === 'missing' &&
            operation.kind === 'create'
          ) {
            operation.notApplied = true;
            await this.persistJournal();
            throw new CloudError('not_applied');
          }
          if (
            error instanceof CloudError &&
            (error.code === 'auth' ||
              error.code === 'cancelled' ||
              error.code === 'not_applied')
          )
            throw error;
          throw new CloudError('unconfirmed');
        }
      }
      if (command.action === 'save' || command.action === 'create') {
        if (!editing) throw new CloudError('permission');
        const previous = this.operations.get(command.operationId);
        if (previous) {
          if (previous.notApplied) throw new CloudError('not_applied');
          if (
            previous.connectionId !== entry.id ||
            previous.accountId !== entry.accountId ||
            previous.content !== command.content ||
            (command.action === 'save' && previous.itemId !== command.itemId)
          )
            throw new CloudError('configuration');
          if (previous.document) return { document: previous.document };
          throw new CloudError('unconfirmed');
        }
        if (
          [...this.operations.values()].filter(
            (value) => !value.document && !value.notApplied,
          ).length >= 20
        )
          throw new CloudError('unconfirmed');
        const key = `${entry.id}:${entry.accountId}:${command.action === 'save' ? command.itemId : command.folderId}`;
        const pending = this.writes.get(key) ?? Promise.resolve();
        const run = pending
          .catch(() => {})
          .then(async () => {
            this.assertCurrent(entry.id, generation);
            const completed = this.operations.get(command.operationId);
            if (completed) {
              if (
                completed.content !== command.content ||
                completed.kind !== command.action
              )
                throw new CloudError('configuration');
              if (completed.document) return { document: completed.document };
              throw new CloudError('unconfirmed');
            }
            if (
              (command.action === 'save' &&
                [...this.operations.values()].some(
                  (op) =>
                    !op.document &&
                    !op.notApplied &&
                    op.connectionId === entry.id &&
                    op.accountId === entry.accountId &&
                    op.itemId === command.itemId,
                )) ||
              (command.action === 'save' &&
                [...this.itemOperations.values()].some(
                  (op) =>
                    !op.item &&
                    !op.notApplied &&
                    op.connectionId === entry.id &&
                    op.accountId === entry.accountId &&
                    op.itemId === command.itemId,
                ))
            )
              throw new CloudError('pending_operation');
            const itemId =
              command.action === 'save'
                ? command.itemId
                : await provider.prepareCreate(
                    tokens.access,
                    command.folderId,
                    command.name,
                    command.operationId,
                  );
            this.assertCurrent(entry.id, generation);
            const operation: WriteOperation = {
              ...(entry.provider ? { provider: entry.provider } : {}),
              epoch: command.action === 'save' ? command.epoch : undefined,
              sequence:
                command.action === 'save' ? command.sequence : undefined,
              name: command.name,
              folderId:
                command.action === 'create' ? command.folderId : undefined,
              connectionId: entry.id,
              accountId: entry.accountId!,
              itemId,
              content: command.content,
              kind: command.action,
              validator:
                command.action === 'save' ? command.validator : undefined,
            };
            this.operations.set(command.operationId, operation);
            try {
              await this.persistJournal();
            } catch (error) {
              this.operations.delete(command.operationId);
              throw error;
            }
            try {
              let result: RemoteContents;
              if (command.action === 'save')
                result = await provider.update(
                  tokens.access,
                  itemId,
                  command.validator,
                  command.content,
                  () => this.assertCurrent(entry.id, generation),
                );
              else {
                const created = await provider.create(
                  tokens.access,
                  itemId,
                  command.folderId,
                  command.name,
                  command.content,
                  command.operationId,
                  () => this.assertCurrent(entry.id, generation),
                );
                try {
                  result =
                    created ??
                    (await provider.read(tokens.access, itemId, true));
                } catch {
                  throw new CloudError('unconfirmed');
                }
              }
              if (command.action === 'create')
                operation.itemId = result.item.id;
              operation.document = {
                ...document(result),
                operationId: command.operationId,
              };
              try {
                await this.persistJournal();
              } catch {
                throw new CloudError('unconfirmed');
              }
              // Confirmed entries need no buffer snapshots beyond recent request deduplication.
              if (this.operations.size > 100)
                for (const [id, old] of this.operations) {
                  if (id !== command.operationId && old.document) {
                    this.operations.delete(id);
                    break;
                  }
                }
              return { document: operation.document };
            } catch (error) {
              if (
                !(error instanceof CloudError) ||
                error.code !== 'unconfirmed'
              ) {
                operation.notApplied = true;
                await this.persistJournal();
              }
              throw error;
            }
          });
        this.writes.set(key, run);
        try {
          return await run;
        } finally {
          if (this.writes.get(key) === run) this.writes.delete(key);
        }
      }
      if (command.action === 'test') {
        const account = await provider.account(tokens.access);
        this.assertCurrent(entry.id, generation);
        if (account.id !== entry.accountId) throw new CloudError('auth');
        return {};
      }
      if (command.action === 'list' || command.action === 'drives') {
        const page =
          command.action === 'list'
            ? await provider.list(
                tokens.access,
                command.folderId,
                command.driveId,
                command.page,
              )
            : await provider.drives(tokens.access, command.page);
        this.assertCurrent(entry.id, generation);
        return { page };
      }
      if (command.action !== 'open') throw new CloudError('unsupported');
      const opened = await provider.read(
        tokens.access,
        command.itemId,
        editing,
      );
      this.assertCurrent(entry.id, generation);
      return {
        document: {
          ...opened,
          ...(entry.provider ? { provider: entry.provider } : {}),
          connectionId: entry.id,
          connectionName: entry.name,
          accountId: entry.accountId!,
        },
      };
    } catch (error) {
      if (error instanceof CloudError && error.code === 'auth') {
        this.assertCurrent(entry.id, generation);
        this.tokens.delete(entry.id);
        this.replace({
          ...this.find(entry.id),
          credential: undefined,
          status: 'reauthorize',
        });
      }
      throw error;
    }
  }

  private async access(id: string): Promise<CloudTokens> {
    const entry = this.find(id);
    const provider = this.adapter(entry);
    if (!entry.credential || entry.status !== 'connected' || !entry.accountId)
      throw new CloudError('auth');
    const current = this.refreshes.get(id);
    if (current) return current;
    const generation = this.generation(id);
    const operation = (async () => {
      try {
        let tokens =
          this.tokens.get(id) ?? (await this.store.decrypt(entry.credential!));
        this.assertCurrent(id, generation);
        if (tokens.expires < Date.now() + 60_000) {
          tokens = await provider.refresh(entry, tokens.refresh, tokens.scopes);
          this.assertCurrent(id, generation);
          const account = await provider.account(tokens.access);
          this.assertCurrent(id, generation);
          if (account.id !== entry.accountId) throw new CloudError('auth');
          const credential = await this.store.encrypt(tokens);
          this.assertCurrent(id, generation);
          this.replace({ ...this.find(id), credential });
        }
        this.tokens.set(id, tokens);
        return tokens;
      } catch (error) {
        if (
          error instanceof CloudError &&
          error.code === 'auth' &&
          this.generation(id) === generation &&
          !this.disposed
        )
          this.replace({
            ...this.find(id),
            credential: undefined,
            status: 'reauthorize',
          });
        throw error;
      }
    })();
    this.refreshes.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.refreshes.get(id) === operation) this.refreshes.delete(id);
    }
  }

  dispose() {
    this.disposed = true;
    this.cancellations.forEach((cancel) => cancel());
    this.cancellations.clear();
    this.tokens.clear();
  }
}
