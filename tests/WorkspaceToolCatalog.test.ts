import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BrowserWindow } from 'electron';
import { AppStorage } from '../src/app/lib/AppStorage';
import { WorkspaceFiles } from '../src/app/lib/WorkspaceFiles';
import { AssistantTools } from '../src/browser/core/AssistantTools';
import {
  toolFailure,
  withinWorkspacePath,
} from '../src/app/shared/workspacePaths';
import {
  parseWorkspaceMarkdown,
  rewriteWorkspaceLinks,
} from '../src/browser/core/workspaceMarkdown';

jest.mock('electron', () => ({ shell: { trashItem: jest.fn() } }));
let root: string;
let tools: AssistantTools;
let native: WorkspaceFiles;
let models: Map<string, ReturnType<typeof fakeModel>>;
let dirty: Set<string>;
let snapshot: () => { treeRoot: string; nodes: [] };
let tabActions: {
  activeFile: string | null;
  saveTab: jest.Mock;
  closeTab: jest.Mock;
};
let settingsActions: { getSettings: jest.Mock; updateSetting: jest.Mock };
function fakeModel(initial: string) {
  let content = initial,
    version = 1;
  return {
    getValue: () => content,

    getLineCount: () => content.split('\n').length,

    getAlternativeVersionId: () => version,

    getFullModelRange: () => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: content.length + 1,
    }),
    pushStackElement: jest.fn(),
    pushEditOperations: jest.fn(
      (_a: unknown, edits: Array<{ text: string }>) => {
        content = edits[0].text;
        version++;
      },
    ),
    setValue: (next: string) => {
      content = next;
      version++;
    },
  };
}
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'mkeditor-tool-catalog-')),
  );
  AppStorage.setWorkspaceRoot(root);
  models = new Map();
  dirty = new Set();
  native = new WorkspaceFiles({
    webContents: {
      send: (
        channel: string,
        payload: { oldPath: string; newPath: string },
      ) => {
        if (channel === 'from:path:renamed')
          for (const [path, model] of [...models])
            if (
              path === payload.oldPath ||
              withinWorkspacePath(path, payload.oldPath)
            ) {
              const next = payload.newPath + path.slice(payload.oldPath.length);
              models.delete(path);
              models.set(next, model);
              if (dirty.delete(path)) dirty.add(next);
            }
      },
    },
  } as unknown as BrowserWindow);
  window.mked = {
    workspaceOperation: async (request) => {
      try {
        return { ok: true, value: await native.request(request) };
      } catch (error) {
        return toolFailure(error);
      }
    },
  } as NonNullable<Window['mked']>;
  snapshot = () => ({ treeRoot: root, nodes: [] });
  tabActions = {
    activeFile: null,
    saveTab: jest.fn(async (path: string) => {
      const file = await native.readText(path);
      await native.request({
        action: 'write-batch',
        changes: [
          {
            path,
            expected: file.content,
            content: models.get(path)!.getValue(),
          },
        ],
      });
      dirty.delete(path);
      return true;
    }),
    closeTab: jest.fn(async (path: string) => {
      models.delete(path);
      dirty.delete(path);
      return 'closed';
    }),
  };
  settingsActions = {
    getSettings: jest.fn(() => ({ wordwrap: true, darkmode: false })),
    updateSetting: jest.fn(),
  };
  tools = new AssistantTools({
    providers: {
      settings: settingsActions,
      exportSettings: {
        getSettings: () => ({
          withStyles: true,
          container: 'container',
          fontSize: 16,
          lineSpacing: 1.7,
          background: '#fff',
          fontColor: '#222',
        }),
      },
    },
    fileTreeManager: {
      getSnapshot: snapshot,
      listWorkspaceFiles: () => AppStorage.listWorkspaceFiles(root),
      workspaceFilesChanged: jest.fn(),
    },
    fileManager: {
      models,
      get activeFile() {
        return tabActions.activeFile;
      },

      getActiveEditablePath: () => tabActions.activeFile,
      saveTab: tabActions.saveTab,
      closeTab: tabActions.closeTab,
      getSnapshot: () => ({
        tabs: [...models].map(([path]) => ({
          path,
          name: path,
          dirty: dirty.has(path),
        })),
      }),
      recordSavedVersion: jest.fn((path) => dirty.delete(path)),
    },
  } as never);
});
afterEach(async () => {
  AppStorage.setWorkspaceRoot(null);
  delete window.mked;
  await fs.rm(root, { recursive: true, force: true });
  jest.restoreAllMocks();
});

it('moves a localized folder and repairs inbound and outbound links in one call', async () => {
  await fs.mkdir(join(root, 'it'));
  await fs.writeFile(
    join(root, 'it/introduction.md'),
    '# Ciao\n[Home](../README.md)',
  );
  await fs.writeFile(
    join(root, 'README.md'),
    '# Home\n[Italian](it/introduction.md#ciao)',
  );
  const open = fakeModel('# Ciao\n[Home](../README.md)');
  models.set(join(root, 'it/introduction.md'), open);
  const args = { source: 'it', destination: 'mkeditor/it' };
  const preview = await tools.preparePreview('move_path', args);
  expect(preview?.summary).toContain('2 link(s) in 2 file(s)');
  expect(tools.requiresConfirmation('move_path', args)).toBe(true);
  await tools.execute('move_path', args);
  expect(
    await fs.readFile(join(root, 'mkeditor/it/introduction.md'), 'utf8'),
  ).toContain('../../README.md');
  expect(await fs.readFile(join(root, 'README.md'), 'utf8')).toContain(
    'mkeditor/it/introduction.md#ciao',
  );
  expect(await native.info('it')).toMatchObject({ exists: false });
  expect(models.get(join(root, 'mkeditor/it/introduction.md'))).toBe(open);
  expect(open.getValue()).toContain('../../README.md');
});
it('renames an unsaved open file, retains its model and warns in confirmation', async () => {
  await fs.writeFile(join(root, 'draft.md'), 'saved');
  const model = fakeModel('my unsaved edits');
  models.set(join(root, 'draft.md'), model);
  dirty.add(join(root, 'draft.md'));
  const args = { path: 'draft.md', newName: 'renamed.md' };
  expect((await tools.preparePreview('rename_path', args))?.detail).toContain(
    'Unsaved edits',
  );
  await tools.execute('rename_path', args);
  expect(models.get(join(root, 'renamed.md'))).toBe(model);
  expect(model.getValue()).toBe('my unsaved edits');
  expect(dirty.has(join(root, 'renamed.md'))).toBe(true);
  expect(await fs.readFile(join(root, 'renamed.md'), 'utf8')).toBe('saved');
  await expect(
    tools.preparePreview('delete_path', { path: 'renamed.md' }),
  ).rejects.toMatchObject({ code: 'unsaved_changes' });
});
it('refuses incomplete workspace-wide plans while allowing explicit file paths', async () => {
  await fs.writeFile(join(root, 'note.md'), 'old');
  jest.spyOn(AppStorage, 'listWorkspaceFiles').mockResolvedValue({
    paths: [join(root, 'note.md')],
    truncated: true,
  });
  await expect(
    tools.preparePreview('find_and_replace', {
      find: 'old',
      replace: 'new',
      dryRun: false,
    }),
  ).rejects.toMatchObject({ code: 'listing_truncated' });
  await expect(
    tools.execute('search_files', { query: 'old' }),
  ).rejects.toMatchObject({ code: 'listing_truncated' });
  expect(await fs.readFile(join(root, 'note.md'), 'utf8')).toBe('old');
  expect(
    await tools.execute('find_and_replace', {
      find: 'old',
      replace: 'new',
      paths: ['note.md'],
    }),
  ).toMatchObject({ dryRun: true, matches: 1 });
});

it('searches unopened files, prefers unsaved buffers and caps results/snippets', async () => {
  await fs.mkdir(join(root, 'nested'));
  await fs.writeFile(join(root, 'nested/note.md'), 'Hello world\nHELLO again');
  await fs.writeFile(join(root, 'open.md'), 'nothing on disk');
  models.set(join(root, 'open.md'), fakeModel('hello live edits'));
  const result = (await tools.execute('search_files', {
    query: 'hello',
    maxResults: 2,
  })) as { matches: unknown[]; truncated: boolean };
  expect(result.matches).toHaveLength(2);
  expect(result.truncated).toBe(true);
  expect(
    await tools.execute('search_files', { query: 'live edits' }),
  ).toMatchObject({
    matches: [
      { file: join(root, 'open.md'), line: 1, snippet: 'hello live edits' },
    ],
  });
});
it('dry-run replacement changes neither disk nor open model; accepted write saves both', async () => {
  await fs.writeFile(join(root, 'note.md'), 'old saved');
  const model = fakeModel('old unsaved');
  models.set(join(root, 'note.md'), model);
  dirty.add(join(root, 'note.md'));
  expect(
    await tools.execute('find_and_replace', { find: 'old', replace: 'new' }),
  ).toMatchObject({ dryRun: true, matches: 1 });
  expect(await fs.readFile(join(root, 'note.md'), 'utf8')).toBe('old saved');
  expect(model.getValue()).toBe('old unsaved');
  const args = { find: 'old', replace: 'new', dryRun: false };
  expect(
    (await tools.preparePreview('find_and_replace', args))?.detail,
  ).toContain('unsaved edits');
  await tools.execute('find_and_replace', args);
  expect(await fs.readFile(join(root, 'note.md'), 'utf8')).toBe('new unsaved');
  expect(model.getValue()).toBe('new unsaved');
  expect(model.pushEditOperations).toHaveBeenCalled();
});
it('refuses text writes when a buffer or disk changes after preview', async () => {
  await fs.writeFile(join(root, 'note.md'), 'old');
  const args = { find: 'old', replace: 'new', dryRun: false };
  await tools.preparePreview('find_and_replace', args);
  await fs.writeFile(join(root, 'note.md'), 'external');
  await expect(tools.execute('find_and_replace', args)).rejects.toMatchObject({
    code: 'stale_plan',
  });
  expect(await fs.readFile(join(root, 'note.md'), 'utf8')).toBe('external');
});
it('standalone link repair ignores external URLs and fenced/inline code', async () => {
  await fs.writeFile(
    join(root, 'index.md'),
    '[old](old.md)\n![image](old.md)\n[ref][doc]\n[doc]: old.md#title\n[external](https://site/old.md)\n`[code](old.md)`\n```md\n[code](old.md)\n```',
  );
  const args = { oldPath: 'old.md', newPath: 'new.md', dryRun: false };
  await tools.preparePreview('update_links', args);
  await tools.execute('update_links', args);
  const content = await fs.readFile(join(root, 'index.md'), 'utf8');
  expect(content).toContain('[old](new.md)');
  expect(content).toContain('[doc]: new.md#title');
  expect(content).toContain('https://site/old.md');
  expect(content).toContain('`[code](old.md)`');
  expect(content).toContain('```md\n[code](old.md)');
});
it('reports manually deleted files, missing images and broken anchors', async () => {
  await fs.writeFile(
    join(root, 'index.md'),
    '[gone](deleted.md)\n![missing](missing.png)\n[bad](target.md#missing)\n[good](target.md#hello-world)',
  );
  await fs.writeFile(join(root, 'target.md'), '# Hello world');
  const result = (await tools.execute('check_links', {})) as {
    broken: unknown[];
  };
  expect(result.broken).toHaveLength(3);
  expect(
    await tools.execute('get_outline', { path: 'target.md' }),
  ).toMatchObject({
    headings: [
      { level: 1, line: 1, text: 'Hello world', anchor: 'hello-world' },
    ],
  });
});
it('uses one Markdown parser for Setext/duplicate headings and balanced destinations', () => {
  expect(
    parseWorkspaceMarkdown('# Hi\n\nHi\n==\n```\n# hidden\n```').headings.map(
      (h) => h.anchor,
    ),
  ).toEqual(['hi', 'hi-1']);
  const input = '[nested label [text]](docs/old(1).md "title")';
  expect(
    rewriteWorkspaceLinks(
      input,
      '/work/index.md',
      '/work/docs/old(1).md',
      '/work/new.md',
    ).content,
  ).toBe('[nested label [text]](new.md "title")');
});
it('supports regex captures without running untrusted expressions on the renderer thread', async () => {
  await fs.writeFile(join(root, 'note.md'), 'word-12\nword-34');
  expect(
    await tools.execute('search_files', { query: 'word-\\d+', regex: true }),
  ).toMatchObject({ matches: [{ line: 1 }, { line: 2 }] });
  const args = {
    find: 'word-(\\d+)',
    replace: 'item-$1',
    regex: true,
    dryRun: false,
  };
  await tools.preparePreview('find_and_replace', args);
  await tools.execute('find_and_replace', args);
  expect(await fs.readFile(join(root, 'note.md'), 'utf8')).toBe(
    'item-12\nitem-34',
  );
  await expect(
    native.request({
      action: 'regex-text',
      content: 'a'.repeat(35) + '!',
      query: '(a+)+$',
    }),
  ).rejects.toMatchObject({ code: 'regex_timeout' });
});
it('rejects outside paths in every newly registered path-bearing tool', async () => {
  for (const [name, args] of [
    ['path_info', { path: '../outside.md' }],
    ['search_files', { query: 'x', subpath: '../outside' }],
    ['find_and_replace', { find: 'x', replace: 'y', paths: ['../outside'] }],
    ['update_links', { oldPath: '../outside', newPath: 'inside' }],
    ['check_links', { subpath: '../outside' }],
    ['get_outline', { path: '../outside' }],
  ] as const)
    await expect(tools.execute(name, args)).rejects.toMatchObject({
      code: 'outside_workspace',
    });
});
it('reads exact inclusive ranges without changing the existing full-file result', async () => {
  await fs.writeFile(join(root, 'lines.md'), 'one\r\ntwo\r\nthree\r\nfour');
  expect(
    await tools.execute('read_file', {
      path: 'lines.md',
      startLine: 2,
      endLine: 3,
    }),
  ).toMatchObject({
    content: 'two\r\nthree',
    lineCount: 4,
    startLine: 2,
    endLine: 3,
  });
  expect(await tools.execute('read_file', { path: 'lines.md' })).toMatchObject({
    content: 'one\r\ntwo\r\nthree\r\nfour',
    lineCount: 4,
  });
  await expect(
    tools.execute('read_file', { path: 'lines.md', startLine: 5 }),
  ).rejects.toMatchObject({ code: 'invalid_range' });
});
it('appends clean files natively and edits line ranges with preserved CRLF and insertions', async () => {
  await fs.writeFile(join(root, 'lines.md'), 'one\r\ntwo\r\nthree');
  await tools.execute('append_to_file', {
    path: 'lines.md',
    content: '\r\nfour',
  });
  expect(await fs.readFile(join(root, 'lines.md'), 'utf8')).toBe(
    'one\r\ntwo\r\nthree\r\nfour',
  );
  await tools.execute('edit_lines', {
    path: 'lines.md',
    startLine: 2,
    endLine: 3,
    newText: 'replaced',
  });
  expect(await fs.readFile(join(root, 'lines.md'), 'utf8')).toBe(
    'one\r\nreplaced\r\nfour',
  );
  await tools.execute('edit_lines', {
    path: 'lines.md',
    startLine: 2,
    endLine: 1,
    newText: 'inserted',
  });
  expect(await fs.readFile(join(root, 'lines.md'), 'utf8')).toBe(
    'one\r\ninserted\r\nreplaced\r\nfour',
  );
  await expect(
    tools.execute('edit_lines', {
      path: 'lines.md',
      startLine: 8,
      endLine: 9,
      newText: 'bad',
    }),
  ).rejects.toMatchObject({ code: 'invalid_range' });
});
it('lists dirty/active tabs, saves the requested buffer, and refuses accidental discard', async () => {
  const path = join(root, 'draft.md');
  await fs.writeFile(path, 'saved');
  models.set(path, fakeModel('edited'));
  dirty.add(path);
  tabActions.activeFile = path;
  expect(await tools.execute('get_open_tabs', {})).toMatchObject({
    tabs: [{ path, active: true, unsaved: true }],
  });
  await expect(tools.execute('close_tab', { path })).rejects.toMatchObject({
    code: 'unsaved_changes',
  });
  expect(models.has(path)).toBe(true);
  await tools.execute('save_file', {});
  expect(await fs.readFile(path, 'utf8')).toBe('edited');
  dirty.add(path);
  const args = { path, discard: true };
  await tools.preparePreview('close_tab', args);
  models.get(path)!.setValue('new edit');
  await expect(tools.execute('close_tab', args)).rejects.toMatchObject({
    code: 'stale_plan',
  });
  await tools.execute('close_tab', { path, discard: true });
  expect(models.has(path)).toBe(false);
  expect(tabActions.closeTab).toHaveBeenLastCalledWith(path, true);
});
it('creates each built-in template safely and returns Unicode-aware counts', async () => {
  for (const template of ['readme', 'blog-post', 'meeting-notes']) {
    await tools.execute('create_from_template', {
      path: `nested/${template}.md`,
      template,
      variables: { title: 'Hello world', description: 'A description' },
    });
    expect(
      await fs.readFile(join(root, `nested/${template}.md`), 'utf8'),
    ).toContain('# Hello world');
  }
  await expect(
    tools.execute('create_from_template', {
      path: 'nested/readme.md',
      template: 'readme',
    }),
  ).rejects.toMatchObject({ code: 'destination_exists' });
  await expect(
    tools.execute('create_from_template', {
      path: 'bad.md',
      template: 'unknown',
    }),
  ).rejects.toMatchObject({ code: 'unknown_template' });
  await fs.writeFile(join(root, 'count.md'), 'Hello 🌍\nworld');
  expect(await tools.execute('word_count', { path: 'count.md' })).toMatchObject(
    { words: 3, characters: 13, lines: 2, readingMinutes: 1 },
  );
});
it('applies the workspace boundary even when the original read tool targets an open buffer', async () => {
  models.set(join(root, '../outside.md'), fakeModel('secret'));
  for (const name of [
    'read_file',
    'write_file',
    'edit_file',
    'open_tab',
    'create_file',
    'create_folder',
  ]) {
    const args =
      name === 'write_file' || name === 'create_file'
        ? { path: '../outside.md', content: 'x' }
        : name === 'edit_file'
          ? { path: '../outside.md', oldText: 'a', newText: 'b' }
          : { path: '../outside.md' };
    await expect(tools.execute(name, args)).rejects.toMatchObject({
      code: 'outside_workspace',
    });
  }
});
it('reads settings and validates all changes against supported keys and values', async () => {
  expect(await tools.execute('get_settings', {})).toMatchObject({
    editor: { wordwrap: true },
    export: { withStyles: true },
  });
  await tools.execute('set_setting', { key: 'wordwrap', value: false });
  expect(settingsActions.updateSetting).toHaveBeenLastCalledWith(
    'wordwrap',
    false,
  );
  for (const [key, value] of [
    ['wordwrap', 'false'],
    ['apiKey', 'secret'],
    ['__proto__', {}],
    ['locale', 'xx'],
    ['fileExplorer', { extensions: ['exe'] }],
    ['pasteImages', { directory: '../outside' }],
  ])
    await expect(
      tools.execute('set_setting', { key, value }),
    ).rejects.toThrow();
  expect(settingsActions.updateSetting).toHaveBeenCalledTimes(1);
});
it('exports the selected open buffer through the existing HTML pipeline and native save result', async () => {
  const path = join(root, 'export.md');
  await fs.writeFile(path, '# Saved');
  models.set(path, fakeModel('# Unsaved document'));
  tabActions.activeFile = path;
  const save = jest
    .spyOn(AppStorage, 'saveFile')
    .mockResolvedValue({ ok: true, path: join(root, 'export.html') });
  const args = { withStyles: false };
  await tools.preparePreview('export_html', args);
  tabActions.activeFile = join(root, 'other.md');
  await fs.writeFile(tabActions.activeFile, '# Another tab');
  expect(await tools.execute('export_html', args)).toMatchObject({
    operation: 'export_html',
    source: path,
    path: join(root, 'export.html'),
  });
  expect(save.mock.calls[0][1].data).toContain('Unsaved document');
  expect(save.mock.calls[0][1].data).not.toContain('<style');
  save.mockResolvedValueOnce({ ok: false, cancelled: true });
  await expect(tools.execute('export_html', { path })).rejects.toMatchObject({
    code: 'cancelled',
  });
});

it('expands full edit previews and refuses copying buffers dirtied after preview', async () => {
  const path = join(root, 'large.md'),
    content = 'long document '.repeat(500);
  await fs.writeFile(path, content);
  const args = { path, content: ' appended' };
  const preview = await tools.preparePreview('append_to_file', args);
  expect(preview?.after).toContain('…[truncated]');
  expect(
    await tools.getFullPreviewContent('append_to_file', args, 'after'),
  ).toBe(content + ' appended');
  const copy = { source: 'large.md', destination: 'copy.md' };
  await tools.preparePreview('copy_path', copy);
  models.set(path, fakeModel('unsaved'));
  dirty.add(path);
  await expect(tools.execute('copy_path', copy)).rejects.toMatchObject({
    code: 'unsaved_changes',
  });
  expect(await native.info('copy.md')).toMatchObject({ exists: false });
});
