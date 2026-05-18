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
import { screen, fireEvent } from '@testing-library/react';

import { ChatPane } from '../../src/browser/react/components/assistant/ChatPane';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
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

  it('typing + clicking Send fires startCall with the trimmed text', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: '  hi there  ' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(am.startCall).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      'hi there',
    );
    // Input clears after send.
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('Enter (without Shift) sends; Shift+Enter does not send', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(am.startCall).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(am.startCall).toHaveBeenCalledWith(
      'anthropic',
      'conv-1',
      'message',
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
  it('opens the popover on gear click and exposes the auto-accept switch', () => {
    const { conv, snapshot } = snapshotWith({ messages: [] });
    const am = fakeAssistantManager({ initialChatSnapshot: snapshot });
    renderWithProviders(<ChatPane provider="anthropic" conversation={conv} />, {
      managers: { assistantManager: am as never },
    });
    // Popover closed → switch isn't in the DOM yet.
    expect(screen.queryByTestId('chat-auto-accept')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-options'));
    expect(screen.getByTestId('chat-auto-accept')).toBeInTheDocument();
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
