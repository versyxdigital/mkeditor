import * as React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';
import { AssistantSettings } from '../../src/browser/react/components/assistant/AssistantSettings';
import type { ConfigPushPayload } from '../../src/app/interfaces/Assistant';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,

  normalizeLanguage: (lng: string) => lng,

  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

function snapshot(): ConfigPushPayload {
  return {
    encryptionAvailable: true,
    config: {
      anthropic: {
        enabled: false,
        hasKey: false,
        defaultModel: 'claude-sonnet-4-6',
      },
      openai: { enabled: true, hasKey: true, defaultModel: 'plan-model' },
      ollama: {
        enabled: false,
        hasKey: false,
        baseUrl: 'http://localhost:11434',
        defaultModel: '',
      },
    },
    chatgpt: {
      mode: 'chatgpt',
      connected: true,
      signingIn: false,
      welcome: false,
      activeId: 'one',
      accounts: [{ id: 'one', label: 'writer@example.com (1)' }],
      models: [{ id: 'plan-model', label: 'My plan model' }],
    },
  };
}

function renderSettings(initial = snapshot()) {
  const manager = fakeAssistantManager({ initialSnapshot: initial });
  renderWithProviders(<AssistantSettings />, {
    managers: { assistantManager: manager as never, mode: 'desktop' },
  });
  return manager;
}
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

test('offers browser sign-in and hides the API key input while using the ChatGPT plan', () => {
  const manager = renderSettings();
  expect(document.getElementById('openai-key')).toBeNull();
  expect(screen.getByText('My plan model')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'chatgpt:continue' }));
  expect(manager.chatGptCommand).toHaveBeenCalledWith({
    action: 'sign-in',
    accountId: 'one',
  });
  expect(manager.setKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'chatgpt:manage_usage' }));
  expect(manager.chatGptCommand).toHaveBeenCalledWith({ action: 'usage' });
});

test('a pending browser sign-in can be cancelled without changing accounts', () => {
  const initial = snapshot();
  initial.chatgpt!.signingIn = true;
  const manager = renderSettings(initial);
  expect(
    screen.getByRole('button', { name: 'chatgpt:continue' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'chatgpt:cancel' }));
  expect(manager.chatGptCommand).toHaveBeenCalledWith({ action: 'cancel' });
});

test('explains plan usage on first sign-in and acknowledges it through the manager', () => {
  const initial = snapshot();
  initial.chatgpt!.welcome = true;
  const manager = renderSettings(initial);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('chatgpt:description')).toBeInTheDocument();
  expect(
    within(dialog).getByRole('button', { name: 'chatgpt:got_it' }),
  ).toHaveFocus();
  expect(
    within(dialog).getByText('writer@example.com (1)'),
  ).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'chatgpt:manage_usage' }),
  );
  expect(manager.chatGptCommand).toHaveBeenCalledWith({ action: 'usage' });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'chatgpt:got_it' }),
  );
  expect(manager.chatGptCommand).toHaveBeenCalledWith({ action: 'welcome' });
});

test('encryption failure disables browser sign-in', () => {
  const initial = snapshot();
  initial.encryptionAvailable = false;
  renderSettings(initial);
  expect(
    screen.getByRole('button', { name: 'chatgpt:continue' }),
  ).toBeDisabled();
});

test('switching back to API-key mode restores its controls', () => {
  const initial = snapshot();
  initial.chatgpt!.mode = 'api-key';
  renderSettings(initial);
  expect(document.getElementById('openai-key')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'chatgpt:continue' })).toBeNull();
});

test('signed-out settings hide accounts, usage and model controls while retaining the reconnect action', () => {
  const initial = snapshot();
  initial.chatgpt!.connected = false;
  initial.chatgpt!.accounts = [];
  initial.chatgpt!.models = [];
  const manager = renderSettings(initial);
  expect(document.getElementById('chatgpt-account')).toBeNull();
  expect(screen.queryByText('writer@example.com (1)')).toBeNull();
  expect(screen.queryByText('chatgpt:using_plan')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'chatgpt:manage_usage' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'chatgpt:add_account' }),
  ).toBeNull();
  expect(document.getElementById('openai-model')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'chatgpt:continue' }));
  expect(manager.chatGptCommand).toHaveBeenCalledWith({
    action: 'sign-in',
    accountId: 'one',
  });
});
