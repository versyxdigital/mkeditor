/**
 * ChatPane (AI Assistant P4) unit tests.
 *
 * Drives `<ChatPane>` against a fakeAssistantManager whose chat
 * snapshot is seeded with a single conversation. Asserts the
 * input → startCall round-trip, the send/stop button toggle, the
 * Enter/Shift+Enter keyboard behaviour, the model-input blur, and
 * the draft mount/unmount sync.
 */

import * as React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { ChatPane } from '../../src/browser/react/components/assistant/ChatPane';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

// `renderAssistantMarkdown` reaches into the Markdown singleton which
// pulls in highlight.js + plugins. Mock it for these tests so we don't
// have to load the whole chunk; ChatMessage tests cover the real path.
jest.mock('../../src/browser/core/Markdown', () => ({
  renderAssistantMarkdown: (s: string) => `<p>${s}</p>`,
  Markdown: { render: (s: string) => `<p>${s}</p>` },
}));

function snapshotWith(opts: {
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'streaming' | 'complete' | 'cancelled' | 'failed';
    createdAt?: number;
  }>;
  inflightCallId?: string;
}) {
  const conv = {
    id: 'conv-1',
    providerId: 'anthropic' as const,
    title: 'Test chat',
    model: 'claude-sonnet-4-6',
    messages: (opts.messages ?? []).map((m) => ({
      ...m,
      createdAt: m.createdAt ?? Date.now(),
    })),
    autoAcceptWrites: false,
    shareActiveFile: true,
    shareSelection: false,
    mentions: [] as string[],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const inflight: Record<string, unknown> = {};
  if (opts.inflightCallId) {
    inflight[opts.inflightCallId] = {
      callId: opts.inflightCallId,
      provider: 'anthropic',
      conversationId: 'conv-1',
      assistantMessageId: 'msg-asst',
      startedAt: Date.now(),
    };
  }
  return {
    conv,
    snapshot: {
      conversations: {
        anthropic: [conv],
        openai: [],
        ollama: [],
      },
      activeConversation: {
        anthropic: 'conv-1',
        openai: null,
        ollama: null,
      },
      drafts: {},
      inflight,
    },
  };
}

describe('<ChatPane> — input + send', () => {
  it('renders messages from the conversation', () => {
    const { conv, snapshot } = snapshotWith({
      messages: [
        { id: 'm1', role: 'user', content: 'hello', status: 'complete' },
        { id: 'm2', role: 'assistant', content: 'world', status: 'complete' },
      ],
    });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('Send button is disabled when the input is empty', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByTestId('chat-send')).toBeDisabled();
  });

  it('typing + clicking Send fires startCall with the trimmed text (after contextFor resolves)', async () => {
    // P6: handleSend is now async — it awaits manager.contextFor(...)
    // before firing startCall, so we have to flush microtasks before
    // asserting. The fake manager's contextFor resolves null (no
    // workspace context) by default, so the system message arg is null.
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: '  hi there  ' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    // Input clears synchronously (we capture text up-front before the
    // await) so this assertion can stay sync.
    expect((input as HTMLTextAreaElement).value).toBe('');
    await waitFor(() =>
      expect(am.startCall).toHaveBeenCalledWith(
        'anthropic',
        'conv-1',
        'hi there',
        null,
      ),
    );
  });

  it('Enter (without Shift) sends; Shift+Enter does not send', async () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // Shift+Enter doesn't fire startCall — assert sync.
    expect(am.startCall).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() =>
      expect(am.startCall).toHaveBeenCalledWith(
        'anthropic',
        'conv-1',
        'message',
        null,
      ),
    );
  });
});

describe('<ChatPane> — send/stop toggle', () => {
  it('shows Stop button (not Send) when this conversation has an in-flight call', () => {
    const { conv, snapshot } = snapshotWith({
      inflightCallId: 'chat-x',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', status: 'complete' },
        { id: 'm2', role: 'assistant', content: 'partial', status: 'streaming' },
      ],
    });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.queryByTestId('chat-send')).toBeNull();
    expect(screen.getByTestId('chat-stop')).toBeInTheDocument();
  });

  it('clicking Stop fires cancelCall with the in-flight callId', () => {
    const { conv, snapshot } = snapshotWith({
      inflightCallId: 'chat-x',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', status: 'complete' },
        { id: 'm2', role: 'assistant', content: 'partial', status: 'streaming' },
      ],
    });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('chat-stop'));
    expect(am.cancelCall).toHaveBeenCalledWith('chat-x');
  });
});

describe('<ChatPane> — model editor', () => {
  it('blur on the model input fires setConversationModel with the typed value', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    const modelInput = screen.getByLabelText(
      'assistant-chat:model_aria',
    ) as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'claude-opus-4-7' } });
    fireEvent.blur(modelInput);
    expect(am.setConversationModel).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      'claude-opus-4-7',
    );
  });
});

describe('<ChatPane> — gear popover (auto-accept writes)', () => {
  it('opens the popover on gear click and exposes the auto-accept + P6 share switches', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    // Popover closed → switches aren't in the DOM yet.
    expect(screen.queryByTestId('chat-auto-accept')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-options'));
    expect(screen.getByTestId('chat-auto-accept')).toBeInTheDocument();
    expect(screen.getByTestId('chat-share-active-file')).toBeInTheDocument();
    expect(screen.getByTestId('chat-share-selection')).toBeInTheDocument();
  });

  it('toggling share-active-file fires manager.setShareActiveFile (P6)', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    conv.shareActiveFile = true;
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('chat-options'));
    fireEvent.click(screen.getByTestId('chat-share-active-file'));
    expect(am.setShareActiveFile).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      false,
    );
  });

  it('toggling share-selection fires manager.setShareSelection (P6)', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    conv.shareSelection = false;
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('chat-options'));
    fireEvent.click(screen.getByTestId('chat-share-selection'));
    expect(am.setShareSelection).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      true,
    );
  });

  it('toggling the auto-accept switch fires setAutoAcceptWrites with the new value', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('chat-options'));
    fireEvent.click(screen.getByTestId('chat-auto-accept'));
    expect(am.setAutoAcceptWrites).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      true,
    );
  });

  it('switch reflects conv.autoAcceptWrites on open', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    // Mutate the snapshot conversation in place — the fake manager
    // returns the same object reference from getChatSnapshot.
    conv.autoAcceptWrites = true;
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('chat-options'));
    const sw = screen.getByTestId('chat-auto-accept');
    // Radix Switch surfaces state via aria-checked + data-state.
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('<ChatPane> — P6 context chips + token estimate', () => {
  it('renders chips from manager.contextChips and routes × clicks to the right setter', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    am.contextChips.mockReturnValue([
      { kind: 'active', path: '/w/a.md', label: 'a.md (active)' },
      { kind: 'mention', path: '/w/b.md', label: 'b.md' },
    ]);
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    // Active chip click → flips share-active-file off.
    fireEvent.click(
      screen.getByTestId('context-chip-active').querySelector('button')!,
    );
    expect(am.setShareActiveFile).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      false,
    );
    // Mention chip click → removeMention with the path.
    fireEvent.click(
      screen.getByTestId('context-chip-mention').querySelector('button')!,
    );
    expect(am.removeMention).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      '/w/b.md',
    );
  });

  it('shows the token-estimate row using manager.contextTokenEstimate output', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    am.contextTokenEstimate.mockReturnValue(1234);
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByTestId('context-token-estimate').textContent).toContain(
      '1,234',
    );
  });

  it('typing `@` opens the MentionPicker; picking a result calls addMention, strips the @ token, and closes the picker', async () => {
    // Integration test for the @-mention wiring in ChatPane — the
    // MentionPicker is unit-tested in isolation, but ChatPane is
    // where the token detection, picker visibility, and post-pick
    // input scrubbing all live.
    const treeSnapshot = {
      treeRoot: '/w',
      nodes: [{ type: 'file', name: 'notes.md', path: '/w/notes.md' }],
    };
    const fileTreeManager = {
      // Stable snapshot reference — useSyncExternalStore infinite-
      // loops if `getSnapshot` returns a fresh object every call.
      getSnapshot: jest.fn(() => treeSnapshot),
      on: jest.fn(() => () => {}),
      requestDirectoryContents: jest.fn(),
      treeRoot: '/w',
    };
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: {
        assistantManager: am as never,
        fileTreeManager: fileTreeManager as never,
      },
    });
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    // Type `summarise @no` → picker opens, ranks notes.md.
    fireEvent.change(input, { target: { value: 'summarise @no' } });
    expect(screen.getByTestId('mention-picker')).toBeInTheDocument();
    // Click the option.
    fireEvent.click(screen.getByTestId('mention-option-/w/notes.md'));
    expect(am.addMention).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      '/w/notes.md',
    );
    // The `@no` token gets stripped from the draft, leaving the
    // rest of the prompt intact.
    expect(input.value).toBe('summarise ');
    // Picker should close after pick.
    expect(screen.queryByTestId('mention-picker')).toBeNull();
  });

  it('Enter while the picker is open does NOT also fire send (picker owns Enter)', async () => {
    const treeSnapshot = {
      treeRoot: '/w',
      nodes: [{ type: 'file', name: 'a.md', path: '/w/a.md' }],
    };
    const fileTreeManager = {
      // Stable snapshot reference (see prior test).
      getSnapshot: jest.fn(() => treeSnapshot),
      on: jest.fn(() => () => {}),
      requestDirectoryContents: jest.fn(),
      treeRoot: '/w',
    };
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: {
        assistantManager: am as never,
        fileTreeManager: fileTreeManager as never,
      },
    });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: '@a' } });
    expect(screen.getByTestId('mention-picker')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    // Picker handles the Enter; startCall should NOT have been
    // fired from ChatPane's onKeyDown (the picker's window-level
    // handler picks the first option).
    expect(am.startCall).not.toHaveBeenCalled();
  });

  it('handleSend awaits manager.contextFor and ships its result as the systemContext arg of startCall', async () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    am.contextFor.mockResolvedValueOnce({
      role: 'system' as const,
      content: 'system context payload',
    });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(am.startCall).toHaveBeenCalledWith('anthropic', 'conv-1', 'hello', {
        role: 'system',
        content: 'system context payload',
      }),
    );
    expect(am.contextFor).toHaveBeenCalledWith('anthropic', 'conv-1');
  });
});

describe('<ChatPane> — draft sync', () => {
  it('seeds the input from manager.getDraft on mount', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    am.getDraft.mockReturnValueOnce('previous unsent draft');
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    expect((screen.getByTestId('chat-input') as HTMLTextAreaElement).value).toBe(
      'previous unsent draft',
    );
  });

  it('pushes the current input back via setDraft on unmount', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    const { unmount } = renderWithProviders(
      <ChatPane provider="anthropic" conversation={conv} />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'in-progress thought' },
    });
    unmount();
    expect(am.setDraft).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      'in-progress thought',
    );
  });
});
