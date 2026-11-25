import { randomUUID } from 'crypto';
import { z } from 'zod';

interface VerificationRound {
  round: number;
  currentStatus: number;
  staleStatus?: number;
  newerContentPreserved?: boolean;
  newerRevisionPreserved?: boolean;
  currentValidator?: string;
  staleValidator?: string;
  newerValidator?: string;
  beforeRevision?: string;
  afterRevision?: string;
  beforeResourceVersion?: string;
  afterResourceVersion?: string;
  resourceVersionPreserved?: boolean;
  newerMetadataPreserved?: boolean;
}
export interface DriveWriteVerificationReport {
  date: string;
  schemaVersion: 2;
  outcome: 'pass' | 'fail' | 'inconclusive';
  reason: string;
  itemId?: string;
  itemName?: string;
  apiVersion: 'v2' | 'v3';
  endpoint: string;
  conditionalHeader: 'If-Match';
  contentType: string;
  mediaContentType: 'text/markdown; charset=utf-8';
  validatorSource?: string;
  rounds: VerificationRound[];
  trashed: boolean;
}
const metaSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  appProperties: z.record(z.string(), z.string()).optional(),
  headRevisionId: z.string().optional(),
  md5Checksum: z.string().optional(),
  modifiedTime: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  parents: z.array(z.string()).optional(),
});

/** Opt-in live spike. Never called by renderer IPC; only mutates its own marked file. */
export async function verifyDriveWritePrecondition(
  accessToken: string,
  endpoints = {
    api: 'https://www.googleapis.com/drive/v3/',
    upload: 'https://www.googleapis.com/upload/drive/v3/files',
  },
  legacy?: { metadata: string; upload: string; multipart?: boolean },
): Promise<DriveWriteVerificationReport> {
  const nonce = randomUUID();
  const report: DriveWriteVerificationReport = {
    date: new Date().toISOString(),
    schemaVersion: 2,
    outcome: 'inconclusive',
    reason: 'not-started',
    apiVersion: legacy ? 'v2' : 'v3',
    endpoint: `${legacy?.upload ?? endpoints.upload}/{fileId}?uploadType=${legacy?.multipart ? 'multipart' : 'media'}&supportsAllDrives=true`,
    conditionalHeader: 'If-Match',
    contentType: legacy?.multipart
      ? `multipart/related; boundary=mkeditor_update_${nonce}`
      : 'text/markdown; charset=utf-8',
    mediaContentType: 'text/markdown; charset=utf-8',
    rounds: [],
    trashed: false,
  };
  let id: string | undefined;
  const call = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });

  const metadata = async () => {
    if (!id) throw new Error('No verification file');
    const response = await call(
      `${endpoints.api}files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=*`,
    );
    if (!response.ok) throw new Error('Verification metadata unavailable');
    const data = metaSchema.parse(await response.json());
    if (
      data.id !== id ||
      data.appProperties?.mkeditorWriteVerification !== nonce
    )
      throw new Error('Verification identity mismatch');
    return { data, etag: response.headers.get('etag') };
  };

  const contents = async () => {
    const response = await call(
      `${endpoints.api}files/${encodeURIComponent(id!)}?alt=media&supportsAllDrives=true`,
    );
    if (!response.ok) throw new Error('Verification content unavailable');
    return {
      content: await response.text(),
      etag: response.headers.get('etag'),
    };
  };

  const write = async (content: string, etag?: string) => {
    const before = await metadata(); // Ownership check, not a save concurrency guard.
    const boundary = `mkeditor_update_${nonce}`;
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const response = await call(
      `${legacy?.upload ?? endpoints.upload}/${encodeURIComponent(id!)}?uploadType=${legacy?.multipart ? 'multipart' : 'media'}&supportsAllDrives=true`,
      {
        method: legacy ? 'PUT' : 'PATCH',
        headers: {
          'Content-Type': legacy?.multipart
            ? `multipart/related; boundary=${boundary}`
            : 'text/markdown; charset=utf-8',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: legacy?.multipart ? multipart : content,
      },
    );
    await response.arrayBuffer();
    return { status: response.status, before: before.data };
  };
  try {
    const ids = await call(
      `${endpoints.api}files/generateIds?count=1&space=drive&type=files`,
    );
    if (!ids.ok) {
      report.reason = `write-authorization-unavailable-http-${ids.status}`;
      return report;
    }
    const generated = z
      .object({ ids: z.array(z.string().min(1)).length(1) })
      .parse(await ids.json());
    id = generated.ids[0];
    report.itemId = id;
    report.itemName = `MKEditor write verification ${nonce}.md`;
    const boundary = `mkeditor_${nonce}`;
    const initial = `# MKEditor disposable write verification\n\n${nonce}\n`;
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ id, name: report.itemName, mimeType: 'text/markdown', appProperties: { mkeditorWriteVerification: nonce } })}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n${initial}\r\n--${boundary}--\r\n`;
    try {
      const created = await call(
        `${endpoints.upload}?uploadType=multipart&supportsAllDrives=true`,
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipart,
        },
      );
      await created.arrayBuffer();
      if (!created.ok) {
        report.reason = `create-failed-http-${created.status}`;
        return report;
      }
    } catch {
      // Reconcile only by the pre-generated identity; never repeat the create.
      await metadata();
    }
    const original = await metadata();
    if (!original.data.headRevisionId || !original.data.md5Checksum) {
      report.reason = 'content-revision-unavailable';
      return report;
    }
    const media = await contents();
    const legacyValidator = async () => {
      const response = await call(
        `${legacy!.metadata}files/${encodeURIComponent(id!)}?supportsAllDrives=true&updateViewedDate=false&fields=id,etag,version`,
      );
      if (!response.ok) throw new Error('Verification validator unavailable');
      const result = z
        .object({ id: z.string(), etag: z.string().optional() })
        .parse(await response.json());
      if (result.id !== id)
        throw new Error('Verification validator identity mismatch');
      return result.etag;
    };
    const legacyTag = legacy ? await legacyValidator() : undefined;
    const source = legacy
      ? legacyTag && !legacyTag.startsWith('W/')
        ? 'Drive v2 File.etag'
        : undefined
      : original.etag && !original.etag.startsWith('W/')
        ? 'files.get response ETag'
        : media.etag && !media.etag.startsWith('W/')
          ? 'files.get alt=media response ETag'
          : undefined;
    if (!source) {
      report.reason = 'no-provider-issued-strong-etag';
      return report;
    }
    report.validatorSource = source;
    const validator = async () =>
      legacy
        ? legacyValidator()
        : source === 'files.get response ETag'
          ? (await metadata()).etag
          : (await contents()).etag;
    for (let round = 1; round <= 3; round++) {
      const etag = await validator();
      if (!etag || etag.startsWith('W/')) {
        report.reason = 'validator-unavailable';
        return report;
      }
      const result: VerificationRound = {
        round,
        currentValidator: etag,
        currentStatus: (
          await write(`# Current validator control ${round}\n${nonce}\n`, etag)
        ).status,
      };
      report.rounds.push(result);
      if (result.currentStatus < 200 || result.currentStatus >= 300) {
        report.reason = 'current-validator-control-rejected';
        return report;
      }
      const stale = await validator();
      if (!stale || stale.startsWith('W/')) {
        report.reason = 'validator-unavailable-after-write';
        return report;
      }
      const external = `# Independently changed contents ${round}\n${nonce}\n`;
      const externalStatus = (await write(external)).status; // Simulate another editor on test-owned bytes only.
      if (externalStatus < 200 || externalStatus >= 300) {
        report.reason = 'external-change-control-failed';
        return report;
      }
      const beforeAttempt = await contents();
      if (beforeAttempt.content !== external) {
        report.reason = 'external-change-not-confirmed';
        return report;
      }
      const currentTag = await validator();
      result.staleValidator = stale;
      result.newerValidator = currentTag ?? undefined;
      if (currentTag === stale) {
        report.reason = 'validator-did-not-change';
        return report;
      }
      const staleResult = await write(
        `# Stale overwrite attempt ${round}\n${nonce}\n`,
        stale,
      );
      result.staleStatus = staleResult.status;
      const afterMetadata = await metadata();
      const after = await contents();
      result.beforeRevision = staleResult.before.headRevisionId;
      result.afterRevision = afterMetadata.data.headRevisionId;
      result.beforeResourceVersion = staleResult.before.version;
      result.afterResourceVersion = afterMetadata.data.version;
      result.resourceVersionPreserved =
        afterMetadata.data.version === staleResult.before.version;
      result.newerContentPreserved = after.content === external;
      result.newerRevisionPreserved =
        Boolean(staleResult.before.headRevisionId) &&
        afterMetadata.data.headRevisionId ===
          staleResult.before.headRevisionId &&
        afterMetadata.data.md5Checksum === staleResult.before.md5Checksum;
      // Drive's general version includes non-content server bookkeeping. The
      // save gate checks content revision, bytes, checksum and visible metadata.
      const visible = (value: z.infer<typeof metaSchema>) =>
        JSON.stringify({
          name: value.name,
          mimeType: value.mimeType,
          parents: value.parents,
          modifiedTime: value.modifiedTime,
          appProperties: value.appProperties,
        });
      result.newerMetadataPreserved =
        visible(staleResult.before) === visible(afterMetadata.data);
      if (
        result.staleStatus !== 412 ||
        !result.newerContentPreserved ||
        !result.newerRevisionPreserved ||
        !result.newerMetadataPreserved
      ) {
        const demonstratesFailure =
          (result.staleStatus >= 200 && result.staleStatus < 300) ||
          result.staleStatus === 412;
        report.outcome = demonstratesFailure ? 'fail' : 'inconclusive';
        report.reason = demonstratesFailure
          ? 'stale-write-not-safely-rejected'
          : 'stale-control-interrupted';
        return report;
      }
    }
    report.outcome = 'pass';
    report.reason = 'three-current-controls-and-three-stale-rejections';
    return report;
  } catch {
    report.reason = 'verification-request-failed-or-unconfirmed';
    return report;
  } finally {
    if (id) {
      try {
        await metadata();
        const response = await call(
          `${endpoints.api}files/${encodeURIComponent(id)}?supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true }),
          },
        );
        await response.arrayBuffer();
        report.trashed = response.ok;
      } catch {
        /* Leave identity in the report for explicit cleanup; never touch another file. */
      }
    }
  }
}
