/** Real Chromium checks with intercepted OAuth/provider fixtures. No live accounts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const ts = require('typescript');
const labels = require('../locale/en/cloud.json');
const navbar = require('../locale/en/navbar.json');
const toolbar = require('../locale/en/toolbar.json');
const settingsLabels = require('../locale/en/modals/settings.json');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const repository = path.resolve(__dirname, '..');
const output = path.join(repository, 'out/web-cloud-smoke');
const suppliedBuild = argument('--build-dir');
const built = suppliedBuild
  ? path.resolve(repository, suppliedBuild)
  : path.join(output, 'build');
const basePath = argument('--base-path') ?? '/';
assert.match(basePath, /^\/(?:[a-zA-Z0-9_-]+\/)*$/);
if (suppliedBuild && !process.argv.includes('--skip-build'))
  throw new Error(
    '--build-dir requires --skip-build to preserve the supplied artifact.',
  );
const report = {
  mode: 'chromium-local-fixtures',
  artifactDirectory: path.relative(repository, built).replace(/\\/g, '/'),
  basePath,
  outcome: 'incomplete',
  steps: [],
};
let browser, server, context, page, drive, dropbox, organizationDrive;
let googleAccess = 'fixture-access';
let phase = 'prepare';
let cancelNextAuthorization = false;
const browserErrors = [];

async function browserContext(options = {}) {
  const next = await browser.newContext(options);
  next.on('page', (opened) =>
    opened.on('pageerror', (error) => {
      browserErrors.push({ phase, message: error.message });
    }),
  );
  return next;
}

async function step(name, action) {
  phase = name;
  console.log(name);
  await action();
  report.steps.push(name);
}

async function until(check, message = phase) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${message}`);
}

async function build() {
  if (process.argv.includes('--skip-build')) {
    assert.ok(
      fs.existsSync(path.join(built, 'index.html')),
      'Build the fixture renderer first.',
    );
    return;
  }
  process.env.MKEDITOR_WEB_GOOGLE_CLIENT_ID =
    'fixture-web.apps.googleusercontent.com';
  process.env.MKEDITOR_WEB_DROPBOX_APP_KEY = 'fixture-web-dropbox';
  const webpack = require('webpack');
  const configuration = require('../webpack.config.js');
  configuration.output = { ...configuration.output, path: built };
  await new Promise((resolve, reject) => {
    const compiler = webpack(configuration);
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) return reject(error || closeError);
        if (stats.hasErrors())
          return reject(
            new Error(stats.toString({ all: false, errors: true })),
          );
        resolve();
      });
    });
  });
}

async function fixture(name, exported) {
  const file = path.join(output, `${name}.cjs`);
  fs.writeFileSync(
    file,
    ts.transpileModule(
      fs.readFileSync(
        path.join(repository, `tests/fixtures/${name}.ts`),
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
  return require(file)[exported]();
}

async function serve() {
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(basePath)) {
      response.writeHead(404).end();
      return;
    }
    const pathname = url.pathname.slice(basePath.length);
    const target = path.resolve(
      built,
      `./${decodeURIComponent(pathname || 'index.html')}`,
    );
    if (!target.startsWith(`${built}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = fs.readFileSync(target);
      response.writeHead(200, {
        'Content-Type':
          contentTypes[path.extname(target)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}${basePath}`;
}

async function intercept() {
  await context.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.google={accounts:{oauth2:{initTokenClient(options){return{requestAccessToken(){setTimeout(()=>options.callback({access_token:${JSON.stringify(googleAccess)},expires_in:3600,scope:options.scope,state:options.state,token_type:'Bearer'}),0)}}}}}};`,
    }),
  );
  await context.route(
    'https://www.dropbox.com/oauth2/authorize**',
    async (route) => {
      const request = new URL(route.request().url());
      assert.equal(request.searchParams.get('response_type'), 'code');
      assert.equal(request.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(request.searchParams.get('code_challenge'));
      assert.notEqual(request.searchParams.get('token_access_type'), 'offline');
      const callback = new URL(request.searchParams.get('redirect_uri'));
      assert.equal(callback.pathname, `${basePath}cloud-callback.html`);
      callback.searchParams.set('state', request.searchParams.get('state'));
      callback.searchParams.set(
        cancelNextAuthorization ? 'error' : 'code',
        cancelNextAuthorization ? 'access_denied' : 'fixture-code',
      );
      cancelNextAuthorization = false;
      await route.fulfill({
        status: 302,
        headers: { Location: callback.toString() },
      });
    },
  );
  await context.route(
    /https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com|api\.dropboxapi\.com|content\.dropboxapi\.com)\//,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const isDropbox = url.hostname.endsWith('dropboxapi.com');
      const base = new URL(
        isDropbox ? dropbox.endpoints.api : drive.endpoints.api,
      );
      const target = new URL(
        url.pathname.includes('/oauth2/token') ||
          url.hostname === 'oauth2.googleapis.com'
          ? '/token'
          : url.pathname,
        base,
      );
      target.search = url.search;
      const headers = { ...request.headers() };
      delete headers.host;
      try {
        const requestBody = request.postDataBuffer();
        const response = await context.request.fetch(target.toString(), {
          method: request.method(),
          headers,
          ...(requestBody === null ? {} : { data: requestBody }),
          maxRetries: 0,
        });
        let body = await response.body();
        if (target.pathname === '/token' && response.ok()) {
          body = Buffer.from(
            JSON.stringify({
              ...JSON.parse(body.toString()),
              token_type: 'Bearer',
            }),
          );
        }
        await route.fulfill({
          status: response.status(),
          headers: {
            ...response.headers(),
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'Dropbox-API-Result, ETag',
          },
          body,
        });
      } catch {
        await route.abort('failed');
      }
    },
  );
}

async function openSettings() {
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

async function editableConnection(provider) {
  const picker = page.getByRole('combobox', {
    name: labels.workspace,
    exact: true,
  });
  await picker.click();
  const connect = page.getByRole('option', {
    name: provider === 'dropbox' ? labels.dropbox.connect : labels.connect,
    exact: true,
  });
  await until(
    async () => (await connect.getAttribute('aria-disabled')) !== 'true',
  );
  assert.equal(
    await connect.locator('img').getAttribute('src'),
    provider === 'dropbox' ? './dropbox.svg' : './google-drive.png',
  );
  await connect.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: labels.enable_editing_now, exact: true })
    .click();
  await until(
    async () =>
      (await page
        .getByRole('status')
        .filter({ hasText: labels.editable })
        .count()) > 0,
  );
  await closeDialog();
}

function activeTab() {
  return page.locator('#editor-tabs li[data-active=true]');
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
    async () => (await activeTab().getAttribute('data-dirty')) === 'true',
  );
}

async function save() {
  await page
    .getByRole('button', { name: toolbar.save_markdown_file, exact: true })
    .click();
}

async function checkDraft(content) {
  await until(async () =>
    (await page.locator('.monaco-editor').first().textContent())
      .replace(/\u00a0/g, ' ')
      .includes(content.split('\n')[0]),
  );
  assert.equal(await activeTab().getAttribute('data-dirty'), 'true');
}

async function fillName(name) {
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill(name);
  await dialog
    .getByRole('button', { name: labels.create, exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
}

async function identity() {
  const value = await activeTab().getAttribute('data-path');
  assert.match(value, /^cloud-(drive|dropbox):\/\//);
  return { path: value, id: decodeURIComponent(value.split('/').at(-1)) };
}

async function explorerMenu(label) {
  await page
    .locator('#sidebar')
    .getByRole('button', { name: labels.actions, exact: true })
    .click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function emptyContextMenu() {
  const area = page
    .locator('#sidebar')
    .getByRole('list', { name: labels.files, exact: true })
    .locator('..');
  const bounds = await area.boundingBox();
  assert.ok(bounds);
  await area.click({
    button: 'right',
    position: { x: bounds.width - 15, y: bounds.height - 12 },
  });
}

async function documentMenu(providerLabels, action) {
  await page
    .getByRole('button', { name: providerLabels.document_actions, exact: true })
    .click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

async function organizationMetadata(provider, id) {
  if (provider === 'dropbox') return dropbox.files.get(id);
  const response = await context.request.get(
    `${drive.endpoints.api}files/${encodeURIComponent(id)}`,
    { headers: { Authorization: 'Bearer smoke-access' } },
  );
  assert.ok(response.ok());
  return response.json();
}

async function deploymentChecks(origin) {
  await step(
    'missing public registration disables browser sign-in with a website configuration explanation',
    async () => {
      context = await browserContext();
      await intercept();
      let substitutions = 0;
      await context.route('**/*.js', async (route) => {
        if (!route.request().url().startsWith(origin)) return route.fallback();
        const response = await route.fetch();
        const body = (await response.text()).replace(
          /"?(googleClientId|dropboxAppKey)"?\s*:\s*"[^"]*"/g,
          (_match, key) => {
            substitutions++;
            return `${key}:""`;
          },
        );
        await route.fulfill({ response, body });
      });
      page = await context.newPage();
      await page.goto(origin);
      await page.locator('.monaco-editor').first().waitFor();
      await openSettings();
      await until(
        async () =>
          (await page
            .getByText(labels.web_config_unavailable, { exact: true })
            .count()) === 2,
      );
      assert.ok(
        substitutions >= 2,
        'The fixture must remove both public registration values.',
      );
      for (const name of ['Google Drive', 'Dropbox'])
        assert.equal(
          await page
            .getByRole('region', { name, exact: true })
            .first()
            .getByRole('button')
            .isDisabled(),
          true,
        );
      assert.equal(await page.getByLabel(labels.client_value).count(), 0);
      await context.close();
    },
  );
  await step(
    'missing Web Locks keeps local editing available and explains disabled cloud access',
    async () => {
      context = await browserContext();
      await context.addInitScript(() =>
        Object.defineProperty(navigator, 'locks', {
          configurable: true,
          value: undefined,
        }),
      );
      await intercept();
      page = await context.newPage();
      await page.goto(origin);
      await page.locator('.monaco-editor').first().waitFor();
      await edit('# Local writing without cloud locks\n');
      await openSettings();
      await page
        .getByText(labels.web_lock_unavailable, { exact: true })
        .waitFor();
      for (const name of ['Google Drive', 'Dropbox'])
        assert.equal(
          await page
            .getByRole('region', { name, exact: true })
            .first()
            .getByRole('button')
            .isDisabled(),
          true,
        );
      assert.equal(
        await page
          .getByRole('tab', { name: 'AI Providers', exact: true })
          .count(),
        0,
      );
      await context.close();
    },
  );
  await step(
    'denied browser storage disables sign-in without OS credential instructions',
    async () => {
      context = await browserContext();
      await context.addInitScript(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException(
            'Fixture denied browser storage',
            'QuotaExceededError',
          );
        };
      });
      await intercept();
      page = await context.newPage();
      await page.goto(origin);
      await page.locator('.monaco-editor').first().waitFor();
      await openSettings();
      await page.getByText(labels.web_unavailable, { exact: true }).waitFor();
      for (const name of ['Google Drive', 'Dropbox'])
        assert.equal(
          await page
            .getByRole('region', { name, exact: true })
            .first()
            .getByRole('button')
            .isDisabled(),
          true,
        );
      assert.equal(
        await page
          .getByText(labels.secure_unavailable, { exact: true })
          .count(),
        0,
      );
      await context.close();
    },
  );
}

async function organizationContent(provider, id) {
  if (provider === 'dropbox')
    return dropbox.files.get(id).content.replace(/\r\n/g, '\n');
  const response = await context.request.get(
    `${drive.endpoints.api}files/${encodeURIComponent(id)}?alt=media`,
    { headers: { Authorization: 'Bearer smoke-access' } },
  );
  assert.ok(response.ok());
  return (await response.text()).replace(/\r\n/g, '\n');
}

async function organizationChecks(provider) {
  const providerLabels = {
    ...labels,
    ...(provider === 'dropbox' ? labels.dropbox : {}),
  };
  let original, copy, folder, destination;
  const saved = `# Saved original ${provider}\n`;
  const dirty = `# Unsaved source ${provider}\n\nCopy exactly this buffer.\n`;
  await step(
    `${provider}: create a folder and Markdown file through Explorer menus`,
    async () => {
      await editableConnection(provider);
      await explorerMenu(labels.new_folder);
      await fillName('QA Documents');
      const folderRow = page
        .locator('#sidebar')
        .getByRole('button', { name: 'QA Documents', exact: true });
      await folderRow.waitFor();
      folder = await folderRow.locator('..').getAttribute('data-drive-item');
      await folderRow.click();
      await page
        .getByRole('status')
        .filter({ hasText: labels.empty })
        .waitFor();
      await emptyContextMenu();
      await page
        .getByRole('menuitem', { name: labels.new_file, exact: true })
        .click();
      await fillName('Original.md');
      await until(async () =>
        (await activeTab().textContent()).includes('Original.md'),
      );
      original = await identity();
      const metadata = await organizationMetadata(provider, original.id);
      if (provider === 'dropbox')
        assert.equal(metadata.path, '/QA Documents/Original.md');
      else assert.deepEqual(metadata.parents, [folder]);
      await edit(saved);
      await save();
      await until(async () => !(await activeTab().getAttribute('data-dirty')));
      assert.equal(await organizationContent(provider, original.id), saved);
    },
  );
  await step(
    `${provider}: Save a copy captures unsaved contents and preserves its source`,
    async () => {
      await edit(dirty);
      await explorerMenu(providerLabels.save_copy);
      await fillName('Copy.md');
      await until(async () =>
        (await activeTab().textContent()).includes('Copy.md'),
      );
      copy = await identity();
      assert.notEqual(copy.path, original.path);
      assert.equal(await organizationContent(provider, copy.id), dirty);
      assert.equal(await organizationContent(provider, original.id), saved);
      assert.equal(
        await page
          .locator('#editor-tabs li')
          .filter({ has: page.locator('a', { hasText: 'Original.md' }) })
          .getAttribute('data-dirty'),
        'true',
      );
      assert.ok(!(await activeTab().getAttribute('data-dirty')));
    },
  );
  await step(
    `${provider}: duplicate creation refuses overwrite and keeps both document identities`,
    async () => {
      await page
        .locator('#sidebar')
        .getByRole('button', { name: labels.new_file, exact: true })
        .click();
      await fillName('Copy.md');
      await page
        .locator('[data-sonner-toast]')
        .getByText(labels.error_duplicate, { exact: true })
        .last()
        .waitFor();
      assert.equal((await identity()).path, copy.path);
      assert.equal(await organizationContent(provider, copy.id), dirty);
      assert.equal(await organizationContent(provider, original.id), saved);
    },
  );
  await step(
    `${provider}: dirty reload cancellation protects edits and confirmation restores remote contents`,
    async () => {
      const discard = `# Cancel reload ${provider}\n`;
      await edit(discard);
      await documentMenu(providerLabels, providerLabels.reload);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: labels.cancel, exact: true })
        .click();
      await checkDraft(discard);
      await documentMenu(providerLabels, providerLabels.reload);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: providerLabels.reload, exact: true })
        .click();
      await until(async () => !(await activeTab().getAttribute('data-dirty')));
      assert.equal(await organizationContent(provider, copy.id), dirty);
      await until(async () =>
        (await page.locator('#preview-content').textContent()).includes(
          `Unsaved source ${provider}`,
        ),
      );
    },
  );
  await step(
    `${provider}: folder context creates into that folder without changing the current location`,
    async () => {
      await emptyContextMenu();
      await page
        .getByRole('menuitem', { name: labels.new_folder, exact: true })
        .click();
      await fillName('Destination');
      const row = page
        .locator('#sidebar')
        .getByRole('button', { name: 'Destination', exact: true });
      await row.waitFor();
      destination = await row.locator('..').getAttribute('data-drive-item');
      await row.click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: labels.new_file, exact: true })
        .click();
      await fillName('Nested.md');
      await until(async () =>
        (await activeTab().textContent()).includes('Nested.md'),
      );
      const nested = await identity();
      const metadata = await organizationMetadata(provider, nested.id);
      if (provider === 'dropbox')
        assert.equal(metadata.path, '/QA Documents/Destination/Nested.md');
      else assert.deepEqual(metadata.parents, [destination]);
      assert.equal(
        await page
          .locator('#sidebar')
          .getByRole('button', { name: labels.location, exact: true })
          .getAttribute('title'),
        `${provider === 'dropbox' ? 'Dropbox' : labels.my_drive} / QA Documents`,
      );
    },
  );
  await step(
    `${provider}: document context menu honors provider move capability`,
    async () => {
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'Original.md', exact: true })
        .click({ button: 'right' });
      const move = page.getByRole('menuitem', {
        name: labels.move_to,
        exact: true,
      });
      if (provider === 'dropbox') {
        assert.equal(await move.getAttribute('aria-disabled'), 'true');
        assert.equal(
          await move.getAttribute('aria-description'),
          labels.dropbox_move_unavailable,
        );
        await page.keyboard.press('Escape');
        assert.equal(dropbox.state.moves, 0);
        return;
      }
      await move.click();
      const dialog = page.getByRole('dialog', {
        name: labels.move_to,
        exact: true,
      });
      await dialog
        .getByRole('button', { name: 'QA Documents', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: 'Destination', exact: true })
        .click();
      await dialog
        .getByRole('button', { name: labels.move_here, exact: true })
        .click();
      await dialog.waitFor({ state: 'hidden' });
      await page
        .locator('#editor-tabs li')
        .filter({ has: page.locator('a', { hasText: 'Original.md' }) })
        .locator('a')
        .click();
      assert.equal((await identity()).path, original.path);
      await checkDraft(dirty);
      assert.equal(await organizationContent(provider, original.id), saved);
      assert.deepEqual(
        (await organizationMetadata(provider, original.id)).parents,
        [destination],
      );
      await save();
      await until(async () => !(await activeTab().getAttribute('data-dirty')));
      assert.equal(await organizationContent(provider, original.id), dirty);
    },
  );
  await step(
    `${provider}: Edit a local copy preserves the remote identity and contents`,
    async () => {
      await page
        .locator('#editor-tabs li')
        .filter({ has: page.locator('a', { hasText: 'Copy.md' }) })
        .locator('a')
        .click();
      await documentMenu(providerLabels, labels.local_copy);
      await until(async () =>
        (await activeTab().getAttribute('data-path')).startsWith('untitled-'),
      );
      await checkDraft(dirty);
      assert.equal(await organizationContent(provider, copy.id), dirty);
      assert.equal(
        await page
          .locator('#editor-tabs li')
          .filter({ has: page.locator('a', { hasText: 'Copy.md' }) })
          .count(),
        1,
      );
    },
  );
}

function recoveryContents(serialized) {
  const { session, ...recovery } = JSON.parse(serialized);
  return {
    ...recovery,
    tabs: session?.tabs
      .filter((tab) => tab.remote)
      .map(({ path: identity, remote }) => {
        const { pendingSave: _pendingSave, ...draft } = remote;
        return { identity, remote: draft };
      }),
  };
}

async function providerChecks(provider, origin) {
  const remote = provider === 'dropbox' ? dropbox : drive;
  const providerLabels = {
    ...labels,
    ...(provider === 'dropbox' ? labels.dropbox : {}),
  };
  const fileId = provider === 'dropbox' ? 'id:markdown' : 'markdown';
  const read = () =>
    (provider === 'dropbox'
      ? dropbox.files.get(fileId).content
      : drive.state.content
    ).replace(/\r\n/g, '\n');

  const writes = () =>
    provider === 'dropbox'
      ? dropbox.state.writes
      : drive.calls.filter((call) => call.method === 'PUT').length;
  await step(
    `${provider}: connect read-only, grant editing, open by identity`,
    async () => {
      await editableConnection(provider);
      if (provider === 'google-drive') {
        await edit(
          '# Browser HTML safety\n\n<strong>Safe inline HTML</strong>\n<img src="missing-qa-image" onerror="window.__cloudHtmlExecuted=true">\n<svg onload="window.__cloudHtmlExecuted=true"></svg>\n<iframe srcdoc="<script>parent.__cloudHtmlExecuted=true</script>"></iframe>\n<form><input name="secret"></form>\n<style>body{display:none}</style>',
        );
        await page
          .locator('#preview-content strong')
          .filter({ hasText: 'Safe inline HTML' })
          .waitFor();
        assert.equal(
          await page.evaluate(() => Boolean(window.__cloudHtmlExecuted)),
          false,
        );
        assert.equal(
          await page
            .locator(
              '#preview-content [onerror], #preview-content [onload], #preview-content iframe, #preview-content form, #preview-content style',
            )
            .count(),
          0,
        );
      }
      await page
        .locator('#sidebar')
        .getByRole('button', { name: 'notes.md', exact: true })
        .click();
      await until(async () =>
        (await activeTab().getAttribute('data-path'))?.startsWith(
          provider === 'dropbox' ? 'cloud-dropbox://' : 'cloud-drive://',
        ),
      );
    },
  );
  const content = `# Browser ${provider} café 日本語\n\nSaved snapshot.\n`;
  await step(
    `${provider}: recovery storage denial blocks writes and keeps a browser-specific error`,
    async () => {
      const previous = read();
      const count = writes();
      const draft = `# Retained after browser quota failure ${provider}\n`;
      await edit(draft);
      await page.evaluate(() => {
        window.__qaOriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'mkeditor-cloud-recovery')
            throw new DOMException(
              'Fixture denied recovery storage',
              'QuotaExceededError',
            );
          return window.__qaOriginalSetItem.call(this, key, value);
        };
      });
      try {
        await save();
        const notice = page
          .getByRole('status')
          .filter({ hasText: labels.save_failed })
          .first();
        await notice.waitFor();
        assert.equal(writes(), count);
        assert.equal(read(), previous);
        await checkDraft(draft);
        assert.doesNotMatch(
          await notice.textContent(),
          /OS credential|disk access/i,
          'Browser storage failures should describe browser recovery, not OS credential storage.',
        );
      } finally {
        await page.evaluate(() => {
          Storage.prototype.setItem = window.__qaOriginalSetItem;
          delete window.__qaOriginalSetItem;
        });
      }
    },
  );
  await step(`${provider}: confirmed conditional UTF-8 save`, async () => {
    await edit(content);
    await save();
    await until(async () => !(await activeTab().getAttribute('data-dirty')));
    assert.equal(read(), content);
    if (provider === 'dropbox') {
      assert.equal(dropbox.state.lastUpload.strict_conflict, true);
      assert.equal(dropbox.state.lastUpload.autorename, false);
      assert.equal(dropbox.state.lastUpload.mode['.tag'], 'update');
    } else
      assert.ok(
        drive.calls.find((call) => call.method === 'PUT' && call.ifMatch),
      );
    await page.screenshot({
      path: path.join(output, `${provider}.png`),
      fullPage: true,
    });
  });
  await step(
    `${provider}: edits during a pending save stay dirty`,
    async () => {
      let release;
      remote.state.writeWait = new Promise((resolve) => {
        release = resolve;
      });
      const start = writes();
      const submitted = `# Submitted ${provider}\n`;
      const later = `# Later ${provider}\n`;
      await edit(submitted);
      await save();
      await until(async () => writes() > start);
      await edit(later);
      release();
      remote.state.writeWait = undefined;
      await until(async () => read() === submitted);
      await until(
        async () =>
          !(
            await page
              .getByRole('button', {
                name: providerLabels.document_actions,
                exact: true,
              })
              .getAttribute('title')
          ).includes(labels.save_saving),
      );
      await checkDraft(later);
      await save();
      await until(async () => !(await activeTab().getAttribute('data-dirty')));
      assert.equal(read(), later);
    },
  );
  await step(
    `${provider}: lost save replies reconcile without replaying the write`,
    async () => {
      const lost = `# Unknown result ${provider}\n`;
      if (provider === 'dropbox') dropbox.state.loseWriteReply = true;
      else drive.state.loseWrite = true;
      await edit(lost);
      await save();
      await page
        .getByRole('status')
        .filter({ hasText: providerLabels.error_unconfirmed })
        .first()
        .waitFor();
      assert.equal(read(), lost);
      await checkDraft(lost);
      const count = writes();
      drive.state.loseWrite = false;
      await save();
      await until(async () => !(await activeTab().getAttribute('data-dirty')));
      assert.equal(
        writes(),
        count,
        'Reconciling an unknown save must not replay a write',
      );
    },
  );
  let draft = `# Recover browser ${provider}\n\nUnsaved draft.\n`;
  await step(
    `${provider}: stale writes preserve both remote content and dirty buffer`,
    async () => {
      if (provider === 'dropbox')
        dropbox.externalEdit(fileId, '# External update');
      else {
        drive.state.content = '# External update';
        drive.state.revision = String(Number(drive.state.revision) + 1);
        drive.state.contentRevision = `content-${drive.state.revision}`;
      }
      await edit(draft);
      await save();
      await page
        .getByRole('status')
        .filter({ hasText: providerLabels.error_conflict })
        .first()
        .waitFor();
      assert.equal(read(), '# External update');
      await checkDraft(draft);
      const count = writes();
      await save();
      assert.equal(writes(), count);
      const source = (await identity()).path;
      await page
        .getByRole('button', { name: providerLabels.compare, exact: true })
        .click();
      await until(async () =>
        (await activeTab().getAttribute('data-path')).startsWith('diff://'),
      );
      await page.locator('.monaco-diff-editor').waitFor();
      await until(async () =>
        (await page.locator('.monaco-diff-editor').textContent())
          .replace(/\u00a0/g, ' ')
          .includes('External update'),
      );
      await activeTab()
        .getByRole('button', { name: /^Close / })
        .click();
      await page
        .locator('#editor-tabs li')
        .filter({ has: page.locator('a', { hasText: 'notes.md' }) })
        .locator('a')
        .click();
      await until(
        async () => (await activeTab().getAttribute('data-path')) === source,
      );
      await checkDraft(draft);
    },
  );
  await step(
    `${provider}: a second browser tab cannot change cloud recovery or account metadata`,
    async () => {
      const owner = page;
      await until(async () =>
        owner.evaluate((expected) => {
          const stored = JSON.parse(
            localStorage.getItem('mkeditor-cloud-recovery') ?? 'null',
          );
          return stored?.session?.tabs.some(
            (tab) =>
              tab.remote?.document.content.replace(/\r\n/g, '\n') === expected,
          );
        }, draft),
      );
      const recovery = await owner.evaluate(() =>
        localStorage.getItem('mkeditor-cloud-recovery'),
      );
      const second = await context.newPage();
      page = second;
      try {
        await second.goto(origin);
        await second.locator('.monaco-editor').first().waitFor();
        await openSettings();
        await second.getByText(labels.web_busy, { exact: true }).waitFor();
        for (const name of ['Google Drive', 'Dropbox']) {
          assert.equal(
            await second
              .getByRole('region', { name, exact: true })
              .getByRole('button')
              .isDisabled(),
            true,
          );
        }
        assert.deepEqual(
          recoveryContents(
            await second.evaluate(() =>
              localStorage.getItem('mkeditor-cloud-recovery'),
            ),
          ),
          recoveryContents(recovery),
        );
      } finally {
        await second.close();
        page = owner;
      }
      await checkDraft(draft);
    },
  );
  await step(
    `${provider}: reload recovers drafts without persisting tokens`,
    async () => {
      draft = `# Final unload ${provider}\n\nTyped immediately before reload.\n`;
      await edit(draft);
      page.once('dialog', (dialog) => dialog.accept());
      await page.reload();
      await page.locator('.monaco-editor').first().waitFor();
      await checkDraft(draft);
      const stored = await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      );
      for (const secret of [
        'fixture-access',
        'fixture-refresh',
        'dropbox-access-',
        'dropbox-fixture-refresh',
      ])
        assert.ok(
          !stored.includes(secret),
          `${secret} leaked into Web Storage`,
        );
      assert.ok(page.url().startsWith(origin));
      const reconnectLabel = labels.web_reconnect.replace(
        '{{provider}}',
        provider === 'dropbox' ? 'Dropbox' : 'Google Drive',
      );
      await page
        .getByRole('button', { name: reconnectLabel, exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByText(providerLabels.recovered_draft, { exact: true })
          .count(),
        0,
      );
      await page
        .getByRole('combobox', { name: labels.workspace, exact: true })
        .click();
      await page
        .getByRole('option')
        .filter({ hasText: labels.web_reconnect_status })
        .waitFor();
      await page.keyboard.press('Escape');
      await page.screenshot({
        path: path.join(output, `${provider}-reconnect.png`),
        animations: 'disabled',
      });
      await page.locator('#darkmode-setting').click();
      await page.screenshot({
        path: path.join(output, `${provider}-reconnect-dark.png`),
        animations: 'disabled',
      });
      await page.locator('#darkmode-setting').click();
    },
  );
  await step(
    `${provider}: reconnect from the restored document checks its cloud version without uploading or losing edits`,
    async () => {
      const previousIdentity = await activeTab().getAttribute('data-path');
      const count = writes();
      const reconnectLabel = labels.web_reconnect.replace(
        '{{provider}}',
        provider === 'dropbox' ? 'Dropbox' : 'Google Drive',
      );
      await page
        .getByRole('button', { name: reconnectLabel, exact: true })
        .click();
      await until(
        async () =>
          (await page
            .getByRole('button', { name: reconnectLabel, exact: true })
            .count()) === 0 &&
          (await page
            .getByText(providerLabels.recovered_draft, { exact: true })
            .count()) === 0 &&
          (await page
            .getByText(providerLabels.checking_recovery, { exact: true })
            .count()) === 0,
      );
      await checkDraft(draft);
      assert.equal(
        await activeTab().getAttribute('data-path'),
        previousIdentity,
      );
      assert.equal(
        writes(),
        count,
        'Reconnection must not upload restored edits',
      );
      assert.equal(await page.getByRole('dialog').count(), 0);
    },
  );
  await step(
    `${provider}: backgrounding and pagehide checkpoint final edits without beforeunload`,
    async () => {
      const background = `# Background ${provider}\n\nCheckpoint while hidden.\n`;
      await edit(background);
      const backgroundContent = await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        const stored = JSON.parse(
          localStorage.getItem('mkeditor-cloud-recovery'),
        );
        return stored.session.tabs.find(
          (tab) => tab.path === stored.session.activeFile,
        ).remote.document.content;
      });
      assert.equal(backgroundContent.replace(/\r\n/g, '\n'), background);
      draft = `# Pagehide ${provider}\n\nCheckpoint before disposing.\n`;
      await edit(draft);
      const pagehideContent = await page.evaluate(() => {
        window.dispatchEvent(
          new PageTransitionEvent('pagehide', { persisted: false }),
        );
        const stored = JSON.parse(
          localStorage.getItem('mkeditor-cloud-recovery'),
        );
        return stored.session.tabs.find(
          (tab) => tab.path === stored.session.activeFile,
        ).remote.document.content;
      });
      assert.equal(pagehideContent.replace(/\r\n/g, '\n'), draft);
      page.once('dialog', (dialog) => dialog.accept());
      await page.reload();
      await page.locator('.monaco-editor').first().waitFor();
      await checkDraft(draft);
    },
  );
  await step(
    `${provider}: authorizing another account cannot retarget the recovered draft`,
    async () => {
      const identity = await activeTab().getAttribute('data-path');
      if (provider === 'dropbox') dropbox.state.account = 'dbid:other-account';
      else drive.state.accountId = 'other-account';
      await openSettings();
      await page
        .locator('section')
        .filter({ has: page.locator('input[id^="cloud-name-"]') })
        .filter({
          hasText:
            provider === 'dropbox'
              ? 'dropbox-fixture@example.test'
              : 'account-a@example.test',
        })
        .getByRole('button', { name: labels.reconnect, exact: true })
        .click();
      await until(
        async () =>
          (await page
            .getByRole('status')
            .filter({ hasText: labels.editable })
            .count()) > 0,
      );
      await closeDialog();
      assert.equal(await activeTab().getAttribute('data-path'), identity);
      await checkDraft(draft);
      const count = writes();
      await save();
      assert.equal(
        writes(),
        count,
        'A recovered tab belongs to its original verified account',
      );
      await checkDraft(draft);
    },
  );
  await step(
    `${provider}: clearing the saved session survives the final unload checkpoint`,
    async () => {
      await openSettings();
      await page
        .getByRole('tab', { name: settingsLabels.nav_workspace, exact: true })
        .click();
      await page
        .getByRole('button', {
          name: settingsLabels.clear_session_button,
          exact: true,
        })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', {
          name: settingsLabels.clear_session_confirm_button,
          exact: true,
        })
        .click();
      await until(async () =>
        page.evaluate(
          () =>
            localStorage.getItem('mkeditor-session') === null &&
            !JSON.parse(localStorage.getItem('mkeditor-cloud-recovery'))
              .session,
        ),
      );
      page.once('dialog', (dialog) => dialog.accept());
      await page.reload();
      await page.locator('.monaco-editor').first().waitFor();
      assert.equal(
        await page.locator('#editor-tabs li[data-path^="cloud-"]').count(),
        0,
      );
      assert.ok(
        !(await page.locator('.monaco-editor').first().textContent()).includes(
          `Pagehide ${provider}`,
        ),
      );
    },
  );
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  try {
    await step(
      process.argv.includes('--skip-build')
        ? 'reuse the configured production renderer artifact'
        : 'build isolated browser renderer with public fixture registration',
      build,
    );
    drive = await fixture('driveServer', 'driveFixture');
    drive.state.scopes =
      'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive';
    dropbox = await fixture('dropboxServer', 'dropboxFixture');
    const origin = await serve();
    browser = await chromium.launch({
      headless: !process.argv.includes('--headed'),
    });
    if (!argument('--focus') || argument('--focus') === 'deployment')
      await deploymentChecks(origin);
    for (const provider of argument('--focus')
      ? []
      : ['google-drive', 'dropbox']) {
      context = await browserContext({
        viewport: { width: 1400, height: 900 },
        locale: 'en-GB',
      });
      await intercept();
      page = await context.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(origin);
      await page.locator('.monaco-editor').first().waitFor();
      if (provider === 'dropbox')
        await step(
          'Dropbox: cancelled OAuth leaves no authorized account',
          async () => {
            await openSettings();
            cancelNextAuthorization = true;
            await page
              .getByRole('region', { name: 'Dropbox', exact: true })
              .getByRole('button')
              .click();
            await page
              .getByRole('alert')
              .filter({ hasText: labels.error_cancelled })
              .waitFor();
            assert.ok(
              !(await page
                .getByRole('status')
                .filter({ hasText: labels.editable })
                .count()),
            );
            await closeDialog();
          },
        );
      await providerChecks(provider, origin);
      await context.close();
    }
    const previousDrive = drive;
    try {
      organizationDrive =
        await require('./drive-smoke/fixture.cjs').createFixture();
      drive = organizationDrive;
      googleAccess = 'smoke-access';
      for (const provider of argument('--focus') === 'deployment'
        ? []
        : ['google-drive', 'dropbox']) {
        context = await browserContext({
          viewport: { width: 1400, height: 900 },
          locale: 'en-GB',
        });
        await intercept();
        page = await context.newPage();
        page.setDefaultTimeout(30_000);
        await page.goto(origin);
        await page.locator('.monaco-editor').first().waitFor();
        await organizationChecks(provider);
        await context.close();
      }
    } finally {
      drive = previousDrive;
      googleAccess = 'fixture-access';
    }
    assert.deepEqual(
      browserErrors,
      [],
      'The production UI must not emit uncaught browser errors.',
    );
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed';
    report.phase = phase;
    report.error = String(error.stack ?? error);
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      path.join(output, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await browser?.close();
    await drive?.close();
    await organizationDrive?.close();
    await dropbox?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
})();
