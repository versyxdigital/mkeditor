import { z } from 'zod';
import type { SessionPayload } from '../../interfaces/Session';
import type {
  DriveItem,
  RemoteDocument,
  RemoteDocumentDiscard,
} from '../../interfaces/Cloud';
import { remoteDocumentPath } from '../../interfaces/Cloud';
import { CloudError } from './CloudError';
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
  nameConflict: z.boolean().optional(),
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
export interface RecoveryData {
  suppressedOperations: string[];
  version: 1;
  session?: unknown;
  operations: RecoveryOperation[];
  acknowledged: string[];
}
export const emptyRecovery = (): RecoveryData => ({
  version: 1,
  operations: [],
  acknowledged: [],
  suppressedOperations: [],
});
const MAX_BYTES = 64 * 1024 * 1024;

/** Serialized atomic updates keep draft checkpoints and write intentions in one durable generation. */
export abstract class CloudRecoveryBase {
  protected data?: RecoveryData;
  private loading?: Promise<RecoveryData>;
  private queue: Promise<unknown> = Promise.resolve();
  protected abstract readStorage(): Promise<string | null>;
  protected abstract writeStorage(serialized: string): Promise<void>;

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
      const serialized = await this.readStorage();
      this.data =
        serialized === null ? emptyRecovery() : parseRecoveryData(serialized);
      return this.data;
    } catch {
      throw new CloudError('storage');
    }
  }

  protected update(
    change: (data: RecoveryData) => RecoveryData,
  ): Promise<void> {
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        const next = change(await this.load());
        await this.writeStorage(serializeRecoveryData(next));
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
    await this.update(this.sessionChange(session, acknowledgements));
  }

  protected sessionChange(
    session: SessionPayload | undefined,
    acknowledgements: string[] = [],
  ) {
    return (data: RecoveryData): RecoveryData => {
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
      // An older in-flight checkpoint must not reintroduce an explicitly
      // discarded write snapshot after discardDocument has committed.
      const tabs = session?.tabs.filter((tab) => {
        const operationId =
          tab.remote?.pendingSave?.operationId ??
          tab.remote?.document.operationId;
        return !operationId || !suppressed.has(operationId);
      });
      const retainedSession =
        session && tabs
          ? {
              ...session,
              tabs,
              activeFile: tabs.some((tab) => tab.path === session.activeFile)
                ? session.activeFile
                : null,
            }
          : undefined;
      return {
        ...data,
        session: retainedSession?.tabs.some((tab) => tab.remote)
          ? retainedSession
          : undefined,
        suppressedOperations,
        acknowledged,
        operations: data.operations.filter(
          (op) => !acknowledged.includes(op.operationId),
        ),
      };
    };
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

  async discardDocument(document: RemoteDocumentDiscard): Promise<void> {
    const path = remoteDocumentPath({
      ...document,
      item: { id: document.itemId },
    });
    await this.update((data) => {
      const suppressed = new Set([
        ...data.suppressedOperations,
        ...document.operationIds,
      ]);
      for (const operation of data.operations) {
        if (
          remoteDocumentPath({
            ...operation,
            item: { id: operation.itemId },
          }) === path
        )
          suppressed.add(operation.operationId);
      }
      const previous = z
        .object({
          tabs: z.array(
            z
              .object({ path: z.string(), remote: remoteTabSchema.optional() })
              .passthrough(),
          ),
          activeFile: z.string().nullable(),
        })
        .passthrough()
        .safeParse(data.session);
      let session = data.session;
      if (previous.success) {
        session = {
          ...previous.data,
          tabs: previous.data.tabs.filter(
            (tab) =>
              !tab.remote || remoteDocumentPath(tab.remote.document) !== path,
          ),
          activeFile:
            previous.data.activeFile === path ? null : previous.data.activeFile,
        };
      }
      return { ...data, session, suppressedOperations: [...suppressed] };
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
export function parseRecoveryData(serialized: string): RecoveryData {
  try {
    if (new TextEncoder().encode(serialized).length > MAX_BYTES)
      throw new Error();
    const parsed = z
      .object({
        version: z.literal(1),
        operations: z.array(operationSchema).max(200),
        acknowledged: z.array(id).max(2000),
        session: z.unknown().optional(),
        suppressedOperations: z.array(id).max(200).default([]),
      })
      .parse(JSON.parse(serialized));
    return {
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
  } catch {
    throw new CloudError('storage');
  }
}

export function serializeRecoveryData(data: RecoveryData): string {
  const serialized = JSON.stringify({
    ...data,
    operations: data.operations.map((operation) =>
      operation.document && operation.document.content === operation.content
        ? {
            ...operation,
            document: { ...operation.document, content: '' },
            documentContentIsSnapshot: true,
          }
        : operation,
    ),
  });
  parseRecoveryData(serialized);
  return serialized;
}

export type CloudRecoveryPersistence = Pick<
  CloudRecoveryBase,
  'load' | 'saveSession' | 'saveOperations' | 'discardDocument' | 'acknowledge'
>;
