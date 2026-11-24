/** Playwright Electron checks. Live mode requires interactive Google consent. */
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createFixture } = require('./fixture.cjs');
const labels = require('../../locale/en/cloud.json');
const navbar = require('../../locale/en/navbar.json');

const live = process.argv.includes('--live');
const recoveryRun = process.argv.includes('--recovery');
if (recoveryRun && live) {
  console.error('Crash/fault injection runs use the local fixture.');
  process.exit(1);
}
if (live && !process.argv.includes('--authorize-disposable-test')) {
  console.error(
    'Live checks require --authorize-disposable-test. Only newly created disposable files will be changed.',
  );
  process.exit(1);
}
const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const profile = path.resolve(__dirname, '../../out/drive-smoke', runId);
fs.mkdirSync(profile, { recursive: true });
const report = {
  mode: live ? 'live-google' : 'local-fixture',
  outcome: 'incomplete',
  steps: [],
  retainedFolder: null,
};
let application,
  page,
  fixture,
  phase = 'launch';
const rootName = `000 MKEditor smoke ${runId}`;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
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
const state = () => application.evaluate(() => globalThis.driveSmoke.state());
async function launch() {
  application = await _electron.launch({
    executablePath: require('electron'),
    args: [
      path.join(__dirname, 'electron.cjs'),
      '--mkeditor-smoke=' +
        Buffer.from(
          JSON.stringify({
            profile,
            rootName,
            live,
            authorize: live,
            headed: process.argv.includes('--headed'),
            endpoints: fixture?.endpoints,
          }),
        ).toString('base64'),
    ],
    env,
    timeout: 60000,
  });
  page = await application.firstWindow();
  page.setDefaultTimeout(30000);
  await page.locator('.monaco-editor').first().waitFor();
  await until(
    async () =>
      await page
        .locator('#react-root')
        .evaluate((element) => getComputedStyle(element).opacity === '1'),
  );
  assert.equal(
    (await state()).secureStorage,
    true,
    'OS-backed credential encryption is required.',
  );
  assert.equal(
    (await state()).googleDriveAvailable,
    true,
    'Build with a Google Desktop registration before a live run.',
  );
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
async function selectDrive() {
  const picker = page.getByRole('combobox', { name: labels.workspace });
  await picker.click();
  await page
    .getByRole('option')
    .filter({ hasText: 'Google Drive' })
    .first()
    .click();
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
}
async function enterRoot() {
  const row = page
    .locator('#sidebar')
    .getByRole('button', { name: rootName, exact: true });
  for (let index = 0; index < 50; index++) {
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
  throw Error('Disposable test folder was not listed.');
}
async function fillName(name) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill(name);
  await dialog
    .getByRole('button', { name: labels.create, exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}
async function createDocument(name) {
  await page
    .locator('#sidebar')
    .getByRole('button', { name: labels.new_file, exact: true })
    .click();
  await fillName(name);
  await until(async () =>
    (
      await page.locator('#editor-tabs li[data-active=true]').textContent()
    )?.includes(name),
  );
  return activeIdentity();
}
async function activeIdentity() {
  const tab = page.locator('#editor-tabs li[data-active=true]');
  const identity = await tab.getAttribute('data-path');
  assert.ok(identity?.startsWith('cloud-drive://'));
  return { identity, id: decodeURIComponent(identity.split('/').at(-1)) };
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
  // Native menus send this same event; the production bridge/manager performs the save.
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
  // Windows can leave renderer children holding Playwright's pipes after
  // only the main process dies. Terminate this isolated application's tree.
  if (process.platform === 'win32')
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  else child.kill('SIGKILL');
  await exited;
  await application.close().catch(() => {});
}
async function assertDraft(document, marker) {
  await until(
    async () => (await activeIdentity()).identity === document.identity,
  );
  await until(async () =>
    (await page.locator('.monaco-editor').first().textContent()).includes(
      marker,
    ),
  );
  assert.equal(
    await page
      .locator('#editor-tabs li[data-active=true]')
      .getAttribute('data-dirty'),
    'true',
  );
}
async function checkpoint() {
  assert.equal(
    await application.evaluate(() => globalThis.driveSmoke.checkpoint()),
    true,
  );
}
async function recoveryScenarios(document) {
  await step(
    'Unsaved remote drafts, tab identity and cursor survive a normal restart',
    async () => {
      await edit('# NormalRestartDraft\n\nUnsaved writing.');
      await checkpoint();
      const before = await application.evaluate(() =>
        globalThis.driveSmoke.recoveryMeta(),
      );
      await application.close();
      await launch();
      await assertDraft(document, 'NormalRestartDraft');
      await checkpoint();
      const after = await application.evaluate(() =>
        globalThis.driveSmoke.recoveryMeta(),
      );
      assert.deepEqual(
        after.tabs.map((tab) => tab.path),
        before.tabs.map((tab) => tab.path),
      );
      assert.deepEqual(
        after.tabs.find((tab) => tab.path === document.identity).viewState
          .cursorState,
        before.tabs.find((tab) => tab.path === document.identity).viewState
          .cursorState,
      );
      await page.screenshot({
        path: path.join(profile, 'recovered-draft.png'),
      });
    },
  );
  await step(
    'A forced crash preserves the last checkpoint and detects a Drive change during downtime',
    async () => {
      await edit('# CrashRecoveryDraft');
      await checkpoint();
      assert.equal(
        fs
          .readFileSync(path.join(profile, 'session.json'), 'utf8')
          .includes('CrashRecoveryDraft'),
        false,
      );
      assert.equal(
        fs
          .readFileSync(path.join(profile, 'cloud-recovery.bin'))
          .includes(Buffer.from('CrashRecoveryDraft')),
        false,
      );
      const writes = fixture.state.saveWrites;
      await crash();
      fixture.externalEdit(document.id, '# ExternalAfterCrash');
      await launch();
      await assertDraft(document, 'CrashRecoveryDraft');
      await page
        .getByRole('button', { name: labels.compare, exact: true })
        .waitFor();
      assert.equal(fixture.state.saveWrites, writes);
      await verify(document.id, '# ExternalAfterCrash');
      await page.screenshot({
        path: path.join(profile, 'recovered-conflict.png'),
      });
      await page
        .getByRole('button', { name: labels.reload, exact: true })
        .click();
      await page
        .getByRole('dialog', { name: labels.reload, exact: true })
        .getByRole('button', { name: labels.cancel, exact: true })
        .click();
      await assertDraft(document, 'CrashRecoveryDraft');
      await page
        .getByRole('button', { name: labels.reload, exact: true })
        .click();
      await page
        .getByRole('dialog', { name: labels.reload, exact: true })
        .getByRole('button', { name: labels.reload, exact: true })
        .click();
      await saved();
    },
  );
  await step(
    'Recovered drafts remain available offline and reconnect without an automatic upload',
    async () => {
      await edit('# OfflineRecoveryDraft');
      await checkpoint();
      await crash();
      fixture.state.offline = true;
      await launch();
      await assertDraft(document, 'OfflineRecoveryDraft');
      const retry = page.getByRole('button', {
        name: labels.check_recovery,
        exact: true,
      });
      await until(
        async () => (await retry.isVisible()) && (await retry.isEnabled()),
      );
      const writes = fixture.state.saveWrites;
      fixture.state.offline = false;
      await retry.click();
      await until(async () => !(await retry.isVisible()));
      assert.equal(fixture.state.saveWrites, writes);
      await save();
      await saved();
      await verify(document.id, '# OfflineRecoveryDraft');
      await selectDrive();
      await enterRoot();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Moved documents', exact: true })
        .click();
    },
  );
  await step(
    'A crash during a provider save reconciles once and retains edits made in flight',
    async () => {
      let release;
      fixture.state.saveWait = new Promise((resolve) => {
        release = resolve;
      });
      const writes = fixture.state.saveWrites;
      await edit('# PendingWrittenSnapshot');
      await save();
      await until(() => fixture.state.saveWrites === writes + 1);
      await edit('# AfterWriteUnsentDraft');
      await checkpoint();
      await crash();
      release();
      fixture.state.saveWait = undefined;
      await launch();
      await assertDraft(document, 'AfterWriteUnsentDraft');
      await until(
        async () =>
          !(await page
            .getByRole('button', { name: labels.check_save, exact: true })
            .isVisible()) &&
          !(await page
            .getByRole('button', { name: labels.check_recovery, exact: true })
            .isVisible()),
      );
      assert.equal(fixture.state.saveWrites, writes + 1);
      await verify(document.id, '# PendingWrittenSnapshot');
      await checkpoint();
      await page.screenshot({
        path: path.join(profile, 'reconciled-draft.png'),
      });
      await save();
      await saved();
      await verify(document.id, '# AfterWriteUnsentDraft');
    },
  );
}

(async () => {
  if (!live) fixture = await createFixture();
  else
    console.log(
      'Complete Google sign-in and consent in your regular browser when prompted. Test files remain in a new disposable folder.',
    );
  await launch();
  await step('Connect through the UI and enable editing', async () => {
    await settings();
    await page
      .getByRole('button', { name: labels.connect, exact: true })
      .click();
    await until(
      async () =>
        (await state()).connections.some(
          (entry) => entry.status === 'connected',
        ),
      live ? 210000 : 30000,
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
        (await state()).connections.some(
          (entry) => entry.status === 'connected' && entry.writeAccess,
        ),
      live ? 210000 : 30000,
    );
    const scope = await application.evaluate(() =>
      globalThis.driveSmoke.prepareRoot(),
    );
    report.retainedFolder = { id: scope.rootId, name: rootName };
    await closeDialog();
    await selectDrive();
    await enterRoot();
  });
  let document;
  const content = '# Playwright Drive smoke\n\nSaved through MKEditor.';
  await step(
    'Create, edit and independently verify a Markdown document',
    async () => {
      document = await createDocument('Smoke.md');
      await edit(content);
      await save();
      await saved();
      await verify(document.id, content);
      await page.screenshot({ path: path.join(profile, 'saved-document.png') });
    },
  );
  await step(
    'Save a separate copy and refuse a duplicate name without changing its source',
    async () => {
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.actions, exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: labels.save_copy, exact: true })
        .click();
      await fillName('Copy.md');
      await until(async () =>
        (
          await page.locator('#editor-tabs li[data-active=true]').textContent()
        )?.includes('Copy.md'),
      );
      const copy = await activeIdentity();
      assert.notEqual(copy.id, document.id);
      await verify(copy.id, content);
      await verify(document.id, content);
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.new_file, exact: true })
        .click();
      await fillName('Copy.md');
      await page
        .locator('#sidebar')
        .getByRole('alert')
        .filter({ hasText: labels.error_duplicate })
        .waitFor();
      await verify(copy.id, content);
      await page
        .locator('#editor-tabs li')
        .filter({ hasText: 'Smoke.md' })
        .locator('a')
        .click();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.refresh, exact: true })
        .click();
    },
  );
  await step(
    'Create a folder and move the open document through its context menu',
    async () => {
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.actions, exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: labels.new_folder, exact: true })
        .click();
      await fillName('Moved documents');
      const row = page
        .locator('#sidebar')
        .getByRole('button', { name: 'Moved documents', exact: true });
      await row.waitFor();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Smoke.md', exact: true })
        .click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: labels.move_to, exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: rootName, exact: true }).click();
      await dialog
        .getByRole('button', { name: 'Moved documents', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: labels.move_here, exact: true })
        .click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal((await activeIdentity()).identity, document.identity);
      await verify(document.id, content);
      await row.click();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Smoke.md', exact: true })
        .waitFor();
    },
  );
  await step(
    'A genuine stale save preserves the remote edit and local draft',
    async () => {
      const external = '# External revision\n\nThis version must survive.';
      await application.evaluate(
        async (_electron, value) =>
          globalThis.driveSmoke.externalEdit(value.id, value.content),
        { id: document.id, content: external },
      );
      await edit(
        '# Local draft that must not overwrite the external revision.',
      );
      await save();
      await page
        .getByRole('button', { name: labels.compare, exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator('#editor-tabs li[data-active=true]')
          .getAttribute('data-dirty'),
        'true',
      );
      await verify(document.id, external);
      await page.screenshot({ path: path.join(profile, 'conflict.png') });
      await page
        .getByRole('button', { name: labels.reload, exact: true })
        .click();
      await page
        .getByRole('dialog', { name: labels.reload, exact: true })
        .getByRole('button', { name: labels.reload, exact: true })
        .click();
      await saved();
    },
  );
  if (fixture)
    await step(
      'A lost provider acknowledgement is reconciled without replay',
      async () => {
        const updated = '# Acknowledgement recovery';
        const beforeWrites = fixture.state.saveWrites;
        await edit(updated);
        fixture.state.loseNextSave = true;
        await save();
        await page
          .getByRole('button', { name: labels.check_save, exact: true })
          .click();
        await saved();
        await verify(document.id, updated);
        assert.equal(
          fixture.state.saveWrites - beforeWrites,
          1,
          'Reconciliation must not replay the save.',
        );
      },
    );
  if (recoveryRun) await recoveryScenarios(document);
  await step(
    'Encrypted credentials survive restart and expired access is refreshed',
    async () => {
      await application.evaluate(() =>
        globalThis.driveSmoke.expireCredentials(),
      );
      await application.close();
      await launch();
      assert.equal(
        (await state()).connections.filter(
          (entry) => entry.status === 'connected',
        ).length,
        1,
      );
      await selectDrive();
      await enterRoot();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Moved documents', exact: true })
        .click();
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Smoke.md', exact: true })
        .click();
      await until(async () => (await activeIdentity()).id === document.id);
      if (fixture) assert.ok(fixture.state.refreshes > 0);
      await page.screenshot({ path: path.join(profile, 'after-restart.png') });
    },
  );
  if (fixture)
    await step(
      'Revoked fixture credentials require sign-in again',
      async () => {
        fixture.state.revoked = true;
        await application.evaluate(() =>
          globalThis.driveSmoke.expireCredentials(),
        );
        await application.close();
        await launch();
        await page.getByRole('combobox', { name: labels.workspace }).click();
        await page
          .getByRole('option')
          .filter({ hasText: 'Google Drive' })
          .first()
          .click();
        await until(async () =>
          (await state()).connections.some(
            (entry) => entry.status === 'reauthorize',
          ),
        );
      },
    );
  await step(
    'Disconnect clears account details and stays disconnected after restart',
    async () => {
      await settings();
      await page
        .getByRole('button', { name: labels.disconnect, exact: true })
        .click();
      await until(async () =>
        (await state()).connections.every(
          (entry) =>
            entry.status === 'disconnected' &&
            !entry.accountId &&
            !entry.accountName,
        ),
      );
      await application.close();
      await launch();
      assert.ok(
        (await state()).connections.every(
          (entry) =>
            entry.status === 'disconnected' &&
            !entry.accountId &&
            !entry.accountName,
        ),
      );
    },
  );
  report.outcome = 'pass';
  console.log('Drive smoke checks passed.');
})()
  .catch(async (error) => {
    report.failure = { phase, kind: error.name };
    console.error(
      `Drive smoke checks failed during: ${phase} (${error.name}).`,
    );
    if (!live) {
      console.error(error.message);
      if (page) {
        console.error(
          await page
            .locator('#sidebar')
            .innerText()
            .catch(() => 'No sidebar'),
        );
        await page
          .screenshot({ path: path.join(profile, 'failure.png') })
          .catch(() => {});
      }
    }
    process.exitCode = 1;
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
