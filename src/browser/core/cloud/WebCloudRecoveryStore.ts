import type { SessionPayload } from '../../../app/interfaces/Session';
import {
  CloudRecoveryBase,
  emptyRecovery,
  parseRecoveryData,
  serializeRecoveryData,
  type RecoveryData,
} from '../../../app/lib/cloud/CloudRecoveryBase';
import { CloudError } from '../../../app/lib/cloud/CloudError';

/** Atomic synchronous generations also protect the final beforeunload draft checkpoint.
 * Browser document storage is origin-scoped; OAuth credentials never enter this record.
 */
export class WebCloudRecoveryStore extends CloudRecoveryBase {
  constructor(
    private readonly storage?: Storage,
    private readonly key = 'mkeditor-cloud-recovery',
  ) {
    super();
  }

  hasRecord(): boolean {
    try {
      return (
        (this.storage ?? globalThis.localStorage).getItem(this.key) !== null
      );
    } catch {
      throw new CloudError('storage');
    }
  }

  loadSync(): RecoveryData {
    try {
      const raw = (this.storage ?? globalThis.localStorage).getItem(this.key);
      return raw === null ? emptyRecovery() : parseRecoveryData(raw);
    } catch {
      throw new CloudError('storage');
    }
  }

  override async load(): Promise<RecoveryData> {
    return this.loadSync();
  }

  protected async readStorage(): Promise<string | null> {
    return (this.storage ?? globalThis.localStorage).getItem(this.key);
  }

  protected async writeStorage(serialized: string): Promise<void> {
    (this.storage ?? globalThis.localStorage).setItem(this.key, serialized);
  }

  private updateSync(change: (data: RecoveryData) => RecoveryData): void {
    try {
      // The service owns the exclusive Web Lock. Read the latest generation for
      // every mutation rather than retaining a stale cache.
      // No await separates this read from setItem, so an unload checkpoint cannot
      // be overwritten by an older asynchronous journal/cache generation.
      const next = change(this.loadSync());
      (this.storage ?? globalThis.localStorage).setItem(
        this.key,
        serializeRecoveryData(next),
      );
    } catch {
      throw new CloudError('storage');
    }
  }

  protected override update(
    change: (data: RecoveryData) => RecoveryData,
  ): Promise<void> {
    try {
      this.updateSync(change);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  saveSessionSync(
    session: SessionPayload | undefined,
    acknowledgements: string[] = [],
  ): void {
    this.updateSync(this.sessionChange(session, acknowledgements));
  }
}
