import { safeStorage } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { z } from 'zod';
import type { CloudConnection } from '../../interfaces/Cloud';
import type { DriveTokens } from './GoogleDrive';
import { CloudError } from './CloudError';

const connectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  clientId: z.string(),
  clientValue: z.string(),
  registration: z.enum(['mkeditor', 'custom']).optional(),
  writeAccess: z.boolean().optional(),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  status: z.enum(['connected', 'disconnected', 'reauthorize', 'connecting']),
  credential: z.string().optional(),
});
type StoredConnection = CloudConnection & { credential?: string };
const schema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema),
});
const tokensSchema = z.object({
  access: z.string(),
  refresh: z.string(),
  expires: z.number(),
  scopes: z.array(z.string()).optional(),
});

export interface CloudPersistence {
  load(): StoredConnection[];
  save(connections: StoredConnection[]): void;
  available(): Promise<boolean>;
  encrypt(tokens: DriveTokens): Promise<string>;
  decrypt(encoded: string): Promise<DriveTokens>;
}

/** A separate atomic store; unrelated settings, sessions and AI data stay untouched. */
export class CloudStore implements CloudPersistence {
  private readonly path = join(homedir(), '.mkeditor', 'connections.json');
  load(): StoredConnection[] {
    if (!existsSync(this.path)) return [];
    try {
      const result = schema.safeParse(
        JSON.parse(readFileSync(this.path, 'utf8')),
      );
      if (!result.success) throw new CloudError('storage');
      return result.data.connections.map((entry) =>
        entry.status === 'connecting'
          ? { ...entry, status: 'disconnected' }
          : entry,
      );
    } catch {
      throw new CloudError('storage');
    }
  }
  save(connections: StoredConnection[]): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        this.path + '.tmp',
        JSON.stringify({ version: 1, connections }),
        { encoding: 'utf8', mode: 0o600 },
      );
      renameSync(this.path + '.tmp', this.path);
    } catch {
      throw new CloudError('storage');
    }
  }
  async available(): Promise<boolean> {
    try {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      if (
        process.platform === 'linux' &&
        ['basic_text', 'unknown'].includes(
          safeStorage.getSelectedStorageBackend(),
        )
      )
        return false;
      return available;
    } catch {
      return false;
    }
  }
  async encrypt(tokens: DriveTokens): Promise<string> {
    if (!(await this.available())) throw new CloudError('storage');
    try {
      return (
        await safeStorage.encryptStringAsync(JSON.stringify(tokens))
      ).toString('base64');
    } catch {
      throw new CloudError('storage');
    }
  }
  async decrypt(encoded: string): Promise<DriveTokens> {
    if (!(await this.available())) throw new CloudError('storage');
    try {
      return tokensSchema.parse(
        JSON.parse(
          (await safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64')))
            .result,
        ),
      );
    } catch {
      throw new CloudError('auth');
    }
  }
}
