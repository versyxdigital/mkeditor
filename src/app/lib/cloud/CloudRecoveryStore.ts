import { safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import type { SessionPayload } from '../../interfaces/Session';
import type { DriveItem, RemoteDocument } from '../../interfaces/Cloud';
import { remoteDocumentPath } from '../../interfaces/Cloud';
import { CloudError } from './CloudError';
import { CloudStore } from './CloudStore';

const text = z.string().max(4 * 1024 * 1024);
const id = z.string().min(1).max(1024);
export const recoveryItemSchema = z.object({
  id,
  name: z.string().max(1024),
  kind: z.enum(['folder', 'markdown', 'unsupported']),
  parents: z.array(id).max(100),
  modifiedTime: z.string().optional(),
  revision: z.string().optional(),
  driveId: id.optional(),
  shortcut: z.boolean().optional(),
  validator: z.string().max(2048).optional(),
  contentRevision: z.string().optional(),
  editable: z.boolean().optional(),
  readOnlyReason: z
    .enum(['permission', 'shared-drive', 'validator'])
    .optional(),
});
const documentSchema = z.object({
  provider: z.enum(['google-drive', 'dropbox']).optional(),
  pendingCreate: z.boolean().optional(),
  connectionId: id,
  accountId: id,
  connectionName: z.string().max(1024),
  item: recoveryItemSchema,
  content: text,
  operationId: id.optional(),
});
export const remoteTabSchema = z.object({
  epoch: z.string().max(128).optional(),
  sequence: z.number().int().nonnegative().optional(),
  dirty: z.boolean(),
  document: documentSchema,
  baseline: text,
  pendingSave: z
    .object({ operationId: id, content: text, validator: z.string().max(2048) })
    .optional(),
});

export interface RecoveryOperation {
  provider?: import('../../interfaces/Cloud').CloudProviderId;
  epoch?: string;
  sequence?: number;
  operationId: string;
  connectionId: string;
  accountId: string;
  itemId: string;
  kind: 'save' | 'create' | 'move' | 'createFolder';
  content?: string;
  validator?: string;
  folderId?: string;
  sourceFolderId?: string;
  name?: string;
  fingerprint?: string;
  previousValidator?: string;
  document?: RemoteDocument;
  item?: DriveItem;
  notApplied?: boolean;
}
const operationSchema = z
  .object({
    provider: z.enum(['google-drive', 'dropbox']).optional(),
    epoch: z.string().max(128).optional(),
    sequence: z.number().int().nonnegative().optional(),
    operationId: id,
    connectionId: id,
    accountId: id,
    itemId: id,
    kind: z.enum(['save', 'create', 'move', 'createFolder']),
    content: text.optional(),
    validator: z.string().max(2048).optional(),
    folderId: id.optional(),
    sourceFolderId: id.optional(),
    name: z.string().max(1024).optional(),
    fingerprint: z.string().max(8192).optional(),
    previousValidator: z.string().max(2048).optional(),
    document: documentSchema.optional(),
    documentContentIsSnapshot: z.boolean().optional(),
    item: recoveryItemSchema.optional(),
    notApplied: z.boolean().optional(),
  })
  .refine((op) =>
    op.kind === 'save' || op.kind === 'create'
      ? typeof op.content === 'string'
      : Boolean(op.folderId && op.fingerprint),
  );
interface RecoveryData {
  suppressedOperations: string[];
  version: 1;
  session?: unknown;
  operations: RecoveryOperation[];
  acknowledged: string[];
}
const empty = (): RecoveryData => ({
  version: 1,
  operations: [],
  acknowledged: [],
  suppressedOperations: [],
});
const MAX_BYTES = 64 * 1024 * 1024;

/** Serialized atomic updates keep draft checkpoints and write intentions in one encrypted generation. */
export class CloudRecoveryStore {
  private data?: RecoveryData;
  private loading?: Promise<RecoveryData>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path = join(homedir(), '.mkeditor', 'cloud-recovery.bin'),
  ) {}
  async load(): Promise<RecoveryData> {
    if (this.data) return this.data;
    if (this.loading) return this.loading;
    this.loading = this.read();
    try {
      return await this.loading;
    } finally {
      this.loading = undefined;
    }
  }
  private async read(): Promise<RecoveryData> {
    try {
      const stat = await fs.stat(this.path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return (this.data = empty());
      if (stat.size > MAX_BYTES * 2 || !(await new CloudStore().available()))
        throw new CloudError('storage');
      const decoded = (
        await safeStorage.decryptStringAsync(await fs.readFile(this.path))
      ).result;
      if (Buffer.byteLength(decoded) > MAX_BYTES)
        throw new CloudError('storage');
      const parsed = z
        .object({
          version: z.literal(1),
          operations: z.array(operationSchema).max(200),
          acknowledged: z.array(id).max(2000),
          session: z.unknown().optional(),
          suppressedOperations: z.array(id).max(200).default([]),
        })
        .parse(JSON.parse(decoded));
      // AppSession validates the optional session independently before restoring it.
      this.data = {
        ...parsed,
        operations: parsed.operations.map(
          ({ documentContentIsSnapshot, ...operation }) => ({
            ...operation,
            document:
              operation.document && documentContentIsSnapshot
                ? { ...operation.document, content: operation.content ?? '' }
                : operation.document,
          }),
        ),
      };
      return this.data;
    } catch {
      throw new CloudError('storage');
    }
  }
  private update(change: (data: RecoveryData) => RecoveryData): Promise<void> {
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        const next = change(await this.load());
        const serialized = JSON.stringify({
          ...next,
          operations: next.operations.map((operation) =>
            operation.document &&
            operation.document.content === operation.content
              ? {
                  ...operation,
                  document: { ...operation.document, content: '' },
                  documentContentIsSnapshot: true,
                }
              : operation,
          ),
        });
        if (
          next.operations.length > 200 ||
          Buffer.byteLength(serialized) > MAX_BYTES ||
          !(await new CloudStore().available())
        )
          throw new CloudError('storage');
        const encrypted = await safeStorage.encryptStringAsync(serialized);
        await fs.mkdir(dirname(this.path), { recursive: true });
        const temporary = this.path + '.tmp';
        const handle = await fs.open(temporary, 'w', 0o600);
        try {
          await handle.writeFile(encrypted);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, this.path);
        this.data = next;
      });
    this.queue = work;
    return work.catch(() => {
      throw new CloudError('storage');
    });
  }
  async saveSession(
    session: SessionPayload | undefined,
    acknowledgements: string[] = [],
  ) {
    const existing = await this.load();
    if (
      !session?.tabs.some((tab) => tab.remote) &&
      !existing.session &&
      !existing.operations.length
    )
      return;
    await this.update((data) => {
      const acknowledged = [
        ...new Set([
          ...data.acknowledged,
          ...acknowledgements.filter((id) =>
            data.operations.some(
              (op) =>
                op.operationId === id &&
                (op.document || op.item || op.notApplied),
            ),
          ),
        ]),
      ].slice(-2000);
      const previous = z
        .object({
          tabs: z.array(z.object({ remote: remoteTabSchema.optional() })),
        })
        .safeParse(data.session);
      const previousPaths = new Set(
        previous.success
          ? previous.data.tabs.flatMap((tab) =>
              tab.remote ? [remoteDocumentPath(tab.remote.document)] : [],
            )
          : [],
      );
      const currentPaths = new Set(
        session?.tabs.flatMap((tab) =>
          tab.remote ? [remoteDocumentPath(tab.remote.document)] : [],
        ) ?? [],
      );
      const suppressed = new Set(data.suppressedOperations);
      for (const operation of data.operations) {
        const path = remoteDocumentPath({
          ...operation,
          item: { id: operation.itemId },
        });
        // An empty checkpoint can race a new write before its tab exists.
        // Suppress only explicitly cleared or previously checkpointed tabs.
        if (
          session === undefined ||
          (previousPaths.has(path) && !currentPaths.has(path))
        )
          suppressed.add(operation.operationId);
      }
      const suppressedOperations = [...suppressed].filter(
        (id) => !acknowledged.includes(id),
      );
      return {
        ...data,
        session: session?.tabs.some((tab) => tab.remote) ? session : undefined,
        suppressedOperations,
        acknowledged,
        operations: data.operations.filter(
          (op) => !acknowledged.includes(op.operationId),
        ),
      };
    });
  }
  async saveOperations(operations: RecoveryOperation[]) {
    await this.update((data) => {
      const merged = new Map(data.operations.map((op) => [op.operationId, op]));
      for (const op of operations) {
        const existing = merged.get(op.operationId);
        merged.set(op.operationId, {
          ...op,
          document: op.document ?? existing?.document,
          item: op.item ?? existing?.item,
          notApplied: op.notApplied ?? existing?.notApplied,
        });
      }
      return {
        ...data,
        operations: [...merged.values()].filter(
          (op) => !data.acknowledged.includes(op.operationId),
        ),
      };
    });
  }
  async acknowledge(operationId: string) {
    const operation = (await this.load()).operations.find(
      (op) => op.operationId === operationId,
    );
    if (
      operation &&
      !operation.document &&
      !operation.item &&
      !operation.notApplied
    )
      throw new CloudError('unconfirmed');
    await this.update((data) => ({
      ...data,
      acknowledged: [...new Set([...data.acknowledged, operationId])].slice(
        -2000,
      ),
      operations: data.operations.filter(
        (op) => op.operationId !== operationId,
      ),
    }));
  }
}
export const cloudRecoveryStore = new CloudRecoveryStore();
