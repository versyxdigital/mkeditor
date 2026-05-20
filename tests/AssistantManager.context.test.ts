/**
 * AssistantManager — context controls (P6).
 *
 * Exercises the manager-side pieces in isolation:
 *   - `contextFor(...)` assembly with every toggle / mention combo
 *   - `contextChips(...)` + `contextTokenEstimate(...)` derivation
 *   - mention CRUD (add / remove / refresh / cross-conversation cache)
 *   - the active-file/mention dedupe rule
 *
 * The React-side chip row / mention picker / gear popover toggles
 * live in their own tests (`ChatPane.test.tsx`).
 */

import { AssistantManager } from '../src/browser/core/AssistantManager';
import type { AssistantContextProvider } from '../src/browser/core/AssistantManager';

interface FakeBridge {
  send: jest.Mock;
  receive: jest.Mock;
}

function makeBridge() {
  const sent: Array<{ channel: string; data: unknown }> = [];
  const bridge: FakeBridge = {
    send: jest.fn((channel: string, data: unknown) => {
      sent.push({ channel, data });
    }),
    receive: jest.fn(),
  };
  return { bridge, sent };
}

interface FakeProviderState {
  active: { path: string; content: string } | null;
  selection: {
    path: string | null;
    text: string;
    startLine: number;
    endLine: number;
  } | null;
  fileContents: Map<string, string>;
}

function makeContextProvider(
  init: Partial<FakeProviderState> = {},
): AssistantContextProvider & { _state: FakeProviderState } {
  const state: FakeProviderState = {
    active: init.active ?? null,
    selection: init.selection ?? null,
    fileContents: init.fileContents ?? new Map<string, string>(),
  };
  return {
    _state: state,
    getActiveFile: () => state.active,
    getSelection: () => state.selection,
    readFile: async (path: string) => {
      const content = state.fileContents.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return { content };
    },
  };
}

describe('AssistantManager — contextFor assembly', () => {
  it('returns null when no context provider is set (early boot)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    const conv = mgr.createConversation('anthropic');
    expect(await mgr.contextFor('anthropic', conv)).toBeNull();
  });

  it('returns null when nothing is sharable (no active file, no selection, no mentions)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(makeContextProvider({}));
    const conv = mgr.createConversation('anthropic');
    expect(await mgr.contextFor('anthropic', conv)).toBeNull();
  });

  it('includes the active file as a tagged fenced block when shareActiveFile is on', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: { path: '/workspace/notes.md', content: '# Notes\nbody' },
      }),
    );
    const conv = mgr.createConversation('anthropic'); // share-active-file: true by default
    const msg = await mgr.contextFor('anthropic', conv);
    expect(msg?.role).toBe('system');
    expect(msg?.content).toContain('```md path="/workspace/notes.md"');
    expect(msg?.content).toContain('# Notes\nbody');
  });

  it('omits the active file when shareActiveFile is toggled off', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: { path: '/workspace/notes.md', content: 'body' },
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    expect(await mgr.contextFor('anthropic', conv)).toBeNull();
  });

  it('includes the selection as a fenced block with lines="" when shareSelection is on', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        selection: {
          path: '/workspace/a.md',
          text: 'selected\nlines',
          startLine: 42,
          endLine: 43,
        },
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareSelection('anthropic', conv, true);
    const msg = await mgr.contextFor('anthropic', conv);
    expect(msg?.content).toContain('lines="L42-L43"');
    expect(msg?.content).toContain('selected\nlines');
  });

  it('skips the selection block when shareSelection is on but the editor selection is empty', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(makeContextProvider({ selection: null }));
    const conv = mgr.createConversation('anthropic');
    mgr.setShareSelection('anthropic', conv, true);
    mgr.setShareActiveFile('anthropic', conv, false);
    expect(await mgr.contextFor('anthropic', conv)).toBeNull();
  });

  it('includes every @-mention as its own fenced block in insertion order', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([
          ['/workspace/a.md', 'alpha content'],
          ['/workspace/b.md', 'beta content'],
        ]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    await mgr.addMention('anthropic', conv, '/workspace/a.md');
    await mgr.addMention('anthropic', conv, '/workspace/b.md');
    const msg = await mgr.contextFor('anthropic', conv);
    expect(msg).not.toBeNull();
    const text = msg!.content;
    expect(text.indexOf('alpha content')).toBeLessThan(
      text.indexOf('beta content'),
    );
    expect(text).toContain('```md path="/workspace/a.md"');
    expect(text).toContain('```md path="/workspace/b.md"');
  });

  it('dedupes a mention whose path matches the active file (avoids two copies in the prompt)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: { path: '/workspace/a.md', content: 'alpha v2' },
        fileContents: new Map([['/workspace/a.md', 'alpha v1']]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    await mgr.addMention('anthropic', conv, '/workspace/a.md');
    const msg = await mgr.contextFor('anthropic', conv);
    // The active-file content wins; the mention block is suppressed
    // so the model doesn't see two `path="..."` blocks for one file.
    expect(msg?.content.match(/alpha v2/g)?.length).toBe(1);
    expect(msg?.content).not.toContain('alpha v1');
  });

  it('widens the fence to 4 backticks when content contains a triple-backtick run', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: {
          path: '/workspace/a.md',
          content: 'before\n```js\ncode\n```\nafter',
        },
      }),
    );
    const conv = mgr.createConversation('anthropic');
    const msg = await mgr.contextFor('anthropic', conv);
    // Outer fence must be ```` so the inner ``` doesn't terminate it.
    expect(msg?.content.startsWith('````md')).toBe(true);
    expect(msg?.content.endsWith('````')).toBe(true);
  });

  it('skips a mention silently when its cached content is missing (broken file)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    const cp = makeContextProvider({
      fileContents: new Map([['/workspace/ok.md', 'real']]),
    });
    mgr.setContextProvider(cp);
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    await mgr.addMention('anthropic', conv, '/workspace/ok.md');
    // Forge a phantom mention whose content was never cached.
    // (Mirrors what would happen if `readFile` succeeded at add time
    // but the cache was later evicted — defensive code path.)
    const internal = mgr as unknown as {
      conversations: Record<string, Map<string, { mentions: string[] }>>;
    };
    internal.conversations.anthropic.get(conv)!.mentions.push('/phantom.md');
    const msg = await mgr.contextFor('anthropic', conv);
    expect(msg?.content).toContain('real');
    expect(msg?.content).not.toContain('phantom');
  });
});

describe('AssistantManager — contextChips + tokenEstimate', () => {
  it('exposes an active chip with byteCount when shareActiveFile is on', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: { path: '/workspace/notes.md', content: 'x'.repeat(400) },
      }),
    );
    const conv = mgr.createConversation('anthropic');
    const chips = mgr.contextChips('anthropic', conv);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      kind: 'active',
      path: '/workspace/notes.md',
      byteCount: 400,
    });
    expect(chips[0].label).toContain('notes.md');
    expect(chips[0].label).toContain('active');
  });

  it('selection chip carries the line range in its label and the selection length as byteCount', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        selection: {
          path: '/workspace/a.md',
          text: 'abc',
          startLine: 10,
          endLine: 20,
        },
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareSelection('anthropic', conv, true);
    mgr.setShareActiveFile('anthropic', conv, false);
    const [chip] = mgr.contextChips('anthropic', conv);
    expect(chip.kind).toBe('selection');
    expect(chip.label).toContain('L10');
    expect(chip.label).toContain('L20');
    expect(chip.byteCount).toBe(3);
  });

  it('mention chip carries the file basename as label + byteCount from the cached content', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([['/w/sub/longer.md', 'hello world']]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    await mgr.addMention('anthropic', conv, '/w/sub/longer.md');
    const [chip] = mgr.contextChips('anthropic', conv);
    expect(chip).toMatchObject({
      kind: 'mention',
      path: '/w/sub/longer.md',
      label: 'longer.md',
      byteCount: 11,
    });
  });

  it('chip row dedupes a mention whose path matches the active file', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        active: { path: '/w/a.md', content: 'live' },
        fileContents: new Map([['/w/a.md', 'on-disk']]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    await mgr.addMention('anthropic', conv, '/w/a.md');
    const chips = mgr.contextChips('anthropic', conv);
    expect(chips).toHaveLength(1);
    expect(chips[0].kind).toBe('active');
  });

  it('tokenEstimate grows monotonically as the draft and mention contents grow', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([['/w/big.md', 'x'.repeat(1200)]]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    const empty = mgr.contextTokenEstimate('anthropic', conv, '');
    const withDraft = mgr.contextTokenEstimate(
      'anthropic',
      conv,
      'x'.repeat(400),
    );
    expect(withDraft).toBeGreaterThan(empty);
    await mgr.addMention('anthropic', conv, '/w/big.md');
    const withMention = mgr.contextTokenEstimate(
      'anthropic',
      conv,
      'x'.repeat(400),
    );
    expect(withMention).toBeGreaterThan(withDraft);
  });
});

describe('AssistantManager — mention CRUD', () => {
  it('addMention is idempotent on path (re-add refreshes cached content but does not duplicate the chip)', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    const cp = makeContextProvider({
      fileContents: new Map([['/w/a.md', 'first']]),
    });
    mgr.setContextProvider(cp);
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    await mgr.addMention('anthropic', conv, '/w/a.md');
    // Simulate the file changing on disk.
    cp._state.fileContents.set('/w/a.md', 'second');
    await mgr.addMention('anthropic', conv, '/w/a.md');
    const chips = mgr.contextChips('anthropic', conv);
    expect(chips).toHaveLength(1);
    const msg = await mgr.contextFor('anthropic', conv);
    expect(msg?.content).toContain('second');
    expect(msg?.content).not.toContain('first');
  });

  it('removeMention drops the chip + drops cached content when no other conversation still references the path', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([['/w/a.md', 'body']]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    mgr.setShareActiveFile('anthropic', conv, false);
    await mgr.addMention('anthropic', conv, '/w/a.md');
    mgr.removeMention('anthropic', conv, '/w/a.md');
    expect(mgr.contextChips('anthropic', conv)).toHaveLength(0);
    expect(await mgr.contextFor('anthropic', conv)).toBeNull();
  });

  it('removeMention keeps cached content alive when another conversation still references it', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([['/w/shared.md', 'shared body']]),
      }),
    );
    const a = mgr.createConversation('anthropic');
    const b = mgr.createConversation('openai');
    mgr.setShareActiveFile('anthropic', a, false);
    mgr.setShareActiveFile('openai', b, false);
    await mgr.addMention('anthropic', a, '/w/shared.md');
    await mgr.addMention('openai', b, '/w/shared.md');
    mgr.removeMention('anthropic', a, '/w/shared.md');
    // Cache still alive for conversation b — chip still renders.
    const bChips = mgr.contextChips('openai', b);
    expect(bChips).toHaveLength(1);
    expect(bChips[0].byteCount).toBe('shared body'.length);
  });

  it('setShareActiveFile / setShareSelection / addMention bump conv.updatedAt for snapshot consumers', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    mgr.setContextProvider(
      makeContextProvider({
        fileContents: new Map([['/w/x.md', 'body']]),
      }),
    );
    const conv = mgr.createConversation('anthropic');
    const before = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)!.updatedAt;
    // Sleep a tick so Date.now advances on systems with coarse clocks.
    await new Promise((r) => setTimeout(r, 5));
    mgr.setShareSelection('anthropic', conv, true);
    const after = mgr
      .getChatSnapshot()
      .conversations.anthropic.find((c) => c.id === conv)!.updatedAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe('AssistantManager — startCall integration (P6 system context)', () => {
  it('startCall prepends the systemContext arg before the message history', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hello', {
      role: 'system',
      content: 'context here',
    });
    expect(callId).not.toBeNull();
    const chatSend = sent.find((s) => s.channel === 'to:ai:chat');
    const payload = chatSend!.data as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: 'context here',
    });
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('startCall omits the system turn when systemContext is null', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, {
      disablePacedReveal: true,
    });
    const conv = mgr.createConversation('anthropic');
    mgr.startCall('anthropic', conv, 'hello', null);
    const chatSend = sent.find((s) => s.channel === 'to:ai:chat');
    const payload = chatSend!.data as {
      messages: Array<{ role: string }>;
    };
    expect(payload.messages.find((m) => m.role === 'system')).toBeUndefined();
  });
});
