/**
 * FileTreeManager — narrow unit tests.
 *
 * Most of the manager's behaviour is covered indirectly through
 * BridgeListeners + React FileTreePanel tests. This file pins
 * specific contract points that were the source of recent bugs:
 *
 *   - `buildFileTree` recovers when main sends a listing for a
 *     subdirectory that the renderer doesn't know about yet (e.g.
 *     after the AI assistant's `create_file` makes a brand-new
 *     subfolder under the workspace root). The fix walks up to the
 *     nearest known ancestor and asks main to repopulate it.
 *   - `addFileToTree` does the same recovery when a `from:file:opened`
 *     event names a file inside a subdirectory the tree hasn't
 *     loaded.
 */

import { FileTreeManager } from '../src/browser/core/FileTreeManager';

type SentMessage = { channel: string; data: unknown };

function makeBridge() {
  const sent: SentMessage[] = [];
  const bridge = {
    send: jest.fn((channel: string, data: unknown) => {
      sent.push({ channel, data });
    }),
    receive: jest.fn(),
  };
  return { bridge, sent };
}

describe('FileTreeManager.buildFileTree — missing-ancestor recovery (regression)', () => {
  it('requests a refresh of the workspace root when the listing targets a brand-new subdirectory under the root', () => {
    // Reproduces the AI assistant smoke: workspace is rooted at
    // `/workspace/poems`; the agent calls `create_file` for
    // `/workspace/poems/poems/spring.md`, so main writes the file
    // and sends `from:folder:opened` for `/workspace/poems/poems`.
    // That parent doesn't exist in the renderer's tree yet, so
    // without the fix the listing is silently dropped and the new
    // subfolder never appears in the explorer.
    const { bridge, sent } = makeBridge();
    const ftm = new FileTreeManager(bridge as never, () => {});
    // Root populate — empty workspace.
    ftm.buildFileTree([], '/workspace/poems');
    // Now main reports the listing for the new subfolder.
    ftm.buildFileTree(
      [
        {
          type: 'file',
          name: 'spring.md',
          path: '/workspace/poems/poems/spring.md',
        },
      ],
      '/workspace/poems/poems',
    );
    // The manager should have requested a refresh of the root via
    // `to:file:openpath` so the missing subfolder appears on the
    // returned listing.
    expect(sent).toContainEqual({
      channel: 'to:file:openpath',
      data: { path: '/workspace/poems' },
    });
  });

  it('targets the deepest known ancestor (not the root) when one exists below the root', () => {
    // Deeper case: user has expanded `/workspace/a/b`, agent creates
    // `/workspace/a/b/c/d/file.md`. The refresh should target
    // `/workspace/a/b` so it picks up the new `c` subfolder —
    // refreshing the root would needlessly blow away unrelated
    // expansion state.
    //
    // The directory index is populated as each `buildFileTree` call
    // lands (top-level nodes only per call). We mirror real usage:
    // root populate ships `a` as a lazy directory, then the user
    // expands `a` (lazy-load → `buildFileTree('/workspace/a')`
    // ships `b`), then expands `b` similarly. After those calls
    // both `a` and `b` are in the index.
    const { bridge, sent } = makeBridge();
    const ftm = new FileTreeManager(bridge as never, () => {});
    ftm.buildFileTree(
      [
        {
          type: 'directory',
          name: 'a',
          path: '/workspace/a',
          hasChildren: true,
          loaded: false,
        },
      ],
      '/workspace',
    );
    ftm.buildFileTree(
      [
        {
          type: 'directory',
          name: 'b',
          path: '/workspace/a/b',
          hasChildren: true,
          loaded: false,
        },
      ],
      '/workspace/a',
    );
    ftm.buildFileTree([], '/workspace/a/b'); // user expanded `b`, found empty
    // Reset sent so we only assert on the upcoming deep update.
    sent.length = 0;
    // Now a deeply nested update arrives.
    ftm.buildFileTree(
      [{ type: 'file', name: 'file.md', path: '/workspace/a/b/c/d/file.md' }],
      '/workspace/a/b/c/d',
    );
    // Refresh should target `/workspace/a/b` — the nearest known
    // ancestor — not the root.
    expect(sent).toContainEqual({
      channel: 'to:file:openpath',
      data: { path: '/workspace/a/b' },
    });
  });

  it('does nothing when the missing path is outside the workspace root', () => {
    const { bridge, sent } = makeBridge();
    const ftm = new FileTreeManager(bridge as never, () => {});
    ftm.buildFileTree([], '/workspace');
    ftm.buildFileTree(
      [{ type: 'file', name: 'stray.md', path: '/elsewhere/stray.md' }],
      '/elsewhere',
    );
    expect(sent).toEqual([]);
  });
});

describe('FileTreeManager.addFileToTree — missing-ancestor recovery', () => {
  it('requests a refresh of the nearest known ancestor when a file lands inside an unloaded subdirectory', () => {
    // `from:file:opened` for a file inside a not-yet-loaded subdir
    // used to bail silently (`if (!dir) return`). Now it walks up
    // and asks main to populate the missing chain.
    const { bridge, sent } = makeBridge();
    const ftm = new FileTreeManager(bridge as never, () => {});
    ftm.buildFileTree([], '/workspace/poems');
    ftm.addFileToTree('/workspace/poems/poems/spring.md');
    expect(sent).toContainEqual({
      channel: 'to:file:openpath',
      data: { path: '/workspace/poems' },
    });
  });

  it('ignores paths outside the workspace root', () => {
    const { bridge, sent } = makeBridge();
    const ftm = new FileTreeManager(bridge as never, () => {});
    ftm.buildFileTree([], '/workspace');
    ftm.addFileToTree('/elsewhere/random.md');
    expect(sent).toEqual([]);
  });
});
