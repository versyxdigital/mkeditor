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
 *   - readable model selection saves API IDs; custom IDs remain available
 *   - supported thinking levels round-trip through setProviderConfig
 *   - testConnection success / failure surface a sonner toast
 *   - Ollama refresh populates the model select
 *   - web mode shows the localStorage warning banner
 *   - encryption-unavailable shows the warning + disables remote rows
 */

import * as React from 'react';
import userEvent from '@testing-library/user-event';
import {
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from '@testing-library/react';

import { AssistantSettings } from '../../src/browser/react/components/assistant/AssistantSettings';
import { SettingsProvider } from '../../src/browser/core/providers/SettingsProvider';
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
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
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
  it('saves the automatic file-opening preference from its labelled switch', () => {
    const settings = new SettingsProvider('desktop', {
      updateOptions: jest.fn(),
    } as never);
    const persist = jest.fn();
    settings.setPersistHandler(persist);
    renderWithProviders(<AssistantSettings />, {
      managers: {
        assistantManager: fakeAssistantManager({
          initialSnapshot: baseSnapshot(),
        }) as never,
        mode: 'desktop',
        providers: {
          settings,
          commands: null,
          completion: null,
          exportSettings: null,
          bridge: null,
        },
      },
    });
    const toggle = screen.getByRole('switch', {
      name: 'assistant-settings:auto_open_files_label',
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(settings.getSnapshot().assistantAutoOpenFiles).toBe(false);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ assistantAutoOpenFiles: false }),
    );
  });
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

  it('shows saved-key feedback and focuses the empty replacement field', () => {
    const snap = baseSnapshot();
    snap.config.anthropic.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    expect(
      within(region).getByText('assistant-settings:key_configured'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(region).getByRole('button', {
        name: 'assistant-settings:replace_key',
      }),
    );
    const input = within(region).getByLabelText(
      'assistant-settings:api_key_label',
    );
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(am.setKey).not.toHaveBeenCalled();
  });

  it('shows readable names and saves the API model ID when selected', async () => {
    const user = userEvent.setup();
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const select = within(region).getByLabelText(
      'assistant-settings:default_model_label',
    );
    expect(select).toHaveTextContent('Sonnet 4.6');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Sonnet 5.5' }));
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      config: { defaultModel: 'claude-sonnet-5-5' },
    });
  });

  it('lets users enter custom IDs without losing an existing custom model', async () => {
    const user = userEvent.setup();
    const snap = baseSnapshot();
    snap.config.anthropic.defaultModel = 'my-private-model';
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    const input = within(region).getByLabelText(
      'assistant-settings:custom_model_id',
    );
    expect(input).toHaveValue('my-private-model');
    expect(
      within(region).getByLabelText('assistant-settings:thinking_label'),
    ).toBeDisabled();
    await user.clear(input);
    await user.type(input, ' new-model-id ');
    await user.tab();
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      config: { defaultModel: 'new-model-id' },
    });
  });

  it('can switch from a listed model to a custom model ID', async () => {
    const user = userEvent.setup();
    const am = fakeAssistantManager({ initialSnapshot: baseSnapshot() });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_openai',
    });
    await user.click(
      within(region).getByLabelText('assistant-settings:default_model_label'),
    );
    await user.click(
      screen.getByRole('option', { name: 'assistant-settings:custom_model' }),
    );
    const input = within(region).getByLabelText(
      'assistant-settings:custom_model_id',
    );
    await user.clear(input);
    await user.type(input, 'private-deployment{Enter}');
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'openai',
      config: { defaultModel: 'private-deployment' },
    });
  });

  it('offers model-supported thinking levels and saves the chosen level', async () => {
    const user = userEvent.setup();
    const snap = baseSnapshot();
    snap.config.anthropic.defaultModel = 'claude-sonnet-5-5';
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    await user.click(
      within(region).getByLabelText('assistant-settings:thinking_label'),
    );
    expect(
      screen.queryByRole('option', {
        name: 'assistant-settings:thinking_none',
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('option', { name: 'assistant-settings:thinking_xhigh' }),
    );
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      config: { thinkingLevel: 'xhigh' },
    });
  });

  it('resets incompatible thinking when switching models', async () => {
    const user = userEvent.setup();
    const snap = baseSnapshot();
    const am = fakeAssistantManager({
      initialSnapshot: {
        ...snap,
        config: {
          ...snap.config,
          openai: {
            ...snap.config.openai,
            defaultModel: 'gpt-6.2-sol',
            thinkingLevel: 'max',
          },
        },
      },
    });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_openai',
    });
    await user.click(
      within(region).getByLabelText('assistant-settings:default_model_label'),
    );
    await user.click(screen.getByRole('option', { name: 'GPT-4.1' }));
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'openai',
      config: { defaultModel: 'gpt-4.1', thinkingLevel: 'auto' },
    });
  });
});

describe('<AssistantSettings> — Test connection toasts', () => {
  it('discards a late connection result when the tested model has changed', async () => {
    const snap = baseSnapshot();
    snap.config.anthropic.hasKey = true;
    const am = fakeAssistantManager({ initialSnapshot: snap });
    let finish!: (result: { ok: boolean }) => void;
    am.testConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    const region = screen.getByRole('region', {
      name: 'assistant-settings:provider_anthropic',
    });
    fireEvent.click(
      within(region).getByRole('button', {
        name: 'assistant-settings:test_connection',
      }),
    );
    expect(within(region).getByRole('status')).toHaveTextContent(
      'assistant-settings:status_testing',
    );
    act(() =>
      am._setSnapshot({
        ...snap,
        config: {
          ...snap.config,
          anthropic: {
            ...snap.config.anthropic,
            defaultModel: 'claude-sonnet-5-5',
          },
        },
      }),
    );
    await act(async () => finish({ ok: true }));
    expect(within(region).getByRole('status')).toHaveTextContent(
      'assistant-settings:connection_not_tested',
    );
    expect(
      within(region).queryByText('assistant-settings:last_tested'),
    ).not.toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
  });

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
  it('saves the requested context window and allows returning to the daemon default', async () => {
    const user = userEvent.setup();
    const snap = baseSnapshot();
    const am = fakeAssistantManager({ initialSnapshot: snap });
    renderWithProviders(<AssistantSettings />, {
      managers: { assistantManager: am as never, mode: 'desktop' },
    });
    await user.click(
      screen.getByLabelText('assistant-settings:ollama_context_label'),
    );
    await user.click(screen.getByRole('option', { name: '32,768' }));
    expect(am.setProviderConfig).toHaveBeenCalledWith({
      provider: 'ollama',
      config: { contextLength: 32768 },
    });
    act(() =>
      am._setSnapshot({
        ...snap,
        config: {
          ...snap.config,
          ollama: { ...snap.config.ollama, contextLength: 32768 },
        },
      }),
    );
    await user.click(
      screen.getByLabelText('assistant-settings:ollama_context_label'),
    );
    await user.click(
      screen.getByRole('option', {
        name: 'assistant-settings:ollama_context_default',
      }),
    );
    expect(am.setProviderConfig).toHaveBeenLastCalledWith({
      provider: 'ollama',
      config: { contextLength: 0 },
    });
  });

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
