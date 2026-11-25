/** Production Electron/Dropbox checks. Fault injection is confined to the local fixture. */
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const labels = require('../locale/en/cloud.json');
const navbar = require('../locale/en/navbar.json');
const live = process.argv.includes('--live');
if (live && !process.argv.includes('--authorize-disposable-test'))
  throw Error('Live checks require --authorize-disposable-test.');
const resume = process.argv
  .find((value) => value.startsWith('--resume='))
  ?.slice('--resume='.length);
if (resume && (!live || !/^dropbox-[0-9]+-[a-f0-9]+$/.test(resume)))
  throw Error('Resume requires a known live Dropbox test profile.');
const runId =
  resume ?? `dropbox-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const profile = path.resolve(__dirname, '../out/drive-smoke', runId);
if (
  resume &&
  (JSON.parse(fs.readFileSync(path.join(profile, 'report.json'), 'utf8'))
    .mode !== 'live-dropbox' ||
    !JSON.parse(
      fs.readFileSync(path.join(profile, 'scope.json'), 'utf8'),
    ).rootName.startsWith('000 MKEditor dropbox-'))
)
  throw Error('The profile is not an owned live Dropbox test.');
fs.mkdirSync(profile, { recursive: true });
const rootName = resume
  ? JSON.parse(fs.readFileSync(path.join(profile, 'scope.json'), 'utf8'))
      .rootName
  : `000 MKEditor ${runId}`;
const report = {
  mode: live ? 'live-dropbox' : 'local-fixture',
  outcome: 'incomplete',
  steps: [],
  retainedFolder: null,
};
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let application,
  page,
  fixture,
  phase = 'launch';
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error(`Timed out during ${phase}.`);
}
async function step(name, work) {
  phase = name;
  console.log(name);
  await work();
  report.steps.push(name);
}
async function launch() {
  application = await _electron.launch({
    executablePath: require('electron'),
    env,
    args: [
      path.resolve(__dirname, 'drive-smoke/electron.cjs'),
      '--mkeditor-smoke=' +
        Buffer.from(
          JSON.stringify({
            provider: 'dropbox',
            profile,
            rootName,
            live,
            authorize: live,
            headed: process.argv.includes('--headed'),
            endpoints: fixture?.endpoints,
          }),
        ).toString('base64'),
    ],
    timeout: 60000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(30000);
  await page.locator('.monaco-editor').first().waitFor();
  await until(
    async () =>
      await page
        .locator('#react-root')
        .evaluate((el) => getComputedStyle(el).opacity === '1'),
  );
  const state = await application.evaluate(() => globalThis.driveSmoke.state());
  assert.equal(state.secureStorage, true);
  assert.equal(state.dropboxAvailable, true);
}
async function settings() {
  await page
    .getByRole('button', { name: navbar.settings_tooltip, exact: true })
    .click();
  await page
    .getByRole('tab', { name: labels.connections, exact: true })
    .click();
}
async function closeDialog() {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
}
async function selectDropbox() {
  await page.getByRole('combobox', { name: labels.workspace }).click();
  await page.getByRole('option').filter({ hasText: 'Dropbox' }).first().click();
  if (
    !(await page
      .getByRole('button', { name: labels.location, exact: true })
      .isVisible())
  )
    await page
      .getByRole('button', { name: navbar.toggle_sidebar, exact: true })
      .click();
  await page
    .locator('#sidebar')
    .getByRole('button', { name: labels.refresh, exact: true })
    .click();
  const row = page
    .locator('#sidebar')
    .getByRole('button', { name: rootName, exact: true });
  for (let i = 0; i < 50; i++) {
    if (await row.isVisible()) {
      await row.click();
      return;
    }
    const more = page
      .locator('#sidebar')
      .getByRole('button', { name: labels.load_more, exact: true });
    if (await more.isVisible()) await more.click();
    else await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw Error('Disposable Dropbox folder not listed.');
}
async function identity() {
  const value = await page
    .locator('#editor-tabs li[data-active=true]')
    .getAttribute('data-path');
  assert.ok(value?.startsWith('cloud-dropbox://'));
  return { path: value, id: decodeURIComponent(value.split('/').at(-1)) };
}
async function edit(content) {
  await page
    .locator(
      '.monaco-editor textarea, .monaco-editor [contenteditable], .monaco-editor .native-edit-context, .monaco-editor [role=textbox]',
    )
    .first()
    .focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(content);
  await until(
    async () =>
      (await page
        .locator('#editor-tabs li[data-active=true]')
        .getAttribute('data-dirty')) === 'true',
  );
}
async function save() {
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('from:file:save'),
  );
}
async function saved() {
  await until(
    async () =>
      !(await page
        .locator('#editor-tabs li[data-active=true]')
        .getAttribute('data-dirty')),
  );
}
async function fillName(name) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill(name);
  await dialog
    .getByRole('button', { name: labels.create, exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}
async function creationMenu() {
  const explorer = page
    .locator('#sidebar')
    .getByRole('list', { name: labels.files, exact: true })
    .locator('..');
  const bounds = await explorer.boundingBox();
  assert.ok(bounds);
  await explorer.click({
    button: 'right',
    position: { x: 8, y: bounds.height - 8 },
  });
}
async function create(name) {
  await creationMenu();
  await page
    .getByRole('menuitem', { name: labels.new_file, exact: true })
    .click();
  await fillName(name);
  await until(async () =>
    (
      await page.locator('#editor-tabs li[data-active=true]').textContent()
    )?.includes(name),
  );
  await page
    .locator('[data-sonner-toast]')
    .getByText(labels.created_file.replace('{{name}}', name), { exact: true })
    .waitFor();
  return identity();
}
async function checkpoint() {
  assert.equal(
    await application.evaluate(() => globalThis.driveSmoke.checkpoint()),
    true,
  );
}
async function verify(id, content) {
  assert.equal(
    await application.evaluate(
      async (_electron, value) =>
        globalThis.driveSmoke.verifyContent(value.id, value.content),
      { id, content },
    ),
    true,
  );
}
async function crash() {
  const child = application.process();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32')
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  else child.kill('SIGKILL');
  await exited;
  await application.close().catch(() => {});
}

(async () => {
  if (!live) {
    // Compile just the self-contained Node fixture; no normal application files are loaded.
    const ts = require('typescript');
    const fixtureFile = path.join(profile, 'fixture.cjs');
    fs.writeFileSync(
      fixtureFile,
      ts.transpileModule(
        fs.readFileSync(
          path.resolve(__dirname, '../tests/fixtures/dropboxServer.ts'),
          'utf8',
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
        },
      ).outputText,
    );
    fixture = await require(fixtureFile).dropboxFixture();
  } else
    console.log(
      'Complete Dropbox sign-in in your regular browser. All writes stay in the new disposable test folder.',
    );
  await launch();
  await step(
    'Connect Dropbox through Settings and enable editing',
    async () => {
      if (
        resume &&
        (
          await application.evaluate(() => globalThis.driveSmoke.state())
        ).connections.some(
          (c) =>
            c.provider === 'dropbox' &&
            c.status === 'connected' &&
            c.writeAccess,
        )
      ) {
        report.retainedFolder = await application.evaluate(() =>
          globalThis.driveSmoke.prepareRoot(),
        );
        await selectDropbox();
        return;
      }
      await settings();
      await page
        .getByRole('button', { name: labels.dropbox.connect, exact: true })
        .click();
      const editingIntro = page.getByRole('dialog', {
        name: labels.editing_intro_title.replace('{{provider}}', 'Dropbox'),
        exact: true,
      });
      await editingIntro.waitFor({ timeout: 180000 });
      await editingIntro
        .getByText(labels.dropbox.editing_intro_description, { exact: true })
        .waitFor();
      await editingIntro
        .getByRole('button', { name: labels.later, exact: true })
        .click();
      assert.equal(
        (
          await application.evaluate(() => globalThis.driveSmoke.state())
        ).connections.find((c) => c.provider === 'dropbox').writeAccess,
        false,
      );
      await page
        .getByRole('button', { name: labels.enable_editing, exact: true })
        .click();
      await page
        .getByRole('dialog', { name: labels.enable_editing, exact: true })
        .getByRole('button', { name: labels.enable_editing, exact: true })
        .click();
      await until(
        async () =>
          (
            await application.evaluate(() => globalThis.driveSmoke.state())
          ).connections.some(
            (c) =>
              c.provider === 'dropbox' &&
              c.status === 'connected' &&
              c.writeAccess,
          ),
        180000,
      );
      report.retainedFolder = await application.evaluate(() =>
        globalThis.driveSmoke.prepareRoot(),
      );
      await closeDialog();
      await selectDropbox();
    },
  );
  let document;
  let documentName;
  await step(
    'Create, save, show its toast and independently read back a Dropbox document',
    async () => {
      const name = (documentName = resume
        ? `Dropbox smoke retry ${Date.now()}.md`
        : 'Dropbox smoke.md');
      document = await create(name);
      await edit('# DropboxSmokeSaved\n\nWritten through MKEditor.');
      await save();
      await saved();
      await page
        .locator('[data-sonner-toast]')
        .getByText(labels.dropbox.save_saved, { exact: true })
        .waitFor();
      await verify(
        document.id,
        '# DropboxSmokeSaved\n\nWritten through MKEditor.',
      );
      assert.ok(
        await page
          .locator('#editor-tabs li[data-active=true] img[src="./dropbox.svg"]')
          .count(),
      );
      await page.screenshot({ path: path.join(profile, 'dropbox-saved.png') });
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.new_file, exact: true })
        .click();
      await fillName(name);
      await page
        .locator('[data-sonner-toast]')
        .getByText(labels.error_duplicate, { exact: true })
        .waitFor();
      assert.equal(await page.locator('#sidebar [role=alert]').count(), 0);
      assert.equal((await identity()).id, document.id);
      await verify(
        document.id,
        '# DropboxSmokeSaved\n\nWritten through MKEditor.',
      );
      await page.screenshot({
        path: path.join(profile, 'dropbox-duplicate-toast.png'),
      });
    },
  );
  await step(
    'Create a folder, decline document moves and preserve the dirty draft',
    async () => {
      const folderName = resume
        ? `Moved documents ${Date.now()}`
        : 'Moved documents';
      await edit('# UnsavedDropboxOrganizationDraft');
      await creationMenu();
      await page
        .getByRole('menuitem', { name: labels.new_folder, exact: true })
        .click();
      await fillName(folderName);
      const folder = page
        .locator('#sidebar')
        .getByRole('button', { name: folderName, exact: true });
      await folder.waitFor();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: documentName, exact: true })
        .click({ button: 'right' });
      assert.equal(
        await page
          .getByRole('menuitem', { name: labels.move_to, exact: true })
          .isEnabled(),
        false,
      );
      await page.keyboard.press('Escape');
      assert.equal((await identity()).path, document.path);
      assert.equal(
        await page
          .locator('#editor-tabs li[data-active=true]')
          .getAttribute('data-dirty'),
        'true',
      );
      await verify(
        document.id,
        '# DropboxSmokeSaved\n\nWritten through MKEditor.',
      );
      await save();
      await saved();
      await verify(document.id, '# UnsavedDropboxOrganizationDraft');
      await page.screenshot({
        path: path.join(profile, 'dropbox-organization.png'),
      });
    },
  );
  await step(
    'An external edit causes a conflict and retains the local draft',
    async () => {
      await edit('# LocalDropboxDraft');
      await application.evaluate(
        async (_electron, id) =>
          globalThis.driveSmoke.externalEdit(id, '# ExternalDropboxRevision'),
        document.id,
      );
      await save();
      await page
        .getByRole('button', { name: labels.dropbox.compare, exact: true })
        .waitFor();
      await verify(document.id, '# ExternalDropboxRevision');
      assert.ok(
        (await page.locator('.monaco-editor').first().textContent()).includes(
          'LocalDropboxDraft',
        ),
      );
      await page.screenshot({
        path: path.join(profile, 'dropbox-conflict.png'),
      });
      await page
        .getByRole('button', { name: labels.dropbox.reload, exact: true })
        .click();
      await page
        .getByRole('dialog', { name: labels.dropbox.reload, exact: true })
        .getByRole('button', { name: labels.dropbox.reload, exact: true })
        .click();
      await saved();
    },
  );
  if (!live)
    await step(
      'A lost Dropbox save reply is checked without replaying the write',
      async () => {
        const writes = fixture.state.writes;
        fixture.state.loseWriteReply = true;
        await edit('# DropboxWrittenOnce');
        await save();
        await page
          .getByRole('button', { name: labels.check_save, exact: true })
          .waitFor();
        await page
          .getByRole('button', { name: labels.check_save, exact: true })
          .click();
        await saved();
        assert.equal(fixture.state.writes, writes + 1);
        await verify(document.id, '# DropboxWrittenOnce');
      },
    );
  await step(
    'Unsaved Dropbox text and identity survive restart with encrypted recovery',
    async () => {
      await edit('# DropboxRecoveredDraft');
      await checkpoint();
      assert.equal(
        fs
          .readFileSync(path.join(profile, 'session.json'), 'utf8')
          .includes('DropboxRecoveredDraft'),
        false,
      );
      assert.equal(
        fs
          .readFileSync(path.join(profile, 'cloud-recovery.bin'))
          .includes(Buffer.from('DropboxRecoveredDraft')),
        false,
      );
      await application.close();
      await launch();
      await until(async () => (await identity()).path === document.path);
      assert.ok(
        (await page.locator('.monaco-editor').first().textContent()).includes(
          'DropboxRecoveredDraft',
        ),
      );
      assert.equal(
        await page
          .locator('#editor-tabs li[data-active=true]')
          .getAttribute('data-dirty'),
        'true',
      );
      await page.screenshot({
        path: path.join(profile, 'dropbox-recovered.png'),
      });
    },
  );
  if (!live)
    await step(
      'Offline Dropbox drafts survive a forced crash and save only after an explicit retry',
      async () => {
        await checkpoint();
        await crash();
        fixture.state.offline = true;
        await launch();
        const retry = page.getByRole('button', {
          name: labels.check_recovery,
          exact: true,
        });
        await until(
          async () => (await retry.isVisible()) && (await retry.isEnabled()),
        );
        const writes = fixture.state.writes;
        fixture.state.offline = false;
        await retry.click();
        await until(async () => !(await retry.isVisible()));
        assert.equal(fixture.state.writes, writes);
        await save();
        await saved();
        await verify(document.id, '# DropboxRecoveredDraft');
      },
    );
  await step(
    'Expired Dropbox credentials refresh across restart and disconnect clears the account',
    async () => {
      await application.evaluate(() =>
        globalThis.driveSmoke.expireCredentials(),
      );
      await application.close();
      await launch();
      await selectDropbox();
      if (!live) assert.ok(fixture.state.refreshes > 0);
      await settings();
      await page
        .getByRole('button', { name: labels.disconnect, exact: true })
        .click();
      await until(async () =>
        (
          await application.evaluate(() => globalThis.driveSmoke.state())
        ).connections.every(
          (c) => c.status === 'disconnected' && !c.accountId && !c.accountName,
        ),
      );
    },
  );
  report.outcome = 'pass';
  console.log('Dropbox smoke checks passed.');
})()
  .catch(async (error) => {
    report.failure = { phase, kind: error.name };
    process.exitCode = 1;
    console.error(`Dropbox smoke failed during ${phase} (${error.name}).`);
    if (!live) {
      console.error(error.message);
      await page
        ?.screenshot({ path: path.join(profile, 'failure.png') })
        .catch(() => {});
    }
  })
  .finally(async () => {
    await application?.close().catch(() => {});
    await fixture?.close();
    fs.writeFileSync(
      path.join(profile, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      `Report: ${path.relative(process.cwd(), path.join(profile, 'report.json'))}`,
    );
  });
