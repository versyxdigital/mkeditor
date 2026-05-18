/**
 * ConversationList (AI Assistant P4) unit tests.
 *
 * Asserts the click → activate, double-click → rename, trash-click →
 * delete (with confirm) flows. Manager methods are mocked via
 * `fakeAssistantManager` and assertions check the right manager
 * method was called with the right (provider, conversationId) args.
 */

import * as React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { ConversationList } from '../../src/browser/react/components/assistant/ConversationList';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';
import { registerPromptOpener } from '../../src/browser/react/contexts/PromptsContext';

afterEach(() => {
  // Reset the module-level prompt opener so per-test mocks don't leak.
  registerPromptOpener(async () => ({ button: null }));
});

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

type Conv = {
  id: string;
  providerId: 'anthropic' | 'openai' | 'ollama';
  title: string;
  model: string;
  messages: never[];
  autoAcceptWrites: boolean;
  createdAt: number;
  updatedAt: number;
};

function conv(id: string, title: string): Conv {
  return {
    id,
    providerId: 'anthropic',
    title,
    model: 'claude-sonnet-4-6',
    messages: [],
    autoAcceptWrites: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('<ConversationList>', () => {
  it('renders the empty-state message when there are no conversations', () => {
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList provider="anthropic" conversations={[]} activeId={null} />,
      { managers: { assistantManager: am as never } },
    );
    expect(
      screen.getByText('assistant-chat:no_conversations'),
    ).toBeInTheDocument();
  });

  it('renders one row per conversation; clicking activates via setActiveConversation', () => {
    const a = conv('c-1', 'First chat');
    const b = conv('c-2', 'Second chat');
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList
        provider="anthropic"
        conversations={[a, b]}
        activeId="c-1"
      />,
      { managers: { assistantManager: am as never } },
    );
    expect(screen.getByText('First chat')).toBeInTheDocument();
    expect(screen.getByText('Second chat')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Second chat'));
    expect(am.setActiveConversation).toHaveBeenCalledWith('anthropic', 'c-2');
  });

  it('"New chat" button fires createConversation', () => {
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList provider="anthropic" conversations={[]} activeId={null} />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.click(screen.getByTestId('conversation-new'));
    expect(am.createConversation).toHaveBeenCalledWith('anthropic');
  });

  it('double-click swaps the row into a rename input; Enter commits via renameConversation', () => {
    const a = conv('c-1', 'Original');
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList
        provider="anthropic"
        conversations={[a]}
        activeId="c-1"
      />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.doubleClick(screen.getByText('Original'));
    const input = screen.getByLabelText(
      'assistant-chat:rename_aria',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed!' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(am.renameConversation).toHaveBeenCalledWith(
      'anthropic',
      'c-1',
      'Renamed!',
    );
  });

  it('Escape during rename cancels without firing renameConversation', () => {
    const a = conv('c-1', 'Original');
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList
        provider="anthropic"
        conversations={[a]}
        activeId="c-1"
      />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.doubleClick(screen.getByText('Original'));
    const input = screen.getByLabelText(
      'assistant-chat:rename_aria',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'never' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(am.renameConversation).not.toHaveBeenCalled();
  });

  it('trash icon → confirm dialog → deleteConversation when user confirms', async () => {
    // Register a fake prompt opener that auto-confirms.
    registerPromptOpener(async () => ({ button: 'confirm' }));
    const a = conv('c-1', 'Doomed');
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList
        provider="anthropic"
        conversations={[a]}
        activeId="c-1"
      />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.click(screen.getByTestId('conversation-delete-c-1'));
    await waitFor(() => {
      expect(am.deleteConversation).toHaveBeenCalledWith('anthropic', 'c-1');
    });
  });

  it('trash icon → confirm dialog → no deletion when user cancels', async () => {
    registerPromptOpener(async () => ({ button: 'cancel' }));
    const a = conv('c-1', 'Spared');
    const am = fakeAssistantManager();
    renderWithProviders(
      <ConversationList
        provider="anthropic"
        conversations={[a]}
        activeId="c-1"
      />,
      { managers: { assistantManager: am as never } },
    );
    fireEvent.click(screen.getByTestId('conversation-delete-c-1'));
    // Give the microtask queue a tick.
    await Promise.resolve();
    expect(am.deleteConversation).not.toHaveBeenCalled();
  });
});
