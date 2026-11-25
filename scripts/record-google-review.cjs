/** Opt-in live walkthrough. Uses production UI/Drive code; no fixture responses. */
const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  nativeImage,
} = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CloudService } = require('../dist/app/lib/cloud/CloudService');
const { GoogleDrive } = require('../dist/app/lib/cloud/GoogleDrive');

if (!process.argv.includes('--prepare-live-recording')) {
  console.error(
    'Requires --prepare-live-recording. Google consent is interactive.',
  );
  process.exit(1);
}
const root = path.resolve(__dirname, '../out/google-review');
fs.mkdirSync(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statusPath = path.join(root, 'status.json');
const controlPath = path.join(root, 'command.json');
const captionPath = path.join(root, 'caption.txt');
const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const videoPath = path.join(root, `mkeditor-google-review-${runId}.mp4`);
let win, service, ffmpeg, screenshotLoop, encoderExit;
let browserWindow;
let profileDirectory;
let source = 'app';
let recording = false;
let stop = false;
let credentialsPaused = false;
let phase = 'preparing';
let connectionData = [];
let frameCount = 0;
let lastCommand;
let folderId;
const createdFiles = [];

function status(next, message) {
  phase = next;
  fs.writeFileSync(
    statusPath,
    JSON.stringify(
      {
        phase,
        message,
        recording,
        frameCount,
        video: path.basename(videoPath),
      },
      null,
      2,
    ),
  );
  console.log(message);
}

function caption(text) {
  fs.writeFileSync(captionPath, text);
}

function nativeWindow(mode, handle) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'record-google-window.ps1'),
    '-Mode',
    mode,
  ];
  if (handle) args.push('-WindowHandle', String(handle));
  const result = spawnSync('powershell.exe', args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error('Could not inspect the recording browser window.');
  return JSON.parse(result.stdout.trim());
}

async function ui(expression) {
  return win.webContents.executeJavaScript(expression, true);
}

async function until(check, description, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!stop && Date.now() < end) {
    if (await check()) return;
    await delay(250);
  }
  throw Error(`Stopped or timed out: ${description}`);
}

async function click(label) {
  await until(
    () =>
      ui(
        `(() => { const buttons = [...document.querySelectorAll('button')].filter(node => !node.disabled && node.textContent.trim() === ${JSON.stringify(label)}); if (!buttons.length) return false; buttons.at(-1).click(); return true; })()`,
      ),
    `button ${label}`,
    20000,
  );
}

async function control(action) {
  await until(
    () => {
      if (!fs.existsSync(controlPath)) return false;
      const value = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
      if (value.id === lastCommand || value.action !== action) return false;
      lastCommand = value.id;
      return true;
    },
    `waiting for ${action}`,
    1800000,
  );
}

async function foregroundApp() {
  source = 'app';
  win.show();
  win.focus();
  await delay(600);
}

async function openAuthorization(url) {
  const authorization = new URL(url);
  authorization.searchParams.set('hl', 'en');
  caption(
    `${authorization.searchParams.get('scope').split(' ').includes('https://www.googleapis.com/auth/drive') ? '2. Google consent for editing access' : '1. Google consent for read-only access'}\nOAuth client: ${authorization.searchParams.get('client_id')}`,
  );
  const before = nativeWindow('list');
  spawn(
    process.env.MKEDITOR_REVIEW_CHROME ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      `--profile-directory=${profileDirectory}`,
      '--new-window',
      authorization.toString(),
    ],
    { windowsHide: false, stdio: 'ignore' },
  );
  await until(
    () => {
      const added = nativeWindow('list').filter(
        (handle) => !before.includes(handle),
      );
      if (!added.length) return false;
      browserWindow = added[0];
      return true;
    },
    'regular-profile consent window',
    20000,
  );
  nativeWindow('focus', browserWindow);
  source = 'browser';
  status(
    'awaiting-consent',
    'Google consent is open. Review every requested permission in English, scroll if needed, and authorize when ready.',
  );
}

async function startRecording() {
  caption(
    'MKEditor - Google Drive verification\nLive Google account; disposable review documents only',
  );
  const escapeFilter = (value) =>
    value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  ffmpeg = spawn(
    process.env.MKEDITOR_REVIEW_FFMPEG || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-n',
      '-f',
      'image2pipe',
      '-framerate',
      '5',
      '-vcodec',
      'png',
      '-i',
      'pipe:0',
      '-vf',
      `pad=1280:900:0:0:color=black,drawtext=fontfile='${escapeFilter('C:/Windows/Fonts/segoeui.ttf')}':textfile='${escapeFilter(captionPath)}':reload=1:fontcolor=white:fontsize=23:x=24:y=817:line_spacing=10`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      videoPath,
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  encoderExit = new Promise((resolve) => {
    ffmpeg.once('exit', resolve);
    ffmpeg.once('error', () => resolve(-1));
  });
  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', () => {
    stop = true;
  });
  ffmpeg.stdin.on('error', () => {
    stop = true;
  });
  recording = true;
  screenshotLoop = (async () => {
    while (recording && !stop) {
      const started = Date.now();
      let png;
      if (source === 'browser') {
        let info;
        try {
          info = nativeWindow('capture', browserWindow);
        } catch {
          // Google may close its consent window immediately after redirect.
          // Skip that frame while the main flow switches back to MKEditor.
          await delay(200);
          continue;
        }
        if (!info.ready || (!info.png && !info.sensitive)) {
          await delay(200);
          continue;
        }
        const sensitive = info.sensitive;
        if (sensitive) {
          if (!credentialsPaused) {
            credentialsPaused = true;
            status(
              'credentials-paused',
              'Recording paused for a Google password or verification-code screen. Complete it; capture resumes after that screen closes.',
            );
          }
          await delay(250);
          continue;
        }
        if (credentialsPaused) {
          credentialsPaused = false;
          status(
            'awaiting-consent',
            'Credential entry has finished; recording Google consent again.',
          );
        }
        try {
          png = nativeImage
            .createFromBuffer(Buffer.from(info.png, 'base64'))
            .resize({ width: 1280, height: 800 })
            .toPNG();
        } catch {
          await delay(200);
          continue;
        }
      } else
        png = (await win.webContents.capturePage())
          .resize({ width: 1280, height: 800 })
          .toPNG();
      // Keep the video clock close to wall time even when native capture is slow.
      const repeats = Math.max(1, Math.round((Date.now() - started) / 200));
      for (let repeat = 1; repeat < repeats; repeat++) {
        if (!ffmpeg.stdin.write(png))
          await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
        frameCount++;
      }
      if (!ffmpeg.stdin.write(png))
        await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
      frameCount++;
      await delay(Math.max(0, 200 - (Date.now() - started)));
    }
  })();
}

async function finishRecording() {
  recording = false;
  try {
    await screenshotLoop;
  } finally {
    ffmpeg.stdin.end();
  }
  const exit = await encoderExit;
  if (exit !== 0) throw Error('Video encoder did not finish successfully.');
}

async function editorInput(text) {
  await ui(
    `document.querySelector('.monaco-editor textarea, .monaco-editor [contenteditable], .monaco-editor .native-edit-context, .monaco-editor [role=textbox]').focus()`,
  );
  await win.webContents.debugger.sendCommand('Input.insertText', { text });
  await delay(900);
}

async function save() {
  await ui(
    `document.querySelector('button[title="Save markdown file"]').click()`,
  );
  await until(
    () => ui(`document.body.textContent.includes('Saved to Drive.')`),
    'save acknowledgement',
    90000,
  );
  await delay(3500);
}

app
  .whenReady()
  .then(async () => {
    if (
      !safeStorage.isAsyncEncryptionAvailable ||
      !(await safeStorage.isAsyncEncryptionAvailable())
    )
      throw Error('Secure operating-system credential storage is unavailable.');
    const regularBrowser = JSON.parse(
      fs
        .readFileSync(path.join(root, 'regular-browser.json'), 'utf8')
        .replace(/^\uFEFF/, ''),
    );
    browserWindow = regularBrowser.windowHandle;
    profileDirectory = regularBrowser.profileDirectory;
    if (!/^(Default|Profile [0-9]+)$/.test(profileDirectory ?? ''))
      throw Error('The selected regular Chrome profile is missing.');
    if (!nativeWindow('list').includes(browserWindow))
      throw Error('The selected regular Chrome window is no longer open.');
    const drive = new GoogleDrive();
    const store = {
      load: () => connectionData,

      save: (value) => {
        connectionData = value;
      },

      available: () => safeStorage.isAsyncEncryptionAvailable(),

      encrypt: async (value) =>
        (await safeStorage.encryptStringAsync(JSON.stringify(value))).toString(
          'base64',
        ),

      decrypt: async (value) =>
        JSON.parse(
          (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64')))
            .result,
        ),
    };
    service = new CloudService(
      store,
      openAuthorization,
      (state) => {
        if (win && !win.isDestroyed())
          win.webContents.send('from:cloud:state', state);
      },
      drive,
    );
    ipcMain.on('to:cloud:request', async (event, request) => {
      const response = await service.handle(request);
      if (!event.sender.isDestroyed())
        event.sender.send('from:cloud:result', response);
      if (!response.ok)
        status(
          'operation-error',
          `MKEditor reported: ${response.error}. No provider detail or credential was logged.`,
        );
    });
    for (const [channel, value] of [
      ['mked:get-locale', 'en'],
      ['mked:get-active-file', null],
      ['mked:secure:public-key', ''],
    ])
      ipcMain.on(channel, (event) => {
        event.returnValue = value;
      });
    ipcMain.handle('mked:path:dirname', (_event, value) => path.dirname(value));
    ipcMain.on('to:window:close', () => {
      stop = true;
    });
    win = new BrowserWindow({
      show: false,
      frame: false,
      useContentSize: true,
      width: 1280,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, '../dist/app/preload.js'),
      },
    });
    win.webContents.debugger.attach('1.3');
    await win.loadFile(path.resolve(__dirname, '../dist/index.html'));
    await until(
      () =>
        ui(
          `Boolean(document.querySelector('.monaco-editor')) && getComputedStyle(document.querySelector('#react-root')).opacity === '1'`,
        ),
      'MKEditor ready',
      30000,
    );
    status(
      'waiting-login',
      'Your regular Chrome profile is selected. Recording is waiting for the start command.',
    );
    await control('start');
    await foregroundApp();
    await startRecording();
    win.webContents.send('from:modal:open', {
      modal: 'settings',
      tab: 'connections',
    });
    caption(
      '1. Connect with Google\nMKEditor requests read-only access for its folder browser',
    );
    await delay(3500);
    await click('Connect with Google');
    await until(
      () => connectionData.some((entry) => entry.status === 'connected'),
      'read-only Google consent',
      180000,
    );
    await delay(1800);
    await foregroundApp();
    caption(
      '2. Enable editing separately\nA new Google consent flow requests permission to save and create files',
    );
    await delay(3500);
    await click('Enable editing');
    await delay(3000);
    await click('Enable editing');
    await until(
      () =>
        connectionData.some(
          (entry) => entry.status === 'connected' && entry.writeAccess,
        ),
      'editing Google consent',
      180000,
    );
    await delay(1800);
    await foregroundApp();
    caption(
      'Editing access granted\nPreparing a disposable folder and sample document for the walkthrough',
    );
    const entry = connectionData.find(
      (entry) => entry.status === 'connected' && entry.writeAccess,
    );
    const tokens = await store.decrypt(entry.credential);
    const authorization = { Authorization: `Bearer ${tokens.access}` };
    const generated = await drive.request(
      'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',
      { headers: authorization },
    );
    folderId = (await generated.json()).ids[0];
    const folderName = `MKEditor review ${runId}`;
    const manifest = {
      runId,
      folderId,
      folderName,
      files: createdFiles,
      video: path.basename(videoPath),
      completed: false,
    };
    const saveManifest = () =>
      fs.writeFileSync(
        path.join(root, `review-${runId}.json`),
        JSON.stringify(manifest, null, 2),
      );
    saveManifest();
    const folderResponse = await drive.request(
      'https://www.googleapis.com/drive/v3/files?fields=id',
      {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: folderId,
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root'],
          appProperties: { mkeditorReviewRun: runId },
        }),
      },
      false,
    );
    if ((await folderResponse.json()).id !== folderId)
      throw Error('Review folder creation could not be confirmed.');
    const seedName = 'Review notes.md';
    const seedId = await drive.prepareCreate(tokens.access, folderId, seedName);
    createdFiles.push({ id: seedId, name: seedName });
    saveManifest();
    const authorizeWrite = () => {
      if (
        !connectionData.some(
          (current) =>
            current.id === entry.id &&
            current.accountId === entry.accountId &&
            current.status === 'connected',
        )
      )
        throw Error('Demo account disconnected; no further write started.');
    };
    await drive.create(
      tokens.access,
      seedId,
      folderId,
      seedName,
      '# Review notes\n\nThis is a disposable document for the MKEditor review.\n',
      `review-seed-${runId}`,
      authorizeWrite,
    );
    // Invoke the real manager's folder navigation while Settings is still open.
    // This avoids recording unrelated root filenames; no list responses are substituted.
    await ui(`(async () => {
    const root = document.getElementById('react-root');
    const key = Object.keys(root).find(key => key.startsWith('__reactContainer$'));
    const initial = root[key];
    const queue = [initial?.stateNode?.current ?? initial];
    const seen = new Set();
    while (queue.length) {
      const fiber = queue.shift(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
      const manager = fiber.memoizedProps?.value?.bridgeManager?.cloudManager;
      if (manager) { await manager.browse([{ id: 'root', name: 'my_drive' }, { id: ${JSON.stringify(folderId)}, name: ${JSON.stringify(folderName)} }]); return true; }
      queue.push(fiber.child, fiber.sibling);
    }
    throw Error('Recording could not locate the live cloud manager.');
  })()`);
    await ui(
      `document.querySelector('[role=dialog] button[aria-label=Close]').click()`,
    );
    if (
      !(await ui(`Boolean(document.querySelector('#sidebar [role=combobox]'))`))
    )
      await ui(`document.querySelector('#sidebar-toggle').click()`);
    caption(
      '3. Browse a real Google Drive folder\nOnly disposable review files are shown',
    );
    await until(
      () =>
        ui(
          `Boolean([...document.querySelectorAll('#sidebar button')].find(node => node.textContent.includes(${JSON.stringify(seedName)})))`,
        ),
      'review folder listing',
      30000,
    );
    await delay(4500);
    await ui(
      `[...document.querySelectorAll('#sidebar button')].find(node => node.textContent.includes(${JSON.stringify(seedName)})).click()`,
    );
    await until(
      () => ui(`document.body.textContent.includes('Editing enabled')`),
      'editable document opened',
      30000,
    );
    caption(
      '4. Open, edit and save an existing Markdown file\nThe provider-issued revision protects against stale overwrites',
    );
    await delay(3000);
    await editorInput('Saved from MKEditor during the Google review.\n\n');
    await save();
    const saved = await drive.read(tokens.access, seedId, true);
    if (
      !saved.content.includes('Saved from MKEditor during the Google review.')
    )
      throw Error('Google did not return the saved sample contents.');
    caption(
      '5. Create a new Markdown file in the chosen Drive folder\nCreation uses a new file ID and does not overwrite an existing item',
    );
    await click('New Markdown file');
    await until(
      () => ui(`Boolean(document.querySelector('[role=dialog] input'))`),
      'new-file name dialog',
      10000,
    );
    await ui(
      `document.querySelector('[role=dialog] input').focus(); document.querySelector('[role=dialog] input').select()`,
    );
    const newName = 'Created in MKEditor.md';
    await win.webContents.debugger.sendCommand('Input.insertText', {
      text: newName,
    });
    await delay(2500);
    await click('Create');
    await until(
      () =>
        ui(
          `!document.querySelector('[role=dialog]') && document.body.textContent.includes(${JSON.stringify(newName)})`,
        ),
      'new file created',
      60000,
    );
    await editorInput(
      '# Created in MKEditor\n\nThis disposable file was created and saved through the real Drive connection.\n',
    );
    await save();
    const listing = await drive.list(tokens.access, folderId);
    const created = listing.items.find((item) => item.name === newName);
    if (!created) throw Error('Created file was not found in Google Drive.');
    createdFiles.push({ id: created.id, name: created.name });
    saveManifest();
    const createdContents = await drive.read(tokens.access, created.id, true);
    if (!createdContents.content.includes('# Created in MKEditor'))
      throw Error('Created file content could not be verified.');
    caption(
      '6. Both documents verified through the Google Drive API\nExisting-file save and new-file contents were confirmed',
    );
    await delay(4000);
    await foregroundApp();
    caption(
      'Completed: browser consent, browsing, conditional save and new file creation\nMKEditor connects directly to Google; credentials remain in the demo session',
    );
    await delay(5000);
    await finishRecording();
    manifest.completed = true;
    manifest.verifiedExistingSave = true;
    manifest.verifiedNewFile = true;
    saveManifest();
    status(
      'complete',
      `Recording complete: ${path.basename(videoPath)}. The disposable review folder was retained for inspection.`,
    );
  })
  .catch(async (error) => {
    status(
      'failed',
      `Recording stopped: ${error.message.includes('https:') ? 'Provider or browser request failed.' : error.message}`,
    );
    if (recording) await finishRecording().catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    service?.dispose();
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(process.exitCode || 0);
  });
