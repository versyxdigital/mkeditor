import { z } from 'zod';
import type { CloudConnection } from '../../../app/interfaces/Cloud';
import type { CloudTokens } from '../../../app/lib/cloud/CloudProvider';
import type { CloudPersistence } from '../../../app/lib/cloud/CloudStore';
import { CloudError } from '../../../app/lib/cloud/CloudError';

const connectionSchema = z.object({
  provider: z.enum(['google-drive', 'dropbox']).optional(),
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  clientId: z.string(),
  clientValue: z.literal(''),
  registration: z.enum(['mkeditor', 'custom']).optional(),
  writeAccess: z.boolean().optional(),
  hasConnected: z.boolean().optional(),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  status: z.enum(['connected', 'disconnected', 'reauthorize', 'connecting']),
});
type StoredConnection = CloudConnection & { credential?: string };

/** Only public metadata persists. Opaque credential handles and tokens die with the page. */
export class WebCloudStore implements CloudPersistence {
  private readonly credentials = new Map<string, CloudTokens>();
  constructor(
    private readonly storage?: Storage,
    private readonly key = 'mkeditor-cloud-connections',
  ) {}

  load(): StoredConnection[] {
    try {
      const raw = (this.storage ?? globalThis.localStorage).getItem(this.key);
      if (raw === null) return [];
      const data = z
        .object({
          version: z.literal(1),
          connections: z.array(connectionSchema).max(100),
        })
        .parse(JSON.parse(raw));
      return data.connections.map((entry) => ({
        ...entry,
        status:
          entry.status === 'connected' || entry.status === 'connecting'
            ? 'reauthorize'
            : entry.status,
      }));
    } catch {
      throw new CloudError('storage');
    }
  }

  save(connections: StoredConnection[]): void {
    try {
      const metadata = z
        .array(connectionSchema)
        .max(100)
        .parse(
          connections.map(({ credential: _credential, ...entry }) => entry),
        );
      const retained = new Set(connections.map((entry) => entry.credential));
      for (const key of this.credentials.keys())
        if (!retained.has(key)) this.credentials.delete(key);
      (this.storage ?? globalThis.localStorage).setItem(
        this.key,
        JSON.stringify({ version: 1, connections: metadata }),
      );
    } catch {
      throw new CloudError('storage');
    }
  }

  async available(): Promise<boolean> {
    try {
      const key = `${this.key}-probe-${crypto.randomUUID()}`;
      (this.storage ?? globalThis.localStorage).setItem(key, '');
      (this.storage ?? globalThis.localStorage).removeItem(key);
      return Boolean(globalThis.crypto?.subtle);
    } catch {
      return false;
    }
  }

  async encrypt(tokens: CloudTokens): Promise<string> {
    const reference = crypto.randomUUID();
    this.credentials.set(reference, { ...tokens, refresh: '' });
    return reference;
  }

  async decrypt(reference: string): Promise<CloudTokens> {
    const tokens = this.credentials.get(reference);
    if (!tokens) throw new CloudError('auth');
    return tokens;
  }

  dispose(): void {
    this.credentials.clear();
  }
}
