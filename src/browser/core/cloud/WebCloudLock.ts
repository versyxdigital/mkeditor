/** One page owns cloud metadata, credentials and recovery for this origin.
 * Web Locks are released by the browser when a page exits or crashes.
 */
export class WebCloudLock {
  owned = false;
  available: boolean;
  readonly ready: Promise<void>;
  private release?: () => void;
  private disposed = false;

  constructor(
    locks: LockManager | null | undefined = globalThis.navigator?.locks,
  ) {
    this.available = Boolean(locks);
    if (!locks) {
      this.ready = Promise.resolve();
      return;
    }
    this.ready = new Promise<void>((resolve) => {
      const fail = () => {
        this.available = false;
        resolve();
      };
      try {
        void locks
          .request(
            'mkeditor-cloud-editor',
            { mode: 'exclusive', ifAvailable: true },
            async (lock) => {
              if (!lock || this.disposed) {
                resolve();
                return;
              }
              this.owned = true;
              resolve();
              await new Promise<void>((release) => {
                this.release = release;
              });
            },
          )
          .catch(fail);
      } catch {
        fail();
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.owned = false;
    this.release?.();
    this.release = undefined;
  }
}
