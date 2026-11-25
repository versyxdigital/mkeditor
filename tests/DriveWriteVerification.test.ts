/** @jest-environment node */
import { createServer } from 'http';
import { createHash } from 'crypto';
import type { AddressInfo } from 'net';
import { verifyDriveWritePrecondition } from '../src/app/lib/cloud/DriveWriteVerification';

async function fixture(
  mode:
    | 'enforce'
    | 'ignore'
    | 'no-etag'
    | 'lost-create'
    | 'wrong-owner'
    | 'counter-on-reject'
    | 'metadata-on-reject',
) {
  const state = {
    created: false,
    posts: 0,
    version: 1,
    content: '',
    marker: '',
    trashed: false,
    uploads: 0,
    contentRevision: 1,
    modifiedTime: '2026-01-01T00:00:00Z',
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    let body = '';
    for await (const chunk of request) body += chunk;
    const json = (data: unknown, status = 200) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        ...(mode !== 'no-etag' ? { ETag: `"revision-${state.version}"` } : {}),
      });
      response.end(JSON.stringify(data));
    };
    if (url.pathname.endsWith('/generateIds')) {
      json({ ids: ['test-owned-id'] });
      return;
    }
    if (request.method === 'POST') {
      state.posts++;
      state.created = true;
      const meta = JSON.parse(body.match(/\r\n\r\n({[\s\S]*?})\r\n--/)![1]);
      state.marker =
        mode === 'wrong-owner'
          ? 'another-owner'
          : meta.appProperties.mkeditorWriteVerification;
      if (mode === 'lost-create') {
        request.socket.destroy();
        return;
      }
      json({ id: 'test-owned-id' });
      return;
    }
    if (!state.created) {
      json({}, 404);
      return;
    }
    if (
      url.pathname.startsWith('/upload/') &&
      (request.method === 'PATCH' || request.method === 'PUT')
    ) {
      state.uploads++;
      if (
        mode !== 'ignore' &&
        request.headers['if-match'] &&
        request.headers['if-match'] !== `"revision-${state.version}"`
      ) {
        if (mode === 'counter-on-reject') state.version++;
        if (mode === 'metadata-on-reject')
          state.modifiedTime = '2026-01-02T00:00:00Z';
        json({}, 412);
        return;
      }
      state.content = request.headers['content-type']?.startsWith('multipart/')
        ? body.match(
            /Content-Type: text\/markdown; charset=utf-8\r\n\r\n([\s\S]*?)\r\n--/,
          )![1]
        : body;
      state.version++;
      state.contentRevision++;
      json({ id: 'test-owned-id' });
      return;
    }
    if (request.method === 'PATCH') {
      state.trashed = true;
      json({ id: 'test-owned-id' });
      return;
    }
    if (url.searchParams.get('alt') === 'media') {
      if (mode !== 'no-etag')
        response.setHeader('ETag', `"revision-${state.version}"`);
      response.end(state.content);
      return;
    }
    json({
      id: 'test-owned-id',
      ...(mode !== 'no-etag' ? { etag: `"revision-${state.version}"` } : {}),
      version: String(state.version),
      headRevisionId: `content-${state.contentRevision}`,
      md5Checksum: createHash('md5').update(state.content).digest('hex'),
      name: 'test.md',
      mimeType: 'text/markdown',
      parents: ['root'],
      modifiedTime: state.modifiedTime,
      appProperties: { mkeditorWriteVerification: state.marker },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    state,
    endpoints: {
      api: `${base}/drive/v3/`,
      upload: `${base}/upload/drive/v3/files`,
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test.each(['enforce', 'lost-create'] as const)(
  'requires three current controls and three stale rejections (%s)',
  async (mode) => {
    const server = await fixture(mode);
    try {
      const report = await verifyDriveWritePrecondition(
        'fixture-access',
        server.endpoints,
      );
      expect(report).toMatchObject({ outcome: 'pass', trashed: true });
      expect(report.rounds).toHaveLength(3);
      expect(
        report.rounds.every(
          (round) =>
            round.currentStatus === 200 &&
            round.staleStatus === 412 &&
            round.newerContentPreserved &&
            round.newerRevisionPreserved,
        ),
      ).toBe(true);
      expect(server.state.posts).toBe(1);
      expect(server.state.trashed).toBe(true);
      expect(JSON.stringify(report)).not.toContain('fixture-access');
    } finally {
      await server.close();
    }
  },
);

test('an endpoint that ignores If-Match fails the gate rather than being enabled', async () => {
  const server = await fixture('ignore');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
    );
    expect(report).toMatchObject({
      outcome: 'fail',
      reason: 'stale-write-not-safely-rejected',
      trashed: true,
    });
    expect(report.rounds[0]).toMatchObject({
      staleStatus: 200,
      newerContentPreserved: false,
    });
  } finally {
    await server.close();
  }
});

test('v2 checks the File.etag on the actual PUT upload endpoint', async () => {
  const server = await fixture('enforce');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
      {
        metadata: server.endpoints.api.replace('/v3/', '/v2/'),
        upload: server.endpoints.upload.replace('/v3/', '/v2/'),
      },
    );
    expect(report).toMatchObject({
      apiVersion: 'v2',
      outcome: 'pass',
      validatorSource: 'Drive v2 File.etag',
      trashed: true,
    });
    expect(report.rounds).toHaveLength(3);
  } finally {
    await server.close();
  }
});

test('v2 multipart applies the condition on the real upload request and preserves content', async () => {
  const server = await fixture('enforce');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
      {
        metadata: server.endpoints.api.replace('/v3/', '/v2/'),
        upload: server.endpoints.upload.replace('/v3/', '/v2/'),
        multipart: true,
      },
    );
    expect(report).toMatchObject({
      apiVersion: 'v2',
      outcome: 'pass',
      trashed: true,
    });
    expect(report.endpoint).toContain('uploadType=multipart');
    expect(report.rounds).toHaveLength(3);
  } finally {
    await server.close();
  }
});

test('an internal counter advance does not imply that the content revision changed', async () => {
  const server = await fixture('counter-on-reject');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
    );
    expect(report.outcome).toBe('pass');
    expect(
      report.rounds.every(
        (round) =>
          round.staleStatus === 412 &&
          round.newerContentPreserved &&
          round.newerRevisionPreserved &&
          round.newerMetadataPreserved &&
          !round.resourceVersionPreserved,
      ),
    ).toBe(true);
  } finally {
    await server.close();
  }
});

test('a stale request that changes visible metadata fails even when the bytes survive', async () => {
  const server = await fixture('metadata-on-reject');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
    );
    expect(report.outcome).toBe('fail');
    expect(report.rounds[0]).toMatchObject({
      staleStatus: 412,
      newerContentPreserved: true,
      newerRevisionPreserved: true,
      newerMetadataPreserved: false,
    });
  } finally {
    await server.close();
  }
});

test('missing strong validators are inconclusive and do not cause unconditional update experiments', async () => {
  const server = await fixture('no-etag');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
    );
    expect(report).toMatchObject({
      outcome: 'inconclusive',
      reason: 'no-provider-issued-strong-etag',
      trashed: true,
    });
    expect(server.state.uploads).toBe(0);
  } finally {
    await server.close();
  }
});

test('a file without this run’s ownership marker is neither updated nor trashed', async () => {
  const server = await fixture('wrong-owner');
  try {
    const report = await verifyDriveWritePrecondition(
      'fixture-access',
      server.endpoints,
    );
    expect(report.outcome).toBe('inconclusive');
    expect(server.state.uploads).toBe(0);
    expect(server.state.trashed).toBe(false);
  } finally {
    await server.close();
  }
});
