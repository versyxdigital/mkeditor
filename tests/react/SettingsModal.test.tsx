import * as React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';

import { SettingsModal } from '../../src/browser/react/components/modals/SettingsModal';
import { useModals } from '../../src/browser/react/contexts/ModalsContext';
import type { EditorSettings } from '../../src/browser/interfaces/Editor';
import { renderWithProviders } from '../utils/render';

// i18next is not initialised in the test environment; the real
// `t(key)` would return undefined. Replace the module with a stub
// that returns the key itself so we can use it as an accessible name.
// `getAvailableLocales` is stubbed to a fixed list to keep the test
// deterministic.
jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  getAvailableLocales: jest.fn(async () => [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'fr', name: 'French', native: 'Français' },
  ]),
}));

/**
 * Builds a fake SettingsProvider that satisfies the
 * `subscribe`/`getSnapshot`/`updateSetting` contract SettingsContext
 * consumes via `useSyncExternalStore`.
 */
function fakeSettingsProvider(initial: Partial<EditorSettings> = {}) {
  let state: EditorSettings = {
    autoindent: false,
    darkmode: false,
    wordwrap: true,
    whitespace: false,
    minimap: true,
    systemtheme: false,
    scrollsync: true,
    sessionRestore: true,
    locale: 'en',
    ...initial,
  };
  let snapshot: EditorSettings = { ...state };
  const listeners = new Set<() => void>();

  return {
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getSnapshot: jest.fn(() => snapshot),
    updateSetting: jest.fn(
      <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
        state = { ...state, [key]: value };
        snapshot = { ...state };
        listeners.forEach((l) => l());
      },
    ),
    getSettings: jest.fn(() => state),
  };
}

/** Convenience helper to open the Settings modal before assertions. */
const OpenSettings: React.FC = () => {
  const { openModal } = useModals();
  React.useEffect(() => {
    openModal('settings');
  }, [openModal]);
  return null;
};

describe('<SettingsModal>', () => {
  it('reflects the initial SettingsContext snapshot and updates on toggle', async () => {
    const settingsProvider = fakeSettingsProvider({ autoindent: false });

    renderWithProviders(
      <>
        <OpenSettings />
        <SettingsModal />
      </>,
      {
        managers: {
          providers: {
            bridge: null,
            commands: null,
            completion: null,
            settings: settingsProvider as any,
            exportSettings: null,
          },
        },
      },
    );

    // Wait for the locale list to populate (the modal renders even before).
    await screen.findByRole('dialog');

    const dialog = screen.getByRole('dialog');

    // The autoindent checkbox starts unchecked (radix checkbox uses
    // data-state=unchecked when not checked).
    const autoindent = within(dialog).getByRole('checkbox', {
      name: /autoindent/i,
    });
    expect(autoindent.getAttribute('data-state')).toBe('unchecked');

    fireEvent.click(autoindent);

    expect(settingsProvider.updateSetting).toHaveBeenCalledWith(
      'autoindent',
      true,
    );
    // After the click the snapshot updated; the control flips checked.
    expect(autoindent.getAttribute('data-state')).toBe('checked');
  });

  it('hides the AI Providers tab entirely when mode is web (P7 decision — desktop-only AI)', async () => {
    // Regression: web AI was dropped (no localStorage keys). The
    // AI Providers tab trigger AND content must NOT render in web
    // mode, AND any externally-requested `payload.tab: 'assistant'`
    // falls back to general (we can't open a tab that doesn't exist).
    const settingsProvider = fakeSettingsProvider({});
    const OpenAssistantTab: React.FC = () => {
      const { openModal } = useModals();
      React.useEffect(() => {
        openModal('settings', { tab: 'assistant' });
      }, [openModal]);
      return null;
    };
    renderWithProviders(
      <>
        <OpenAssistantTab />
        <SettingsModal />
      </>,
      {
        managers: {
          mode: 'web',
          providers: {
            bridge: null,
            commands: null,
            completion: null,
            settings: settingsProvider as any,
            exportSettings: null,
          },
        },
      },
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('tab', {
        name: 'modals-settings:tab_assistant',
      }),
    ).toBeNull();
    // General tab is the only one and is selected as fallback.
    expect(
      within(dialog).getByRole('tab', {
        name: 'modals-settings:tab_general',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    // Title doesn't switch to the AI variant either.
    expect(
      within(dialog).queryByText('modals-settings:title_assistant'),
    ).toBeNull();
  });

  it('opens on the AI Providers tab when payload.tab is "assistant", and swaps the title accordingly', async () => {
    const settingsProvider = fakeSettingsProvider({});
    const OpenOnAssistantTab: React.FC = () => {
      const { openModal } = useModals();
      React.useEffect(() => {
        openModal('settings', { tab: 'assistant' });
      }, [openModal]);
      return null;
    };

    renderWithProviders(
      <>
        <OpenOnAssistantTab />
        <SettingsModal />
      </>,
      {
        managers: {
          // P7: AI Assistant is desktop-only — the modal's assistant
          // tab is hidden in web mode. Override the default ('web')
          // so this test still drives the AI Providers path.
          mode: 'desktop',
          providers: {
            bridge: null,
            commands: null,
            completion: null,
            settings: settingsProvider as any,
            exportSettings: null,
          },
        },
      },
    );

    const dialog = await screen.findByRole('dialog');
    // Title swaps to the AI variant (the i18n mock echoes keys, so we
    // match the key directly).
    expect(
      within(dialog).getByText('modals-settings:title_assistant'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('modals-settings:title')).toBeNull();
    // The AI Providers tab trigger is selected, not General.
    expect(
      within(dialog).getByRole('tab', {
        name: 'modals-settings:tab_assistant',
      }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(dialog).getByRole('tab', {
        name: 'modals-settings:tab_general',
      }),
    ).toHaveAttribute('aria-selected', 'false');
  });

  it('updateSetting fires when the wordwrap checkbox is toggled off', async () => {
    const settingsProvider = fakeSettingsProvider({ wordwrap: true });

    renderWithProviders(
      <>
        <OpenSettings />
        <SettingsModal />
      </>,
      {
        managers: {
          providers: {
            bridge: null,
            commands: null,
            completion: null,
            settings: settingsProvider as any,
            exportSettings: null,
          },
        },
      },
    );

    // Await the dialog so the `getAvailableLocales` promise resolves
    // inside act(...); otherwise its setLocales fires after the test
    // returns and React emits an act() warning.
    const dialog = await screen.findByRole('dialog');
    const wordwrap = within(dialog).getByRole('checkbox', {
      name: /wordwrap/i,
    });
    expect(wordwrap.getAttribute('data-state')).toBe('checked');
    fireEvent.click(wordwrap);
    expect(settingsProvider.updateSetting).toHaveBeenCalledWith(
      'wordwrap',
      false,
    );
  });
});
