import { mergeCloudSession } from './CloudSessionMerge';
import type {
  SessionPayload,
  SessionRestoreEnvelope,
} from '../../interfaces/Session';
import { isRemotePath } from '../../interfaces/Cloud';
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
      const restored = mergeCloudSession(local, {
        ...recovery,
        session: recovery.session as SessionPayload | undefined,
      });
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
