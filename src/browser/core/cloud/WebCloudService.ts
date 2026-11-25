import type {
  CloudCommand,
  CloudResponse,
} from '../../../app/interfaces/Cloud';
import { WebCloudLock } from './WebCloudLock';
import { z } from 'zod';
import type { CloudState } from '../../../app/interfaces/Cloud';
import {
  isRemotePath,
  remoteDocumentPath,
} from '../../../app/interfaces/Cloud';
import type { SessionPayload } from '../../../app/interfaces/Session';
import {
  CloudServiceBase,
  cloudRequestSchema,
} from '../../../app/lib/cloud/CloudServiceBase';
import { remoteTabSchema } from '../../../app/lib/cloud/CloudRecoveryBase';
import { mergeCloudSession } from '../../../app/lib/cloud/CloudSessionMerge';
import { CloudError } from '../../../app/lib/cloud/CloudError';
import { WebCloudAuth, type WebCloudConfig } from './WebCloudAuth';
import { WebCloudStore } from './WebCloudStore';
import { WebCloudRecoveryStore } from './WebCloudRecoveryStore';
import {
  WebDropbox,
  WebGoogleDrive,
  type WebCloudAuthorization,
} from './WebCloudProviders';

const sessionSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    tabs: z
      .array(
        z.object({
          path: z.string().min(1).max(8192),
          name: z.string().max(1024),
          viewState: z.unknown(),
          untitledContent: z
            .string()
            .max(4 * 1024 * 1024)
            .optional(),
          remote: remoteTabSchema.optional(),
        }),
      )
      .max(512),
    activeFile: z.string().nullable(),
    workspaceRoot: z.string().nullable(),
    webCheckpointId: z.string().min(1).max(128).optional(),
    previousWebCheckpointId: z.string().min(1).max(128).nullable().optional(),
  })
  .passthrough();

const recoveryMutations = new Set<CloudCommand['action']>([
  'save',
  'create',
  'move',
  'createFolder',
  'reconcile',
  'reconcileItem',
  'acknowledge',
  'discardDocument',
]);

interface WebSessionCheckpoint extends SessionPayload {
  webCheckpointId?: string;
  previousWebCheckpointId?: string | null;
}

function newCheckpointId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    // Local-only editing remains available without a secure-context crypto API.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function normalizeCheckpointId(
  value: string | null | undefined,
): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : null;
}

function validatedSession(value: unknown): WebSessionCheckpoint {
  const result = sessionSchema.safeParse(value);
  if (
    !result.success ||
    result.data.tabs.some((tab) =>
      tab.remote
        ? tab.path !== remoteDocumentPath(tab.remote.document)
        : isRemotePath(tab.path),
    )
  )
    throw new CloudError('storage');
  return result.data as WebSessionCheckpoint;
}

/** Browser composition: memory-only authorization, shared save safety, durable origin-scoped drafts. */
export class WebCloudService extends CloudServiceBase {
  readonly recovery: WebCloudRecoveryStore;
  private readonly auth: WebCloudAuthorization;
  private readonly browserStore: WebCloudStore;
  private readonly ownership: WebCloudLock;
  private readonly beforeDispose?: () => void;
  private readonly pageHide = (event: PageTransitionEvent) => {
    try {
      // Mobile navigation may skip beforeunload. Keep the service writable
      // until the synchronous final document checkpoint has completed.
      this.beforeDispose?.();
    } finally {
      if (event.persisted)
        globalThis.window.addEventListener(
          'pageshow',
          () => {
            globalThis.window.location.reload();
          },
          { once: true },
        );
      this.dispose();
    }
  };
  private activeRequests = 0;
  private closing = false;
  private blocked = false;
  private clearToken?: string;
  private latestCheckpointId?: string;

  get checkpointId(): string | undefined {
    return this.latestCheckpointId;
  }

  constructor(
    push: (state: CloudState) => void,
    options: {
      config?: WebCloudConfig;
      auth?: WebCloudAuthorization;
      storage?: Storage;
      ownership?: WebCloudLock;
      beforeDispose?: () => void;
    } = {},
  ) {
    const auth = options.auth ?? new WebCloudAuth(options.config);
    const store = new WebCloudStore(options.storage);
    const recovery = new WebCloudRecoveryStore(options.storage);
    super(
      store,
      async () => {},
      push,
      new WebGoogleDrive(auth),
      auth.configured('google-drive')
        ? auth.registration('google-drive')
        : null,
      recovery,
      {
        dropbox: new WebDropbox(auth),
        dropboxRegistration: auth.configured('dropbox')
          ? auth.registration('dropbox')
          : null,
      },
    );
    this.auth = auth;
    this.browserStore = store;
    this.recovery = recovery;
    this.ownership = options.ownership ?? new WebCloudLock();
    this.beforeDispose = options.beforeDispose;
    globalThis.window?.addEventListener('pagehide', this.pageHide);
    void this.ownership.ready
      .then(() => {
        if (this.ownership.owned && !this.closing) return auth.prepare();
      })
      .catch(() => {});
  }

  override async state(): Promise<CloudState> {
    await this.ownership.ready;
    if (!this.ownership.owned)
      return {
        revision: 0,
        connections: [],
        secureStorage: false,
        googleDriveAvailable: this.auth.configured('google-drive'),
        dropboxAvailable: this.auth.configured('dropbox'),
        browserAccess: this.ownership.available ? 'busy' : 'unavailable',
      };
    return {
      ...(await super.state()),
      ...(this.blocked ? { recoveryError: true } : {}),
    };
  }

  private assertRecoveryWritable(): void {
    if (this.blocked) throw new CloudError('storage');
    try {
      const { session } = this.recovery.loadSync();
      if (session !== undefined) validatedSession(session);
    } catch {
      this.blocked = true;
      throw new CloudError('storage');
    }
  }

  override async handle(input: unknown): Promise<CloudResponse> {
    const parsed = cloudRequestSchema.safeParse(input);
    if (!parsed.success) return super.handle(input);
    const { requestId, command } = parsed.data;
    if (this.closing) return { requestId, ok: false, error: 'cancelled' };
    if (
      command?.action === 'add' &&
      (command.clientId !== undefined || command.clientValue !== undefined)
    )
      return { requestId, ok: false, error: 'configuration' };
    this.activeRequests++;
    let release: (() => void) | undefined;
    // Reserve a popup within the original click, before the engine awaits its
    // storage/account checks. A reservation contains no credentials or grant.
    try {
      if (this.ownership.owned) {
        const provider =
          command?.action === 'add' && command.authorize
            ? (command.provider ?? 'google-drive')
            : command?.action === 'connect'
              ? (this.browserStore
                  .load()
                  .find((entry) => entry.id === command.connectionId)
                  ?.provider ?? 'google-drive')
              : undefined;
        if (provider) release = this.auth.reserveAuthorization(provider);
      }
      await this.ownership.ready;
      if (!this.ownership.owned) {
        if (command?.action === 'state')
          return {
            requestId,
            ok: true,
            state: await this.state(),
          };
        return { requestId, ok: false, error: 'storage' };
      }
      // Validate the existing session as well as the operation journal before
      // any mutation, including requests arriving before bootstrap restores it.
      if (recoveryMutations.has(command.action)) this.assertRecoveryWritable();
      return await super.handle(input);
    } catch (error) {
      return {
        requestId,
        ok: false,
        error: error instanceof CloudError ? error.code : 'network',
      };
    } finally {
      release?.();
      this.activeRequests--;
      if (this.closing && this.activeRequests === 0) this.ownership.dispose();
    }
  }

  async restoreSession(
    local: SessionPayload | null,
    currentLocalCheckpointId?: string | null,
  ): Promise<SessionPayload | null> {
    await this.ownership.ready;
    if (!this.ownership.owned) {
      if (!this.recovery.hasRecord()) return local;
      throw new CloudError('storage');
    }
    try {
      const recovery = this.recovery.loadSync();
      let session =
        recovery.session === undefined
          ? undefined
          : validatedSession(recovery.session);
      const localCheckpointId = normalizeCheckpointId(currentLocalCheckpointId);
      if (
        session &&
        local &&
        localCheckpointId !== (session.webCheckpointId ?? null) &&
        localCheckpointId !== (session.previousWebCheckpointId ?? null)
      ) {
        // A different local generation was committed independently (for example
        // in a second, cloud-blocked page). Its local tabs supersede the older
        // mixed snapshot, including tabs explicitly closed there. When the local
        // ID still equals the previous generation, its write failed after the
        // cloud checkpoint and the complete cloud snapshot is the newer fallback.
        const remoteTabs = session.tabs.filter((tab) => tab.remote);
        const tabs = [
          ...local.tabs.filter((tab) => !tab.remote && !isRemotePath(tab.path)),
          ...remoteTabs,
        ];
        const cloudActiveFile = session.activeFile;
        const remoteActive = remoteTabs.some(
          (tab) => tab.path === cloudActiveFile,
        );
        session = {
          ...session,
          tabs,
          activeFile: remoteActive ? session.activeFile : local.activeFile,
          workspaceRoot: local.workspaceRoot,
          assistant: local.assistant,
        };
      }
      this.blocked = false;
      return mergeCloudSession(local, { ...recovery, session });
    } catch {
      this.blocked = true;
      throw new CloudError('storage');
    }
  }

  /** False means a cleared/disabled checkpoint must also skip the local session store. */
  saveSessionSync(
    payload: SessionPayload,
    previousLocalCheckpointId?: string | null,
  ): boolean {
    if (this.closing) throw new CloudError('cancelled');
    validatedSession(payload);
    if (payload.restoreEnabled === false) return false;
    if (this.clearToken && payload.resumeAfterClear !== this.clearToken)
      return false;
    if (!this.ownership.owned) {
      if (payload.tabs.some((tab) => tab.remote))
        throw new CloudError('storage');
      this.latestCheckpointId = newCheckpointId();
      return true;
    }
    this.assertRecoveryWritable();
    const {
      flushId: _flush,
      failureCopy: _copy,
      resumeAfterClear: _resume,
      ...checkpoint
    } = payload;
    const webCheckpointId = newCheckpointId();
    const generation: WebSessionCheckpoint = {
      ...checkpoint,
      webCheckpointId,
      previousWebCheckpointId: normalizeCheckpointId(previousLocalCheckpointId),
    };
    this.recovery.saveSessionSync(generation, payload.cloudAcknowledgements);
    this.latestCheckpointId = webCheckpointId;
    return true;
  }

  async saveSession(payload: SessionPayload): Promise<void> {
    this.saveSessionSync(payload);
  }

  async clearSession(): Promise<string> {
    await this.ownership.ready;
    const token = `clear-${crypto.randomUUID()}`;
    if (!this.ownership.owned) {
      if (this.recovery.hasRecord()) throw new CloudError('storage');
      this.clearToken = token;
      return token;
    }
    this.recovery.saveSessionSync(undefined);
    this.clearToken = token;
    this.blocked = false;
    return token;
  }

  override dispose(): void {
    this.closing = true;
    super.dispose();
    this.auth.dispose();
    this.browserStore.dispose();
    if (this.activeRequests === 0) this.ownership.dispose();
    globalThis.window?.removeEventListener('pagehide', this.pageHide);
  }
}
