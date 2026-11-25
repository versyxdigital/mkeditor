/** Opt-in Electron main-process spike. No user tokens are persisted or logged. */
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { CloudStore } = require('../dist/app/lib/cloud/CloudStore');
const {
  GoogleDrive,
  DRIVE_SCOPE,
  DRIVE_FILE_SCOPE,
} = require('../dist/app/lib/cloud/GoogleDrive');
app.setPath(
  'userData',
  path.resolve(__dirname, '../out/drive-verification-profile'),
);
app.disableHardwareAcceleration();
let phase = 'startup';
(async () => {
  if (!process.argv.includes('--authorize-disposable-test'))
    throw new Error('Explicit live-test flag is required.');
  await app.whenReady();
  phase = 'loading-connection';
  const connections = new CloudStore()
    .load()
    .filter((entry) => entry.status === 'connected' && entry.accountId);
  if (connections.length !== 1)
    throw new Error('Exactly one connected account is required for this test.');
  const entry = connections[0];
  const drive = new GoogleDrive();
  console.log(
    'Opening Google consent for read access plus files created by this app. Existing connection credentials will not change.',
  );
  phase = 'browser-consent';
  const flow = await drive.beginAuthorization(
    entry,
    (url) => shell.openExternal(url),
    600000,
    undefined,
    [DRIVE_SCOPE, DRIVE_FILE_SCOPE],
  );
  const tokens = await flow.result;
  phase = 'confirming-account';
  const account = await drive.account(tokens.access);
  if (account.id !== entry.accountId)
    throw new Error(
      'The authorized account differs from the connected account; no test file was created.',
    );
  console.log(
    'Consent completed. Testing only a newly created, marked disposable Markdown file.',
  );
  phase = 'write-test';
  const legacy = process.argv.includes('--v2');
  async function run() {
    const modulePath =
      require.resolve('../dist/app/lib/cloud/DriveWriteVerification');
    delete require.cache[modulePath];
    const { verifyDriveWritePrecondition } = require(modulePath);
    const report = await verifyDriveWritePrecondition(
      tokens.access,
      undefined,
      legacy
        ? {
            metadata: 'https://www.googleapis.com/drive/v2/',
            upload: 'https://www.googleapis.com/upload/drive/v2/files',
            multipart: process.argv.includes('--multipart'),
          }
        : undefined,
    );
    report.requestedScopes = [DRIVE_SCOPE, DRIVE_FILE_SCOPE];
    report.connectedAccountConfirmed = true;
    const destination = path.resolve(
      __dirname,
      legacy
        ? process.argv.includes('--multipart')
          ? '../out/drive-write-verification-v2-multipart.json'
          : '../out/drive-write-verification-v2.json'
        : '../out/drive-write-verification.json',
    );
    phase = 'writing-report';
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    return report;
  }
  const first = await run();
  app.exit(first.outcome === 'pass' ? 0 : 2);
})().catch((error) => {
  const known = [
    'auth',
    'permission',
    'network',
    'configuration',
    'cancelled',
    'storage',
  ];
  const code = known.includes(error?.code) ? error.code : 'incomplete';
  console.error(
    `Live verification could not complete during ${phase} (${code}). No tokens or provider error bodies were logged.`,
  );
  app.exit(1);
});
