/** @jest-environment node */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

test('credentials use OS encryption, atomic writes and corrupt stores are never silently overwritten', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-cloud-test-'));
  try {
    jest.resetModules();
    jest.doMock('os', () => ({
      ...jest.requireActual('os'),
      homedir: () => root,
    }));
    const { CloudStore } =
      require('../src/app/lib/cloud/CloudStore') as typeof import('../src/app/lib/cloud/CloudStore');
    const { safeStorage } = require('electron') as typeof import('electron');
    const store = new CloudStore();
    const tokens = {
      access: 'fixture-access',
      refresh: 'fixture-refresh',
      expires: 123,
    };
    expect(await store.available()).toBe(true);
    const credential = await store.encrypt(tokens);
    expect(await store.decrypt(credential)).toEqual(tokens);
    store.save([
      {
        id: 'drive',
        name: 'Drive',
        clientId: 'client',
        clientValue: '',
        status: 'connected',
        credential,
      },
    ]);
    const file = join(root, '.mkeditor', 'connections.json');
    expect(readFileSync(file, 'utf8')).not.toMatch(
      /fixture-access|fixture-refresh/,
    );
    expect(store.load()[0].credential).toBe(credential);
    jest
      .mocked(safeStorage.isAsyncEncryptionAvailable)
      .mockResolvedValueOnce(false);
    await expect(store.encrypt(tokens)).rejects.toMatchObject({
      code: 'storage',
    });
    writeFileSync(file, '{corrupt');
    expect(() => store.load()).toThrow('storage');
    expect(readFileSync(file, 'utf8')).toBe('{corrupt');
  } finally {
    rmSync(root, { recursive: true, force: true });
    jest.dontMock('os');
  }
});
