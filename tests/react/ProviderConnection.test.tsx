import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../utils/render';
import {
  connectedAssistant,
  connectedSnapshot,
} from '../fixtures/connectedAssistant';
import { ProviderTab } from '../../src/browser/react/components/assistant/ProviderTab';
import type {
  ConfigPushPayload,
  ProviderId,
} from '../../src/app/interfaces/Assistant';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,

  normalizeLanguage: (lng: string) => lng,

  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));
jest.mock('../../src/browser/core/Markdown', () => ({
  renderAssistantMarkdown: (s: string) => `<p>${s}</p>`,
  Markdown: { render: (s: string) => `<p>${s}</p>` },
}));
jest.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,

  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,

  Separator: () => <div />,
}));

function snapshot(
  provider: 'openai' | 'anthropic',
  hasKey = false,
): ConfigPushPayload {
  return {
    ...connectedSnapshot,
    config: {
      ...connectedSnapshot.config,
      [provider]: { ...connectedSnapshot.config[provider], hasKey },
    },
    chatgpt: {
      mode: 'api-key',
      connected: false,
      signingIn: false,
      welcome: false,
      accounts: [],
      models: [],
    },
  };
}

function setup(
  provider: 'openai' | 'anthropic',
  config = snapshot(provider),
  withHistory = false,
) {
  const conv = {
    id: 'history',
    providerId: provider,
    title: 'Saved conversation',
    model: 'model',
    messages: [
      {
        id: 'message',
        role: 'user' as const,
        content: 'Earlier message',
        status: 'complete' as const,
        createdAt: 1,
      },
    ],
    autoAcceptWrites: false,
    shareActiveFile: false,
    shareSelection: false,
    mentions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const conversations = {
    anthropic: [],
    openai: [],
    ollama: [],
    [provider]: withHistory ? [conv] : [],
  };
  const activeConversation: Record<ProviderId, string | null> = {
    anthropic: null,
    openai: null,
    ollama: null,
    [provider]: withHistory ? conv.id : null,
  };
  const manager = connectedAssistant({
    initialSnapshot: config,
    initialChatSnapshot: {
      conversations,
      activeConversation,
      inflight: {},
      drafts: {},
    },
  });
  manager.getDraft.mockReturnValue('Unsent draft');
  renderWithProviders(<ProviderTab provider={provider} />, {
    managers: { assistantManager: manager as never, mode: 'desktop' },
  });
  return manager;
}
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

test('OpenAI offers ChatGPT sign-in and inline API-key entry before the first conversation', async () => {
  const manager = setup('openai');
  expect(screen.queryByTestId('conversation-new-empty')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'chatgpt:continue' }));
  expect(manager.chatGptCommand).toHaveBeenCalledWith({
    action: 'sign-in',
    accountId: undefined,
  });
  const input = screen.getByLabelText('assistant-connect:api_option');
  expect(input).toHaveAttribute('type', 'password');
  fireEvent.change(input, { target: { value: 'private-key' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'assistant-connect:save' }),
  );
  await waitFor(() =>
    expect(manager.connectWithApiKey).toHaveBeenCalledWith(
      'openai',
      'private-key',
    ),
  );
  expect(input).toHaveValue('');
});

test('Anthropic offers API-key setup without a subscription sign-in option', () => {
  setup('anthropic');
  expect(screen.getByTestId('provider-connect-anthropic')).toBeInTheDocument();
  expect(
    screen.getByLabelText('assistant-connect:api_option'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'chatgpt:continue' })).toBeNull();
});

test('a failed API-key write keeps onboarding visible and reports failure', async () => {
  const manager = setup('anthropic');
  manager.connectWithApiKey.mockResolvedValue(false);
  fireEvent.change(screen.getByLabelText('assistant-connect:api_option'), {
    target: { value: 'private-key' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'assistant-connect:save' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'assistant-connect:save_failed',
  );
  expect(manager.createConversation).not.toHaveBeenCalled();
});

test.each(['openai', 'anthropic'] as const)(
  'losing the %s key preserves readable history and draft, then restores the composer on reconnect',
  (provider) => {
    const manager = setup(provider, snapshot(provider, true), true);
    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: 'Keep this draft' },
    });
    act(() => manager._setSnapshot(snapshot(provider)));
    expect(screen.getByText('Earlier message')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(screen.getByTestId('conversation-new')).toBeDisabled();
    expect(
      screen.getByTestId(`provider-connect-${provider}`),
    ).toBeInTheDocument();
    act(() => manager._setSnapshot(snapshot(provider, true)));
    expect(screen.getByTestId('chat-input')).toHaveValue('Keep this draft');
    expect(screen.getByText('Earlier message')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-new')).toBeEnabled();
  },
);

test('a signed-out plan offers a saved API key only as an explicit choice', () => {
  const config = snapshot('openai', true);
  config.chatgpt!.mode = 'chatgpt';
  const manager = setup('openai', config);
  expect(screen.queryByTestId('conversation-new-empty')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'assistant-connect:use_saved_key' }),
  );
  expect(manager.chatGptCommand).toHaveBeenCalledWith({
    action: 'mode',
    mode: 'api-key',
  });
  expect(manager.startCall).not.toHaveBeenCalled();
});

test('an already connected ChatGPT account can be selected explicitly when the API key is missing', () => {
  const config = snapshot('openai');
  config.chatgpt!.connected = true;
  config.chatgpt!.planEnabled = true;
  const manager = setup('openai', config);
  fireEvent.click(
    screen.getByRole('button', { name: 'assistant-connect:use_plan' }),
  );
  expect(manager.chatGptCommand).toHaveBeenCalledWith({
    action: 'mode',
    mode: 'chatgpt',
  });
});

test('completing inline ChatGPT sign-in shows its confirmation without opening settings', () => {
  const initial = snapshot('openai');
  initial.chatgpt!.mode = 'chatgpt';
  const manager = setup('openai', initial);
  const connected = snapshot('openai');
  connected.chatgpt = {
    ...initial.chatgpt!,
    connected: true,
    planEnabled: true,
    welcome: true,
  };
  act(() => manager._setSnapshot(connected));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'chatgpt:got_it' })).toHaveFocus();
});

test('losing credentials during context gathering neither sends the message nor clears the draft', async () => {
  const manager = setup('anthropic', snapshot('anthropic', true), true);
  let finish!: (value: null) => void;
  manager.contextFor.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByTestId('chat-send'));
  act(() => manager._setSnapshot(snapshot('anthropic')));
  await act(async () => {
    finish(null);
  });
  expect(manager.startCall).not.toHaveBeenCalled();
  act(() => manager._setSnapshot(snapshot('anthropic', true)));
  expect(screen.getByTestId('chat-input')).toHaveValue('Unsent draft');
});
