/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { webCloudRegistration } from '../scripts/web-cloud-registration.cjs';

const registration = {
  MKEDITOR_WEB_GOOGLE_CLIENT_ID: 'fixture-web.apps.googleusercontent.com',
  MKEDITOR_WEB_DROPBOX_APP_KEY: 'fixture-web-dropbox',
};

test.each(['MKEDITOR_WEB_GOOGLE_CLIENT_ID', 'MKEDITOR_WEB_DROPBOX_APP_KEY'])(
  'required web builds fail clearly when %s is absent',
  (missing) => {
    expect(() =>
      webCloudRegistration({
        ...registration,
        [missing]: '',
        MKEDITOR_REQUIRE_WEB_CLOUD: 'true',
      }),
    ).toThrow(`${missing} is required`);
  },
);

test('unconfigured contributor builds remain available and web releases need only public identifiers', () => {
  expect(webCloudRegistration({})).toEqual({
    googleClientId: '',
    dropboxAppKey: '',
  });
  expect(
    webCloudRegistration({
      ...registration,
      MKEDITOR_REQUIRE_WEB_CLOUD: 'true',
      MKEDITOR_GOOGLE_CLIENT_SECRET: 'desktop-secret-must-not-be-bundled',
      DROPBOX_APP_SECRET: 'dropbox-secret-must-not-be-bundled',
    }),
  ).toEqual({
    googleClientId: registration.MKEDITOR_WEB_GOOGLE_CLIENT_ID,
    dropboxAppKey: registration.MKEDITOR_WEB_DROPBOX_APP_KEY,
  });
});

test('deployable web configuration has isolated output and no desktop credentials', () => {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
    const web = require('./webpack.web.config.js');
    const desktop = require('./webpack.config.js');
    const registration = web.plugins.find(p => p.definitions).definitions.__MKEDITOR_WEB_CLOUD_CONFIG__;
    process.stdout.write(JSON.stringify({
      webPath: web.output.path,
      webClean: web.output.clean,
      desktopPath: desktop.output.path,
      keepsApp: desktop.output.clean.keep.test('app/config/googleDrive.json'),
      registration: JSON.parse(registration),
    }));
  `,
    ],
    {
      cwd: resolve(__dirname, '..'),
      env: {
        ...process.env,
        ...registration,
        MKEDITOR_REQUIRE_WEB_CLOUD: 'true',
        MKEDITOR_GOOGLE_CLIENT_SECRET: 'do-not-copy-desktop-secret',
      },
      encoding: 'utf8',
    },
  );
  expect(JSON.parse(output)).toEqual({
    webPath: resolve(__dirname, '../out/web'),
    webClean: true,
    desktopPath: resolve(__dirname, '../dist'),
    keepsApp: true,
    registration: {
      googleClientId: registration.MKEDITOR_WEB_GOOGLE_CLIENT_ID,
      dropboxAppKey: registration.MKEDITOR_WEB_DROPBOX_APP_KEY,
    },
  });
  expect(output).not.toContain('do-not-copy-desktop-secret');
});
