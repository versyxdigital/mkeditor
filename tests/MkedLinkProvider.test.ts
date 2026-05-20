/**
 * MkedLinkProvider tests.
 *
 * Covers the two behaviours that distinguish this provider from a plain
 * markdown link scanner:
 *   1. The base directory for resolving relative paths comes from the
 *      injected `getActiveFilePath` getter, which is sourced from the
 *      renderer's `FileManager.activeFile` (not from a main-process
 *      cache that lags tab switches). Switching tabs must reroute
 *      link resolution to the new tab's directory.
 *   2. Links are emitted for every relative `.md` path the doc
 *      mentions — there is no longer a "must be in the loaded file
 *      tree" gate. The old gate broke links to files in unexpanded
 *      folders and to recently-opened files.
 */

import type { languages, editor } from 'monaco-editor';

// --- monaco-editor mock ------------------------------------------

interface LinkProvider {
  provideLinks: (m: editor.ITextModel) => Promise<languages.ILinksList>;
  resolveLink?: (link: languages.ILink) => Promise<languages.ILink | null>;
}

const registeredProviders: LinkProvider[] = [];

jest.mock('monaco-editor', () => ({
  editor: {},
  languages: {
    registerLinkProvider: jest.fn(
      (_language: string, provider: LinkProvider) => {
        registeredProviders.push(provider);
        return { dispose: jest.fn() };
      },
    ),
  },
}));

// --- window.mked stub --------------------------------------------

const openMkedUrl = jest.fn();
const pathDirname = jest.fn(async (p: string) => {
  // Lightweight POSIX-only dirname for tests.
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
});
const resolvePath = jest.fn(async (base: string, rel: string) => {
  if (rel.startsWith('/')) return rel;
  return `${base.replace(/\/$/, '')}/${rel.replace(/^\.\//, '')}`;
});

beforeAll(() => {
  (window as unknown as { mked: unknown }).mked = {
    openMkedUrl,
    pathDirname,
    resolvePath,
    // Intentionally unused by the new provider — left here to assert
    // the regression: if anyone re-introduces the IPC path, the test
    // will surface it via this mock.
    getActiveFilePath: jest.fn(() => {
      throw new Error(
        'MkedLinkProvider must source the active file from the renderer ' +
          '(injected getter), not from mked.getActiveFilePath()',
      );
    }),
  };
});

beforeEach(() => {
  registeredProviders.length = 0;
  openMkedUrl.mockClear();
  pathDirname.mockClear();
  resolvePath.mockClear();
});

// --- Helpers -----------------------------------------------------

function makeModel(value: string): editor.ITextModel {
  // Minimal jsdom-friendly stand-in. provideLinks only reads
  // `getValue()` and computes offsets via `getPositionAt`.
  return {
    getValue: () => value,
    getPositionAt: (offset: number) => {
      // Walk newlines to derive 1-based line/column from the offset.
      let line = 1;
      let col = 1;
      for (let i = 0; i < offset && i < value.length; i++) {
        if (value[i] === '\n') {
          line += 1;
          col = 1;
        } else {
          col += 1;
        }
      }
      return { lineNumber: line, column: col };
    },
  } as unknown as editor.ITextModel;
}

async function loadProvider() {
  // Imported lazily so the monaco mock is in place before module init.
  const { MkedLinkProvider } =
    await import('../src/browser/core/providers/MkedLinkProvider');
  return MkedLinkProvider;
}

// --- Tests -------------------------------------------------------

describe('MkedLinkProvider', () => {
  it('emits a link for every relative .md mention, ignoring tree state', async () => {
    const MkedLinkProvider = await loadProvider();
    new MkedLinkProvider({} as never, () => '/notes/index.md');
    const provider = registeredProviders[0];

    const model = makeModel(
      'See [A](./a.md) and [B](sub/b.md). External [ext](https://x.com/c.md) and [anchor](#frag) and [non-md](./d.txt).',
    );
    const result = await provider.provideLinks(model);
    expect(result.links).toHaveLength(2);
    expect(result.links[0].tooltip).toBe('Open ./a.md');
    expect(result.links[1].tooltip).toBe('Open sub/b.md');
    // Resolution uses /notes (dirname of /notes/index.md) as the base.
    expect(resolvePath).toHaveBeenCalledWith('/notes', './a.md');
    expect(resolvePath).toHaveBeenCalledWith('/notes', 'sub/b.md');
  });

  it('re-resolves against the new base when the active tab changes', async () => {
    const MkedLinkProvider = await loadProvider();
    let activePath: string = '/notes/index.md';
    new MkedLinkProvider({} as never, () => activePath);
    const provider = registeredProviders[0];

    const model = makeModel('[A](./a.md)');

    // First call: active is /notes/index.md → base /notes.
    await provider.provideLinks(model);
    expect(resolvePath).toHaveBeenLastCalledWith('/notes', './a.md');

    // Simulate the user switching tabs in the renderer.
    activePath = '/projects/x/main.md';
    await provider.provideLinks(model);
    // The provider must follow the getter, not cache the boot value.
    expect(resolvePath).toHaveBeenLastCalledWith('/projects/x', './a.md');
  });

  it('emits no links when the active tab is untitled', async () => {
    const MkedLinkProvider = await loadProvider();
    new MkedLinkProvider({} as never, () => 'untitled-1');
    const provider = registeredProviders[0];

    const model = makeModel('[A](./a.md)');
    const result = await provider.provideLinks(model);
    expect(result.links).toHaveLength(0);
    // Resolution must never run for untitled — there's no usable base dir.
    expect(resolvePath).not.toHaveBeenCalledWith(expect.anything(), './a.md');
  });

  it('emits no links when there is no active file', async () => {
    const MkedLinkProvider = await loadProvider();
    new MkedLinkProvider({} as never, () => null);
    const provider = registeredProviders[0];

    const model = makeModel('[A](./a.md)');
    const result = await provider.provideLinks(model);
    expect(result.links).toHaveLength(0);
  });

  it('resolveLink routes through mked://open with the stashed absolute path', async () => {
    const MkedLinkProvider = await loadProvider();
    new MkedLinkProvider({} as never, () => '/notes/index.md');
    const provider = registeredProviders[0];

    const result = await provider.provideLinks(makeModel('[A](./a.md)'));
    const ret = await provider.resolveLink!(result.links[0]);
    // Returning null tells Monaco we handled the navigation.
    expect(ret).toBeNull();
    expect(openMkedUrl).toHaveBeenCalledWith(
      'mked://open?path=' + encodeURIComponent('/notes/a.md'),
    );
  });
});
