/**
 * AssistantSidebar (AI Assistant P3) unit tests.
 *
 * P3 hooked the sidebar up to `AssistantContext` — visible tabs are
 * filtered by the sanitized `from:ai:config` snapshot, and the empty
 * state appears when no providers are enabled. P2's hard-coded tab
 * list is gone; these tests assert the new config-driven behaviour:
 *
 *   - no-providers-enabled → CTA + Settings-modal seam (no tabs)
 *   - all enabled → all three tabs render in the documented order
 *   - filtered to subset → only matching tabs render
 *   - active tab falls back when the current one is disabled
 *   - clicking switches the active pane
 */

import * as React from 'react';
import { screen, fireEvent, act } from '@testing-library/react';

import { AssistantSidebar } from '../../src/browser/react/components/AssistantSidebar';
import { fakeAssistantManager, renderWithProviders } from '../utils/render';
import { useModals } from '../../src/browser/react/contexts/ModalsContext';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

function snapshotWith(overrides: {
  anthropic?: boolean;
  openai?: boolean;
  ollama?: boolean;
}) {
  return {
    config: {
      anthropic: {
        enabled: !!overrides.anthropic,
        hasKey: !!overrides.anthropic,
        defaultModel: 'claude-sonnet-4-6',
      },
      openai: {
        enabled: !!overrides.openai,
        hasKey: !!overrides.openai,
        defaultModel: 'gpt-5',
      },
      ollama: {
        enabled: !!overrides.ollama,
        hasKey: false as const,
        baseUrl: 'http://localhost:11434',
        defaultModel: 'llama3.2',
      },
    },
    encryptionAvailable: true,
  };
}

describe('<AssistantSidebar> — empty state (no providers enabled)', () => {
  it('renders the title + empty-state CTA when no providers are enabled', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({}),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getByText('assistant:title')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'assistant:open_settings' }),
    ).toBeInTheDocument();
  });

  it('opens the Settings modal on the AI Providers tab when the empty-state CTA is clicked', () => {
    let captured: ReturnType<typeof useModals> | null = null;
    const Probe: React.FC = () => {
      captured = useModals();
      return null;
    };
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({}),
    });
    renderWithProviders(
      <>
        <AssistantSidebar />
        <Probe />
      </>,
      { managers: { assistantManager: am as never } },
    );
    expect(captured!.open).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'assistant:open_settings' }),
    );
    expect(captured!.open).toBe('settings');
    // The CTA opens directly onto the AI Providers tab so the user
    // doesn't have to click again — SettingsModal reads payload.tab
    // and sets activeTab='assistant'.
    expect(captured!.payload).toEqual({ tab: 'assistant' });
  });
});

describe('<AssistantSidebar> — config-driven tab filtering', () => {
  it('renders all three tabs in the documented order when all are enabled', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({
        anthropic: true,
        openai: true,
        ollama: true,
      }),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Anthropic',
      'OpenAI',
      'Ollama',
    ]);
  });

  it('shows only the enabled providers when a subset is enabled', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({ anthropic: true, ollama: true }),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Anthropic', 'Ollama']);
    expect(screen.queryByRole('tab', { name: 'OpenAI' })).toBeNull();
  });

  it('switches the active tab on click', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({
        anthropic: true,
        openai: true,
        ollama: true,
      }),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'OpenAI' }));
    expect(screen.getByRole('tab', { name: 'OpenAI' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Anthropic' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

describe('<AssistantSidebar> — active-tab fallback', () => {
  it('falls back to the first enabled provider when the active one is disabled', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({
        anthropic: true,
        openai: true,
        ollama: true,
      }),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    // Select OpenAI explicitly so we can prove the fallback kicks in
    // when OpenAI's `enabled` flips to false.
    fireEvent.click(screen.getByRole('tab', { name: 'OpenAI' }));
    expect(screen.getByRole('tab', { name: 'OpenAI' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    act(() => {
      am._setSnapshot(
        snapshotWith({ anthropic: true, openai: false, ollama: true }),
      );
    });

    // OpenAI tab is gone; Anthropic becomes the active fallback.
    expect(screen.queryByRole('tab', { name: 'OpenAI' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Anthropic' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('drops back to the empty state when every provider is disabled', () => {
    const am = fakeAssistantManager({
      initialSnapshot: snapshotWith({ anthropic: true }),
    });
    renderWithProviders(<AssistantSidebar />, {
      managers: { assistantManager: am as never },
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    act(() => {
      am._setSnapshot(snapshotWith({}));
    });

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'assistant:open_settings' }),
    ).toBeInTheDocument();
  });
});
