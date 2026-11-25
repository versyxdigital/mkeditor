/** @jest-environment node */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeGoogleDriveRegistration } from '../scripts/google-drive-registration.cjs';
import { driveRegistrationSchema } from '../src/app/lib/cloud/GoogleDriveRegistration';

let root: string;
let local: string;
let output: string;
const registration = {
  clientId: 'fixture.apps.googleusercontent.com',
  clientValue: 'desktop-fixture-value',
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mkeditor-drive-build-'));
  local = join(root, 'src/app/config/googleDrive.local.json');
  output = join(root, 'dist/app/config/googleDrive.json');
  mkdirSync(join(root, 'src/app/config'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test('local registration reaches the main-process build and excludes unrelated fields', () => {
  writeFileSync(
    local,
    JSON.stringify({ ...registration, accessToken: 'ignore' }),
  );
  expect(writeGoogleDriveRegistration({ root, env: {} })).toBe(true);
  const built = JSON.parse(readFileSync(output, 'utf8'));
  expect(built).toEqual(registration);
  expect(driveRegistrationSchema.safeParse(built).success).toBe(true);
});

test('CI environment overrides local values without modifying the local registration', () => {
  writeFileSync(local, JSON.stringify(registration));
  expect(
    writeGoogleDriveRegistration({
      root,
      env: {
        MKEDITOR_GOOGLE_CLIENT_ID: 'ci-fixture.apps.googleusercontent.com',
        MKEDITOR_GOOGLE_CLIENT_SECRET: 'ci-fixture-value',
        MKEDITOR_REQUIRE_GOOGLE_DRIVE: 'true',
      },
    }),
  ).toBe(true);
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
    clientId: 'ci-fixture.apps.googleusercontent.com',
    clientValue: 'ci-fixture-value',
  });
  expect(JSON.parse(readFileSync(local, 'utf8'))).toEqual(registration);
});

test('unconfigured contributor builds disable shared sign-in and clear stale build values', () => {
  writeFileSync(local, JSON.stringify(registration));
  writeGoogleDriveRegistration({ root, env: {} });
  rmSync(local);
  expect(writeGoogleDriveRegistration({ root, env: {} })).toBe(false);
  const built = JSON.parse(readFileSync(output, 'utf8'));
  expect(built).toEqual({ clientId: '', clientValue: '' });
  expect(driveRegistrationSchema.safeParse(built).success).toBe(false);
  expect(() =>
    writeGoogleDriveRegistration({
      root,
      env: { MKEDITOR_REQUIRE_GOOGLE_DRIVE: 'true' },
    }),
  ).toThrow('required for release builds');
});

test('incomplete environment values fail instead of falling back to local credentials', () => {
  writeFileSync(local, JSON.stringify(registration));
  expect(() =>
    writeGoogleDriveRegistration({
      root,
      env: { MKEDITOR_GOOGLE_CLIENT_ID: registration.clientId },
    }),
  ).toThrow('provide both');
});

test.each(['{broken', 'null', '{"clientId":"invalid","clientValue":"value"}'])(
  'malformed local registration fails the build without exposing its contents',
  (contents) => {
    writeFileSync(local, contents);
    expect(() => writeGoogleDriveRegistration({ root, env: {} })).toThrow();
  },
);
