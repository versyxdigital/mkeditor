/**
 * AssistantSidebar (AI Assistant P2) unit tests.
 *
 * P2 is purely the shell + tab strip + empty-state placeholder. P3
 * fills the body with the settings UI, P4 with the chat surface, so
 * these tests assert the shell affordances only:
 *   - all three provider tabs render with the documented labels
 *   - clicking a tab switches the active pane
 *   - the empty-state CTA opens the Settings modal (modal seam fires)
 */

import * as React from 'react';
import { screen, fireEvent } from '@testing-library/react';

import { AssistantSidebar } from '../../src/browser/react/components/AssistantSidebar';
import { renderWithProviders } from '../utils/render';
import { useModals } from '../../src/browser/react/contexts/ModalsContext';

// i18next is not initialised in the test environment, so we stub the
// translator to echo keys. Matches the pattern in `SettingsModal.test`.
// Interpolation in `t(key, vars)` is dropped here — assertions match
// the literal key, never the interpolated string.
jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

describe('<AssistantSidebar>', () => {
  it('renders the title + all three provider tabs in the documented order', () => {
    renderWithProviders(<AssistantSidebar />);
    expect(screen.getByText('assistant:title')).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Anthropic',
      'OpenAI',
      'Ollama',
    ]);
  });

  it('marks Anthropic as the active tab by default', () => {
    renderWithProviders(<AssistantSidebar />);
    const tab = screen.getByRole('tab', { name: 'Anthropic' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('data-state', 'active');
    expect(
      screen.getByRole('tabpanel', { name: 'Anthropic' }),
    ).toBeInTheDocument();
  });

  it('switches the active tab on click', () => {
    renderWithProviders(<AssistantSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'OpenAI' }));

    expect(screen.getByRole('tab', { name: 'OpenAI' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Anthropic' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(
      screen.getByRole('tabpanel', { name: 'OpenAI' }),
    ).toBeInTheDocument();
  });

  it('opens the Settings modal when the empty-state CTA is clicked', () => {
    // Probe `useModals` via a sibling that captures its current value
    // so we can assert that the CTA fired the modal opener.
    let captured: ReturnType<typeof useModals> | null = null;
    const Probe: React.FC = () => {
      captured = useModals();
      return null;
    };

    renderWithProviders(
      <>
        <AssistantSidebar />
        <Probe />
      </>,
    );

    expect(captured!.open).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'assistant:open_settings' }),
    );

    expect(captured!.open).toBe('settings');
  });

  it('preserves the active tab across re-render', () => {
    const { rerender } = renderWithProviders(<AssistantSidebar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ollama' }));
    rerender(<AssistantSidebar />);
    expect(screen.getByRole('tab', { name: 'Ollama' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
