/** @jest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CloudService } from '../src/app/lib/cloud/CloudService';
import {
  GoogleDrive,
  DRIVE_SCOPE,
  DRIVE_WRITE_SCOPE,
} from '../src/app/lib/cloud/GoogleDrive';
import { Dropbox } from '../src/app/lib/cloud/Dropbox';
import type {
  CloudProvider,
  CloudRegistration,
} from '../src/app/lib/cloud/CloudProvider';
import type { CloudPersistence } from '../src/app/lib/cloud/CloudStore';
import type {
  CloudCommand,
  CloudProviderId,
  CloudResponse,
  RemoteDocument,
} from '../src/app/interfaces/Cloud';
import { remoteDocumentPath } from '../src/app/interfaces/Cloud';
import { CloudRecoveryStore } from '../src/app/lib/cloud/CloudRecoveryStore';
import { CloudSessionRecovery } from '../src/app/lib/cloud/CloudSessionRecovery';
import { driveFixture } from './fixtures/driveServer';
import { dropboxFixture } from './fixtures/dropboxServer';

interface Fixture {
  provider: CloudProvider;
  registration: CloudRegistration;
  itemId: string;
  loseResponse(): void;
  externalEdit(content: string): void;
  account(value: string): void;
  contents(): string;
  writes(): number;
  revoke(): void;
  close(): Promise<void>;
}
async function fixtureFor(id: CloudProviderId): Promise<Fixture> {
  if (id === 'dropbox') {
    const f = await dropboxFixture();
    return {
      provider: new Dropbox(f.endpoints, 0),
      registration: { clientId: 'fixture-dropbox', clientValue: '' },
      itemId: 'id:markdown',
      loseResponse: () => {
        f.state.loseWriteReply = true;
      },
      externalEdit: (content) => f.externalEdit('id:markdown', content),
      account: (value) => {
        f.state.account = value;
      },
      contents: () => f.files.get('id:markdown')!.content,
      writes: () => f.state.writes,
      revoke: () => {
        f.state.revoked = true;
      },
      close: f.close,
    };
  }
  const f = await driveFixture();
  f.state.scopes = `${DRIVE_SCOPE} ${DRIVE_WRITE_SCOPE}`;
  return {
    provider: new GoogleDrive(f.endpoints),
    registration: {
      clientId: 'fixture.apps.googleusercontent.com',
      clientValue: 'public-value',
    },
    itemId: 'markdown',
    loseResponse: () => {
      f.state.loseWrite = true;
    },
    externalEdit: (content) => {
      f.state.content = content;
      f.state.revision = String(Number(f.state.revision) + 1);
    },
    account: (value) => {
      f.state.accountId = value;
    },
    contents: () => f.state.content,
    writes: () =>
      f.calls.filter(
        (call) =>
          call.method === 'PUT' ||
          (call.method === 'POST' && call.url.pathname.startsWith('/upload/')),
      ).length,
    revoke: () => {
      f.state.revoked = true;
      f.state.override = (_url, response) => {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 401 } }));
        return true;
      };
    },
    close: f.close,
  };
}
const success = (result: CloudResponse) => {
  if (!result.ok) throw Error(`Unexpected provider error: ${result.error}`);
  return result;
};

describe.each(['google-drive', 'dropbox'] as const)(
  '%s shared cloud contract',
  (providerId) => {
    let fixture: Fixture,
      service: CloudService,
      persistence: CloudPersistence,
      recovery: CloudRecoveryStore,
      directory: string;
    let data: ReturnType<CloudPersistence['load']>, authorize: URL | undefined;
    const construct = () =>
      new CloudService(
        persistence,
        async (url) => {
          authorize = new URL(url);
        },
        () => {},
        providerId === 'google-drive'
          ? (fixture.provider as GoogleDrive)
          : undefined,
        providerId === 'google-drive' ? fixture.registration : null,
        recovery,
        providerId === 'dropbox'
          ? {
              dropbox: fixture.provider,
              dropboxRegistration: fixture.registration,
            }
          : {},
      );
    const request = (command: CloudCommand) =>
      service.handle({ requestId: 'conformance', command });
    async function connect(id: string, writeAccess = true) {
      authorize = undefined;
      const connecting = request({
        action: 'connect',
        connectionId: id,
        writeAccess,
      });
      for (let i = 0; !authorize && i < 100; i++)
        await new Promise((resolve) => setTimeout(resolve, 2));
      if (!authorize) throw Error('No browser authorization request');
      const callback = new URL(authorize.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({
        code: 'fixture-code',
        state: authorize.searchParams.get('state')!,
      }).toString();
      await fetch(callback);
      return connecting;
    }
    async function open() {
      const added = success(
        await request({
          action: 'add',
          provider: providerId,
          name: 'Conformance',
          ...fixture.registration,
        }),
      );
      const id = added.connectionId!;
      success(await connect(id));
      return success(
        await request({
          action: 'open',
          connectionId: id,
          itemId: fixture.itemId,
        }),
      ).document!;
    }
    const save = (doc: RemoteDocument, operationId = 'save') =>
      request({
        action: 'save',
        operationId,
        connectionId: doc.connectionId,
        accountId: doc.accountId,
        itemId: doc.item.id,
        validator: doc.item.validator!,
        content: 'new writing',
        name: doc.item.name,
      });
    beforeEach(async () => {
      fixture = await fixtureFor(providerId);
      data = [];
      directory = mkdtempSync(join(tmpdir(), 'mkeditor-provider-'));
      recovery = new CloudRecoveryStore(join(directory, 'recovery.bin'));
      persistence = {
        load: () => data,
        save: (value) => {
          data = value;
        },
        available: async () => true,
        encrypt: async (tokens) => JSON.stringify(tokens),
        decrypt: async (encoded) => JSON.parse(encoded),
      };
      service = construct();
    });
    afterEach(async () => {
      service.dispose();
      await fixture.close();
      rmSync(directory, { recursive: true, force: true });
    });

    test('first sign-in is remembered across disconnect and restart without enabling editing', async () => {
      const added = success(
        await request({
          action: 'add',
          provider: providerId,
          name: 'First connection',
          ...fixture.registration,
        }),
      );
      expect(added.state.connections[0].hasConnected).toBeUndefined();
      const connected = success(await connect(added.connectionId!, false));
      expect(connected.state.connections[0]).toMatchObject({
        hasConnected: true,
        writeAccess: false,
      });
      success(
        await request({
          action: 'disconnect',
          connectionId: added.connectionId!,
        }),
      );
      service.dispose();
      service = construct();
      const restored = success(await request({ action: 'state' }));
      expect(restored.state.connections[0]).toMatchObject({
        hasConnected: true,
        writeAccess: false,
        status: 'disconnected',
      });
      const reconnected = success(await connect(added.connectionId!, false));
      expect(reconnected.state.connections[0]).toMatchObject({
        hasConnected: true,
        writeAccess: false,
        status: 'connected',
      });
    });

    test('verified account and provider identities survive an acknowledged conditional save', async () => {
      const doc = await open();
      expect(doc.provider).toBe(providerId);
      expect(doc.item.editable).toBe(true);
      expect(remoteDocumentPath(doc)).toMatch(
        providerId === 'dropbox' ? /^cloud-dropbox:/ : /^cloud-drive:/,
      );
      const saved = success(await save(doc)).document!;
      expect(saved.item.id).toBe(doc.item.id);
      expect(saved.content).toBe('new writing');
      expect(saved.item.validator).not.toBe(doc.item.validator);
      expect(fixture.contents()).toBe('new writing');
      expect(success(await save(doc)).document).toEqual(saved);
      expect(fixture.writes()).toBe(1);
    });
    test('an external revision is preserved after a stale save', async () => {
      const doc = await open();
      fixture.externalEdit('external writing');
      expect(await save(doc)).toMatchObject({ ok: false, error: 'conflict' });
      expect(fixture.contents()).toBe('external writing');
    });
    test('a lost acknowledgement survives service restart and reconciles without another write', async () => {
      const doc = await open();
      fixture.loseResponse();
      expect(await save(doc)).toMatchObject({
        ok: false,
        error: 'unconfirmed',
      });
      service.dispose();
      service = construct();
      expect((await service.state()).pendingOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: providerId,
            operationId: 'save',
          }),
        ]),
      );
      const result = success(
        await request({
          action: 'reconcile',
          operationId: 'save',
          connectionId: doc.connectionId,
          accountId: doc.accountId,
        }),
      );
      expect(result.document?.content).toBe('new writing');
      expect(fixture.writes()).toBe(1);
    });
    test('created documents and lost-create recovery retain authoritative identity', async () => {
      const doc = await open();
      fixture.loseResponse();
      expect(
        await request({
          action: 'create',
          operationId: 'create',
          connectionId: doc.connectionId,
          accountId: doc.accountId,
          folderId: 'root',
          name: 'created.md',
          content: 'creation snapshot',
        }),
      ).toMatchObject({ ok: false, error: 'unconfirmed' });
      service.dispose();
      service = construct();
      const envelope = await new CloudSessionRecovery(recovery).restore(null);
      expect(envelope.session?.tabs[0].remote?.document.provider).toBe(
        providerId,
      );
      expect(envelope.session?.tabs[0].remote?.document.content).toBe(
        'creation snapshot',
      );
      const result = success(
        await request({
          action: 'reconcile',
          operationId: 'create',
          connectionId: doc.connectionId,
          accountId: doc.accountId,
        }),
      );
      expect(result.document?.provider).toBe(providerId);
      expect(result.document?.content).toBe('creation snapshot');
      expect(fixture.writes()).toBe(1);
    });
    test('reauthorizing a different account cannot retarget an already-open document', async () => {
      const doc = await open();
      fixture.account('a-different-account');
      success(await connect(doc.connectionId));
      expect(await save(doc)).toMatchObject({ ok: false, error: 'auth' });
      expect(fixture.writes()).toBe(0);
    });
    test('disconnect clears credentials and account labels before any later write', async () => {
      const doc = await open();
      success(
        await request({ action: 'disconnect', connectionId: doc.connectionId }),
      );
      expect(data[0]).toMatchObject({ status: 'disconnected' });
      expect(data[0].credential).toBeUndefined();
      expect(data[0].accountId).toBeUndefined();
      expect(await save(doc)).toMatchObject({ ok: false, error: 'auth' });
      expect(fixture.writes()).toBe(0);
    });
    test('a recovery-store failure prevents contacting the provider for a write', async () => {
      const doc = await open();
      jest
        .spyOn(recovery, 'saveOperations')
        .mockRejectedValueOnce(new Error('disk unavailable'));
      expect((await save(doc)).ok).toBe(false);
      expect(fixture.writes()).toBe(0);
    });
    test('revoked access asks for reauthorization without a write', async () => {
      const doc = await open();
      fixture.revoke();
      expect(await save(doc)).toMatchObject({ ok: false, error: 'auth' });
      expect((await service.state()).connections[0].status).toBe('reauthorize');
      expect(fixture.writes()).toBe(0);
    });
  },
);
