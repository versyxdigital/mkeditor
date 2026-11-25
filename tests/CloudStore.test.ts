/** @jest-environment node */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

beforeEach(() => {
  jest.dontMock('fs');
  jest.dontMock('os');
  jest.resetModules();
});

test('an explicit cloud store location isolates persisted connections across instances', () => {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-cloud-isolation-'));
  try {
    const { CloudStore } =
      require('../src/app/lib/cloud/CloudStore') as typeof import('../src/app/lib/cloud/CloudStore');
    const file = join(root, 'smoke', 'connections.json');
    const connection = {
      id: 'smoke',
      name: 'Smoke account',
      clientId: 'client',
      clientValue: '',
      status: 'disconnected' as const,
      hasConnected: true,
    };
    new CloudStore(file).save([connection]);
    expect(new CloudStore(file).load()).toEqual([connection]);
    expect(
      new CloudStore(join(root, 'other', 'connections.json')).load(),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('credentials cross the safeStorage boundary and corrupt loads leave the file intact', async () => {
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
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledWith(
      JSON.stringify(tokens),
    );
    expect(await store.decrypt(credential)).toEqual(tokens);
    expect(safeStorage.decryptStringAsync).toHaveBeenCalledWith(
      Buffer.from(credential, 'base64'),
    );
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

test('replaces existing connections through a staged write followed by rename', () => {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-cloud-atomic-'));
  const file = join(root, 'connections.json');
  const calls: string[] = [];
  const fs = jest.requireActual('fs') as typeof import('fs');
  try {
    writeFileSync(file, JSON.stringify({ version: 1, connections: [] }));
    jest.doMock('fs', () => ({
      ...fs,
      writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
        calls.push(`write:${args[0]}`);
        return fs.writeFileSync(...args);
      },

      renameSync: (from: string, to: string) => {
        calls.push(`rename:${from}->${to}`);
        return fs.renameSync(from, to);
      },
    }));
    const { CloudStore } =
      require('../src/app/lib/cloud/CloudStore') as typeof import('../src/app/lib/cloud/CloudStore');
    const connections = [
      {
        id: 'atomic',
        name: 'Drive',
        clientId: 'client',
        clientValue: '',
        status: 'disconnected' as const,
      },
    ];
    const store = new CloudStore(file);
    store.save(connections);
    expect(calls).toEqual([`write:${file}.tmp`, `rename:${file}.tmp->${file}`]);
    expect(store.load()).toEqual(connections);
    expect(existsSync(file + '.tmp')).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(['write', 'rename'] as const)(
  'preserves the previous connection store when %s fails',
  (failure) => {
    const root = mkdtempSync(join(tmpdir(), 'mkeditor-cloud-failure-'));
    const file = join(root, 'connections.json');
    const previous = JSON.stringify({ version: 1, connections: [] });
    const fs = jest.requireActual('fs') as typeof import('fs');
    try {
      writeFileSync(file, previous);
      const deny = () => {
        throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
      };
      jest.doMock('fs', () => ({
        ...fs,
        writeFileSync: failure === 'write' ? deny : fs.writeFileSync,
        renameSync: failure === 'rename' ? deny : fs.renameSync,
      }));
      const { CloudStore } =
        require('../src/app/lib/cloud/CloudStore') as typeof import('../src/app/lib/cloud/CloudStore');
      expect(() => new CloudStore(file).save([])).toThrow('storage');
      expect(readFileSync(file, 'utf8')).toBe(previous);
      expect(new CloudStore(file).load()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
