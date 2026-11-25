import type { CloudProviderId } from '../../src/app/interfaces/Cloud';
import type { WebCloudAuthorization } from '../../src/browser/core/cloud/WebCloudProviders';
import { WebCloudLock } from '../../src/browser/core/cloud/WebCloudLock';

export class MemoryCloudStorage implements Storage {
  private readonly data = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.data.set(key, value);
  }
}

export function browserAuth() {
  const values = { expires: Date.now() + 3600_000, grantWrite: true };
  const auth: WebCloudAuthorization = {
    configured: () => true,

    registration: (provider: CloudProviderId) => ({
      clientId:
        provider === 'dropbox'
          ? 'fixture-dropbox-key'
          : 'fixture.apps.googleusercontent.com',
      clientValue: '',
    }),

    beginAuthorization: jest.fn((_provider, scopes) => ({
      result: Promise.resolve({
        access: 'fixture-access',
        refresh: '',
        expires: values.expires,
        scopes: values.grantWrite
          ? [...scopes]
          : [...scopes].filter(
              (scope) => !scope.endsWith('/drive') && !scope.endsWith('.write'),
            ),
      }),
      cancel: jest.fn(),
    })),

    reserveAuthorization: jest.fn(() => jest.fn()),

    prepare: async () => {},

    dispose: jest.fn(),
  };
  return { auth, values };
}

export function browserOwnership(available = true) {
  const locks = {
    request: jest.fn((_name, _options, callback) =>
      callback(available ? { name: 'cloud', mode: 'exclusive' } : null),
    ),
  } as unknown as LockManager;
  return new WebCloudLock(locks);
}
