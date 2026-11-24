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
import { writeDropboxRegistration } from '../scripts/dropbox-registration.cjs';
import { dropboxRegistrationSchema } from '../src/app/lib/cloud/DropboxRegistration';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mkeditor-dropbox-build-'));
  mkdirSync(join(root, 'src/app/config'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const output = () =>
  JSON.parse(readFileSync(join(root, 'dist/app/config/dropbox.json'), 'utf8'));
test('local public registration includes only the app key and an empty client value', () => {
  writeFileSync(
    join(root, 'src/app/config/dropbox.local.json'),
    JSON.stringify({
      clientId: 'public-local-key',
      secret: 'exclude-this',
      accessToken: 'exclude-that',
    }),
  );
  expect(writeDropboxRegistration({ root, env: {} })).toBe(true);
  expect(output()).toEqual({ clientId: 'public-local-key', clientValue: '' });
});
test('release environment overrides local config without copying app secrets or tokens', () => {
  expect(
    writeDropboxRegistration({
      root,
      env: {
        MKEDITOR_DROPBOX_APP_KEY: 'public-ci-key',
        MKEDITOR_REQUIRE_DROPBOX: 'true',
      },
    }),
  ).toBe(true);
  expect(output()).toEqual({ clientId: 'public-ci-key', clientValue: '' });
  expect(dropboxRegistrationSchema.safeParse(output()).success).toBe(true);
});
test('unconfigured contributor builds disable sign-in and required releases fail clearly', () => {
  expect(writeDropboxRegistration({ root, env: {} })).toBe(false);
  expect(dropboxRegistrationSchema.safeParse(output()).success).toBe(false);
  expect(() =>
    writeDropboxRegistration({
      root,
      env: { MKEDITOR_REQUIRE_DROPBOX: 'true' },
    }),
  ).toThrow('required');
});
test('confidential client values and invalid keys cannot become bundled registration', () => {
  const file = join(root, 'src/app/config/dropbox.local.json');
  writeFileSync(
    file,
    JSON.stringify({ clientId: 'public-key', clientValue: 'must-not-bundle' }),
  );
  expect(() => writeDropboxRegistration({ root, env: {} })).toThrow(
    'does not use an app secret',
  );
  expect(() =>
    writeDropboxRegistration({
      root,
      env: { MKEDITOR_DROPBOX_APP_KEY: 'bad key' },
    }),
  ).toThrow('Invalid Dropbox');
});
