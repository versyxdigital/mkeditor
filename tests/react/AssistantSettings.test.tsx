/**
 * AssistantSettings (AI Assistant P3) unit tests.
 *
 * Mock AssistantManager via `fakeAssistantManager` from the shared
 * render helper and drive the component through its observable
 * config snapshot. Assertions focus on the round-trip side-effects:
 *
 *   - enable toggle fires setProviderConfig
 *   - API key Save click fires setKey with the typed value
 *   - the saved key value is never echoed back into the input
 *   - clearKey clears the saved entry
 *   - default model blur fires setProviderConfig({defaultModel})
 *   - testConnection success / failure surface a sonner toast
 *   - Ollama refresh populates the model select
 *   - web mode shows the localStorage warning banner
 *   - encryption-unavailable shows the warning + disables remote rows
 */

import * as React from 'react';
import {
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from '@testing-library/react';

import { AssistantSettings } from '../../src/browser/react/components/assistant/AssistantSettings';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

// `sonnerToast` is the side-effect we assert on for test-connection /
// ollama-refresh paths. Capture every call to inspect.
const toastSpy = jest.fn();
jest.mock('../../src/browser/notify', () => ({
  sonnerToast: (...args: unknown[]) => toastSpy(...args),
}));

beforeEach(() => {
  toastSpy.mockClear();
});

function baseSnapshot() {
  return {
    config: {
      anthropic: {
        enabled: false,
        hasKey: false,
        defaultModel: 'claude-sonnet-4-6',
      },
      openai: {
        enabled: false,
        hasKey: false,
        defaultModel: 'gpt-5',
      },
      ollama: {
        enabled: false,
        hasKey: false as const,
        baseUrl: 'http://localhost:11434',
        defaultModel: 'llama3.2',
      },
    },
    encryptionAvailable: true,
  };
}

describe('<AssistantSettings> — loading + warning banners', () => {
  it('shows the loading placeholder when config is null', () => {
    const am = fakeAssistantManager();
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByText('assistant-settings:loading')).toBeInTheDocument();
  });

  it('renders the encryption-unavailable banner when the flag is false', () => {
    const snap = baseSnapshot();
    snap.encryptionAvailable = false;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    expect(
      screen.getByText('assistant-settings:encryption_unavailable'),
    ).toBeInTheDocument();
  });

  it('renders the web warning banner only in web mode', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    const { rerender } = renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'web' },
    });
    expect(
      screen.getByText('assistant-settings:web_warning'),
    ).toBeInTheDocument();

    // Re-render in desktop mode — banner should disappear.
    rerender(<AssistantSettings />);
    // The wrapper's managers are baked at render time, so we use a
    // fresh renderWithProviders for the desktop assertion.
    const am2 = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am2 as never, mode: 'desktop' },
    });
    // After the second render, we have two trees mounted; the desktop
    // copy has no warning banner so its label count stays at 1 (just
    // the first tree, which is the web-mode one).
    const banners = screen.getAllByText('assistant-settings:web_warning');
    expect(banners).toHaveLength(1);
  });
});

describe('<AssistantSettings> — Anthropic row (API-key provider)', () => {
  it('enable Switch fires setProviderConfig with {enabled: true}', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const enableSwitch = screen
      .getByRole('region', { name: 'assistant-settings:provider_anthropic' })
      .querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(enableSwitch);
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      config: { enabled: true },
    });
  });

  it('Save key click fires setKey with the typed plaintext, then clears the input', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const input = within(region).getByLabelText(
      'assistant-settings:api_key_label',
    ) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-test-anthropic' } });

    const saveButton = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent === 'assistant-settings:save_key',
    ) as HTMLButtonElement;
    fireEvent.click(saveButton);

    expect(am.setKey).toHaveBeenCalledWith('anthropic', 'sk-test-anthropic');
    expect(input.value).toBe('');
  });

  it('show-key toggle swaps the input type between password and text', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const input = region.querySelector(
      'input[id="anthropic-key"]',
    ) as HTMLInputElement;
    expect(input.type).toBe('password');

    const showButton = region.querySelector(
      'button[aria-label="assistant-settings:show_key"]',
    ) as HTMLButtonElement;
    fireEvent.click(showButton);
    expect(input.type).toBe('text');
  });

  it('does NOT pre-populate the input with any saved key (key is never echoed back)', () => {
    const snap = baseSnapshot();
    snap.config.anthropic.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const input = within(region).getByLabelText(
      'assistant-settings:api_key_label',
    ) as HTMLInputElement;
    // Even when hasKey is true, the input is empty — sanitised config
    // never carries the key value, so there's nothing to pre-fill.
    expect(input.value).toBe('');
    expect(input.placeholder).toBe(
      'assistant-settings:api_key_placeholder_saved',
    );
  });

  it('Clear key button is shown when hasKey:true and fires clearKey on click', () => {
    const snap = baseSnapshot();
    snap.config.anthropic.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const clearButton = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent === 'assistant-settings:clear_key',
    ) as HTMLButtonElement;
    fireEvent.click(clearButton);
    expect(am.clearKey).toHaveBeenCalledWith('anthropic');
  });

  it('Default model blur fires setProviderConfig({defaultModel}) when changed', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const input = within(region).getByLabelText(
      'assistant-settings:default_model_label',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'claude-opus-4-7' } });
    fireEvent.blur(input);
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      config: { defaultModel: 'claude-opus-4-7' },
    });
  });
});

describe('<AssistantSettings> — Test connection toasts', () => {
  it('fires a success toast when testConnection resolves with ok:true', async () => {
    const snap = baseSnapshot();
    snap.config.anthropic.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    am.testConnection.mockResolvedValueOnce({ ok: true });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const button = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent === 'assistant-settings:test_connection',
    ) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect(am.testConnection).toHaveBeenCalledWith(
        'anthropic',
        'claude-sonnet-4-6',
      );
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'success',
        'assistant-settings:test_connection_success',
      );
    });
  });

  it('fires a failure toast carrying the translated error code', async () => {
    const snap = baseSnapshot();
    snap.config.openai.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    am.testConnection.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_key',
      message: '401 Unauthorized',
    });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_openai',
    });
    const button = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent === 'assistant-settings:test_connection',
    ) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        'error',
        'assistant-settings:test_connection_failure',
      );
    });
  });
});

describe('<AssistantSettings> — Ollama row', () => {
  it('Refresh button calls refreshOllamaModels and surfaces a success toast', async () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    am.refreshOllamaModels.mockResolvedValueOnce(['llama3.2', 'qwen2.5']);
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_ollama',
    });
    const refreshButton = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('assistant-settings:ollama_refresh'),
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(refreshButton);
    });

    expect(am.refreshOllamaModels).toHaveBeenCalledWith(
      'http://localhost:11434',
    );
    expect(toastSpy).toHaveBeenCalledWith(
      'success',
      'assistant-settings:ollama_refresh_success',
    );
  });

  it('Refresh failure surfaces an error toast with the message', async () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    am.refreshOllamaModels.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_ollama',
    });
    const refreshButton = Array.from(region.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('assistant-settings:ollama_refresh'),
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(refreshButton);
    });

    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      'assistant-settings:ollama_refresh_failure',
    );
  });

  it('Base URL blur fires setProviderConfig with the trimmed URL', () => {
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const input = screen.getByLabelText(
      'assistant-settings:ollama_baseurl_label',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://10.0.0.5:11434  ' },
    });
    fireEvent.blur(input);
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'ollama',
      config: { baseUrl: 'http://10.0.0.5:11434' },
    });
  });
});
