/**
 * ProviderTab (AI Assistant P4) unit tests.
 *
 * Two paths to cover:
 *   - no conversations yet → empty-state CTA renders, click creates one
 *   - at least one conversation → the split-panel layout (ConversationList
 *     + ChatPane) renders
 *
 * `react-resizable-panels` v4 expects a `react-resizable-panels-root`
 * ancestor to read viewport sizes; we mock the layout primitives so
 * jsdom doesn't need to lay out a real Group. The mock keeps DOM
 * semantics (children are rendered) without any layout math.
 */

import * as React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

// Avoid pulling in the Markdown chunk (used by ChatMessage inside the
// split-panel render path) since these tests aren't about markdown.
jest.mock('../../src/browser/core/Markdown', () => ({
  renderAssistantMarkdown: (s: string) => `<p>${s}</p>`,
  Markdown: { render: (s: string) => `<p>${s}</p>` },
}));

// react-resizable-panels v4 needs a Group ancestor with real layout to
// compute sizes; jsdom can't satisfy that. Pass-through stubs render
// children so the rest of the tree is testable.
jest.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rrp-group">{children}</div>
  ),
  Panel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rrp-panel">{children}</div>
  ),
  Separator: () => <div data-testid="rrp-separator" />,
}));

import { ProviderTab } from '../../src/browser/react/components/assistant/ProviderTab';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';

function snapshotWith(
  provider: 'anthropic' | 'openai' | 'ollama',
  count: number,
) {
  const conversations = Array.from({ length: count }, (_, i) => ({
    id: `c-${i}`,
    providerId: provider,
    title: `Conversation ${i}`,
    model: 'claude-sonnet-4-6',
    messages: [],
    autoAcceptWrites: false,
    createdAt: Date.now() - 1000 * i,
    updatedAt: Date.now() - 1000 * i,
  }));
  return {
    conversations: {
      anthropic: provider === 'anthropic' ? conversations : [],
      openai: provider === 'openai' ? conversations : [],
      ollama: provider === 'ollama' ? conversations : [],
    },
    activeConversation: {
      anthropic: provider === 'anthropic' && count > 0 ? 'c-0' : null,
      openai: provider === 'openai' && count > 0 ? 'c-0' : null,
      ollama: provider === 'ollama' && count > 0 ? 'c-0' : null,
    },
    drafts: {},
    inflight: {},
  };
}

describe('<ProviderTab> — empty state', () => {
  it('renders the empty-state CTA when the provider has no conversations', () => {
    const am = fakeAssistantManager({
      initialChatSnapshot: snapshotWith('anthropic', 0),
    });
    renderWithProviders(<ProviderTab provider="anthropic" />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByTestId('conversation-new-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('rrp-group')).toBeNull();
  });

  it('clicking the empty-state Start button calls createConversation', () => {
    const am = fakeAssistantManager({
      initialChatSnapshot: snapshotWith('anthropic', 0),
    });
    renderWithProviders(<ProviderTab provider="anthropic" />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByTestId('conversation-new-empty'));
    expect(am.createConversation).toHaveBeenCalledWith('anthropic');
  });
});

describe('<ProviderTab> — split-panel render', () => {
  it('renders the resizable split (ConversationList + ChatPane) when at least one conversation exists', () => {
    const am = fakeAssistantManager({
      initialChatSnapshot: snapshotWith('openai', 2),
    });
    renderWithProviders(<ProviderTab provider="openai" />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByTestId('rrp-group')).toBeInTheDocument();
    const list = screen.getByTestId('conversation-list');
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId('chat-pane')).toBeInTheDocument();
    // Both conversation rows render in the list. (The active
    // conversation's title also appears in the ChatPane header, so
    // we scope this assertion to the list to avoid the duplicate.)
    expect(within(list).getByText('Conversation 0')).toBeInTheDocument();
    expect(within(list).getByText('Conversation 1')).toBeInTheDocument();
  });

  it('falls back to a "select a conversation" hint when the active conversation is missing', () => {
    // Snapshot says active=c-0 but the conversation array is empty —
    // not strictly reachable in production (the manager keeps the
    // active pointer consistent), but covers the defensive branch.
    const am = fakeAssistantManager({
      initialChatSnapshot: {
        ...snapshotWith('anthropic', 1),
        activeConversation: {
          anthropic: 'c-missing',
          openai: null,
          ollama: null,
        },
      },
    });
    renderWithProviders(<ProviderTab provider="anthropic" />, {
      managers: { assistantManager: am as never },
    });
    expect(
      screen.getByText('assistant-chat:select_conversation'),
    ).toBeInTheDocument();
  });
});
