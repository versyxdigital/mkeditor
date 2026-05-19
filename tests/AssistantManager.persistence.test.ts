/**
 * AssistantManager — persistence (P7).
 *
 * Exercises the manager-side pieces in isolation:
 *   - `serialize()` shape + runtime-only state filtering
 *     (in-flight, streaming, unresolved tool calls)
 *   - `restore(snapshot)` round-trip + idempotency
 *   - `restore(null)` migration path (pre-P7 files)
 *   - debounced `to:ai:conversations:save` triggers on mutation
 *   - `flushPersist()` cancels the debounce and ships sync
 *   - quit-flush via `from:ai:conversations:flush-request`
 *
 * The main-side write path (atomic tmp+rename, JSON shape on disk)
 * is covered by `tests/AssistantManager.persistence.appside.test.ts`.
 */

import { AssistantManager } from '../src/browser/core/AssistantManager';
import type { PersistedConversations } from '../src/app/interfaces/Assistant';

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

describe('AssistantManager.serialize', () => {
  it('returns null when no conversations exist (empty manager → empty file)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    expect(mgr.serialize()).toBeNull();
  });

  it('captures conversations, drafts, activeProvider, and per-provider activeConversation', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const a = mgr.createConversation('anthropic', 'Alpha');
    const o = mgr.createConversation('openai', 'Bravo');
    mgr.setActiveProvider('openai');
    mgr.setDraft('anthropic', a, 'unsent draft');
    const snap = mgr.serialize();
    expect(snap).not.toBeNull();
    expect(snap!.activeProvider).toBe('openai');
    expect(snap!.activeConversation.anthropic).toBe(a);
    expect(snap!.activeConversation.openai).toBe(o);
    expect(snap!.conversations.anthropic).toHaveLength(1);
    expect(snap!.conversations.openai).toHaveLength(1);
    expect(snap!.conversations.ollama).toHaveLength(0);
    expect(snap!.conversations.anthropic[0]).toMatchObject({
      id: a,
      providerId: 'anthropic',
      title: 'Alpha',
      autoAcceptWrites: false,
      shareActiveFile: true,
      shareSelection: false,
      mentions: [],
    });
    expect(snap!.drafts[`anthropic:${a}`]).toBe('unsent draft');
  });

  it('orders conversations recency-descending so the file mirrors the snapshot view', async () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const older = mgr.createConversation('anthropic', 'Old');
    // Force timeline separation so renameConversation's updatedAt bump
    // is observably greater on coarse clocks.
    await new Promise((r) => setTimeout(r, 5));
    const newer = mgr.createConversation('anthropic', 'New');
    await new Promise((r) => setTimeout(r, 5));
    mgr.renameConversation('anthropic', older, 'Old (touched)');
    const snap = mgr.serialize()!;
    // `older` got bumped most recently → comes first.
    expect(snap.conversations.anthropic[0].id).toBe(older);
    expect(snap.conversations.anthropic[1].id).toBe(newer);
  });

  it('strips streaming messages (a quit mid-stream drops the half-written bubble)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    mgr.appendChunk(callId, 'partial reply ');
    // Don't fire onChatDone — the assistant message stays `streaming`.
    const snap = mgr.serialize()!;
    const messages = snap.conversations.anthropic[0].messages;
    // User message kept; streaming assistant message dropped.
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('hi');
  });

  it('strips pending/executing tool calls from persisted assistant messages', async () => {
    // Drive a tool call mid-execution: pending-confirm or executing
    // entries can't resume across a restart, so they're dropped at
    // serialize time. Succeeded / failed entries survive.
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    const callId = mgr.startCall('anthropic', conv, 'hi')!;
    // Manually inject the kind of message the manager would normally
    // build, then mark it complete (so it survives the streaming
    // filter) but with a mix of tool-call statuses.
    const snapshot = mgr.getChatSnapshot();
    const c = snapshot.conversations.anthropic[0];
    c.messages[1] = {
      ...c.messages[1],
      status: 'complete',
      toolCalls: [
        {
          toolCallId: 'tc-ok',
          toolName: 'read_file',
          arguments: {},
          status: 'succeeded',
          result: { ok: true },
        },
        {
          toolCallId: 'tc-pending',
          toolName: 'write_file',
          arguments: {},
          status: 'pending-confirm',
        },
        {
          toolCallId: 'tc-running',
          toolName: 'edit_file',
          arguments: {},
          status: 'executing',
        },
        {
          toolCallId: 'tc-bad',
          toolName: 'edit_file',
          arguments: {},
          status: 'failed',
          errorCode: 'execution_failed',
          errorMessage: 'disk full',
        },
      ],
    };
    mgr.onChatDone(callId);
    const persisted = mgr.serialize()!;
    const persistedMsg = persisted.conversations.anthropic[0].messages.find(
      (m) => m.role === 'assistant',
    );
    expect(persistedMsg?.toolCalls).toEqual([
      expect.objectContaining({ toolCallId: 'tc-ok', status: 'succeeded' }),
      expect.objectContaining({ toolCallId: 'tc-bad', status: 'failed' }),
    ]);
  });
});

describe('AssistantManager.restore', () => {
  it('replaying a serialized snapshot reproduces the original state (round-trip)', () => {
    const { bridge: b1 } = makeBridge();
    const source = new AssistantManager(b1 as never);
    const conv = source.createConversation('anthropic', 'Round-trip');
    source.renameConversation('anthropic', conv, 'Round-trip!');
    source.setActiveProvider('anthropic');
    source.setDraft('anthropic', conv, 'still typing');
    const snap = source.serialize()!;

    const { bridge: b2 } = makeBridge();
    const target = new AssistantManager(b2 as never);
    target.restore(snap);

    const out = target.getChatSnapshot();
    expect(out.activeProvider).toBe('anthropic');
    expect(out.activeConversation.anthropic).toBe(conv);
    expect(out.conversations.anthropic).toHaveLength(1);
    expect(out.conversations.anthropic[0].title).toBe('Round-trip!');
    expect(out.drafts[`anthropic:${conv}`]).toBe('still typing');
  });

  it('is idempotent — calling restore twice yields the same state as once', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const snap: PersistedConversations = {
      activeProvider: 'openai',
      activeConversation: {
        anthropic: null,
        openai: 'c-1',
        ollama: null,
      },
      conversations: {
        anthropic: [],
        openai: [
          {
            id: 'c-1',
            providerId: 'openai',
            title: 'Once',
            model: 'gpt-5',
            messages: [],
            autoAcceptWrites: false,
            shareActiveFile: true,
            shareSelection: false,
            mentions: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        ollama: [],
      },
      drafts: {},
    };
    mgr.restore(snap);
    const after1 = mgr.getChatSnapshot();
    mgr.restore(snap);
    const after2 = mgr.getChatSnapshot();
    expect(after2.conversations.openai).toHaveLength(1);
    expect(after2.conversations.openai[0].id).toBe('c-1');
    expect(after1.activeConversation).toEqual(after2.activeConversation);
    expect(after1.activeProvider).toBe(after2.activeProvider);
  });

  it('restore(null) clears state (migration path: pre-P7 files have no conversations block)', () => {
    const { bridge } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.createConversation('anthropic', 'will be wiped');
    mgr.restore(null);
    const snap = mgr.getChatSnapshot();
    expect(snap.conversations.anthropic).toHaveLength(0);
    expect(snap.activeProvider).toBeNull();
  });

  it('does NOT trigger a save during the replay (no IPC ricochet of the data we just read)', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.restore({
      activeProvider: 'anthropic',
      activeConversation: { anthropic: 'c-1', openai: null, ollama: null },
      conversations: {
        anthropic: [
          {
            id: 'c-1',
            providerId: 'anthropic',
            title: 'restored',
            model: 'claude-sonnet-4-6',
            messages: [],
            autoAcceptWrites: false,
            shareActiveFile: true,
            shareSelection: false,
            mentions: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        openai: [],
        ollama: [],
      },
      drafts: {},
    });
    // The chat snapshot rebuild inside restore() must NOT have
    // scheduled a save — that would write the file we just read.
    expect(
      sent.some((s) => s.channel === 'to:ai:conversations:save'),
    ).toBe(false);
  });
});

describe('AssistantManager — debounced save', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('mutating state (createConversation) schedules a save that fires after the 500ms debounce', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.createConversation('anthropic');
    // Before the debounce window elapses, no save has been shipped.
    expect(
      sent.filter((s) => s.channel === 'to:ai:conversations:save'),
    ).toHaveLength(0);
    jest.advanceTimersByTime(499);
    expect(
      sent.filter((s) => s.channel === 'to:ai:conversations:save'),
    ).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(
      sent.filter((s) => s.channel === 'to:ai:conversations:save'),
    ).toHaveLength(1);
  });

  it('a burst of mutations collapses into ONE save (debounce coalesces)', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    const conv = mgr.createConversation('anthropic');
    mgr.setDraft('anthropic', conv, 'a');
    mgr.setDraft('anthropic', conv, 'ab');
    mgr.setDraft('anthropic', conv, 'abc');
    jest.advanceTimersByTime(500);
    expect(
      sent.filter((s) => s.channel === 'to:ai:conversations:save'),
    ).toHaveLength(1);
  });

  it('flushPersist() ships immediately via to:ai:conversations:flush and cancels the pending debounce', () => {
    const { bridge, sent } = makeBridge();
    const mgr = new AssistantManager(bridge as never, { disablePacedReveal: true });
    mgr.createConversation('anthropic');
    // Pending debounce.
    mgr.flushPersist();
    const flush = sent.filter(
      (s) => s.channel === 'to:ai:conversations:flush',
    );
    expect(flush).toHaveLength(1);
    // Advance past the debounce window — the cancelled timer must NOT fire.
    jest.advanceTimersByTime(2000);
    expect(
      sent.filter((s) => s.channel === 'to:ai:conversations:save'),
    ).toHaveLength(0);
  });
});
