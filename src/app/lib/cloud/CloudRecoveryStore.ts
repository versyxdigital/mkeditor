import { safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { CloudRecoveryBase } from './CloudRecoveryBase';
import { CloudError } from './CloudError';
import { CloudStore } from './CloudStore';
export {
  recoveryItemSchema,
  remoteTabSchema,
  type RecoveryOperation,
} from './CloudRecoveryBase';

/** Desktop recovery stays encrypted with the OS credential store and atomic rename. */
export class CloudRecoveryStore extends CloudRecoveryBase {
  constructor(
    private readonly path = join(homedir(), '.mkeditor', 'cloud-recovery.bin'),
  ) {
    super();
  }

  protected async readStorage(): Promise<string | null> {
    const stat = await fs.stat(this.path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return null;
    if (stat.size > 128 * 1024 * 1024 || !(await new CloudStore().available()))
      throw new CloudError('storage');
    return (await safeStorage.decryptStringAsync(await fs.readFile(this.path)))
      .result;
  }

  protected async writeStorage(serialized: string): Promise<void> {
    if (!(await new CloudStore().available())) throw new CloudError('storage');
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
  }
}
export const cloudRecoveryStore = new CloudRecoveryStore();
