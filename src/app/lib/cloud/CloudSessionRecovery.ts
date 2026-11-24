import type {
  SessionPayload,
  SessionRestoreEnvelope,
} from '../../interfaces/Session';
import { isRemotePath, remoteDocumentPath } from '../../interfaces/Cloud';
import { AppSession } from '../AppSession';
import {
  type CloudRecoveryStore,
  cloudRecoveryStore,
} from './CloudRecoveryStore';
import { CloudError } from './CloudError';

/** Desktop-only coordinator: plaintext local session + encrypted remote snapshot/journal. */
export class CloudSessionRecovery {
  private queue: Promise<unknown> = Promise.resolve();
  private blocked = false;
  private clearToken?: string;
  private committedClearToken?: string;
  constructor(
    readonly store: CloudRecoveryStore = cloudRecoveryStore,
    private readonly local: Pick<
      typeof AppSession,
      'save' | 'clear'
    > = AppSession,
  ) {}
  async restore(local: SessionPayload | null): Promise<SessionRestoreEnvelope> {
    try {
      const recovery = await this.store.load();
      this.blocked = false;
      if (
        recovery.session !== undefined &&
        !AppSession.isValidPayload(recovery.session)
      )
        throw new CloudError('storage');
      const session = recovery.session ?? local;
      const tabs = (session?.tabs ?? []).map((tab) => ({
        ...tab,
        ...(tab.remote ? { remote: { ...tab.remote } } : {}),
      }));
      for (const operation of recovery.operations) {
        if (recovery.suppressedOperations.includes(operation.operationId))
          continue;
        if (
          (operation.kind !== 'create' && operation.kind !== 'save') ||
          operation.content === undefined
        )
          continue;
        const document = operation.document ?? {
          connectionId: operation.connectionId,
          accountId: operation.accountId,
          connectionName: operation.connectionId,
          content: operation.content,
          item: {
            id: operation.itemId,
            name: operation.name ?? `${operation.itemId}.md`,
            kind: 'markdown' as const,
            parents: operation.folderId ? [operation.folderId] : [],
            validator: operation.validator,
            editable: true,
          },
        };
        const path = remoteDocumentPath(document);
        const existing = tabs.find((tab) => tab.path === path);
        if (existing?.remote) {
          if (
            operation.epoch &&
            operation.epoch === existing.remote.epoch &&
            operation.sequence !== undefined &&
            (existing.remote.sequence ?? -1) <= operation.sequence
          ) {
            existing.remote = {
              ...existing.remote,
              dirty: true,
              document: {
                ...existing.remote.document,
                content: operation.content,
              },
            };
          }
          existing.remote = {
            ...existing.remote,
            document: {
              ...existing.remote.document,
              ...(operation.notApplied
                ? { operationId: operation.operationId }
                : {}),
            },
            pendingSave: operation.notApplied
              ? undefined
              : {
                  operationId: operation.operationId,
                  content: operation.content,
                  validator: operation.validator ?? '',
                },
          };
        } else
          tabs.push({
            path,
            name: document.item.name,
            viewState: null,
            remote: {
              dirty: true,
              document: {
                ...document,
                content: operation.content,
                ...(operation.notApplied
                  ? { operationId: operation.operationId }
                  : {}),
              },
              baseline:
                operation.kind === 'create' || operation.notApplied
                  ? ''
                  : document.content,
              pendingSave: operation.notApplied
                ? undefined
                : {
                    operationId: operation.operationId,
                    content: operation.content,
                    validator: operation.validator ?? '',
                  },
            },
          });
      }
      const restored: SessionPayload | null =
        session || tabs.length
          ? {
              version: 3,
              tabs,
              activeFile: session?.activeFile ?? tabs[0]?.path ?? null,
              workspaceRoot: session?.workspaceRoot ?? null,
              assistant: session?.assistant,
            }
          : null;
      return AppSession.buildRestoreEnvelope(restored);
    } catch {
      this.blocked = true;
      return { ...AppSession.buildRestoreEnvelope(local), recoveryError: true };
    }
  }
  save(payload: SessionPayload): Promise<void> {
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        if (!AppSession.isValidPayload(payload))
          throw new CloudError('storage');
        if (payload.restoreEnabled === false) return;
        if (this.clearToken && payload.resumeAfterClear !== this.clearToken)
          return;
        if (this.blocked) throw new CloudError('storage');
        const {
          flushId: _flushId,
          failureCopy: _failureCopy,
          resumeAfterClear: _resume,
          ...checkpoint
        } = payload;
        const hasRemote = checkpoint.tabs.some((tab) => tab.remote);
        if (hasRemote)
          await this.store.saveSession(
            checkpoint,
            payload.cloudAcknowledgements,
          );
        const tabs = payload.tabs.filter(
          (tab) => !tab.remote && !isRemotePath(tab.path),
        );
        if (
          !this.local.save({
            version: 3,
            tabs,
            workspaceRoot: payload.workspaceRoot,
            assistant: payload.assistant,
            activeFile: tabs.some((tab) => tab.path === payload.activeFile)
              ? payload.activeFile
              : (tabs[0]?.path ?? null),
          })
        )
          throw new CloudError('storage');
        if (!hasRemote)
          await this.store.saveSession(
            checkpoint,
            payload.cloudAcknowledgements,
          );
      });
    this.queue = work;
    return work;
  }
  clear(): Promise<string> {
    const token = `clear-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.clearToken = token;
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        await this.store.saveSession(undefined);
        if (!this.local.clear()) throw new CloudError('storage');
        this.committedClearToken = token;
        this.blocked = false;
        return token;
      })
      .catch((error) => {
        if (this.clearToken === token)
          this.clearToken = this.committedClearToken;
        throw error;
      });
    this.queue = work;
    return work;
  }
}
