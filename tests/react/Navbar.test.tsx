/**
 * Navbar (P7) — web-mode hide assertion for the AI Assistant toggle.
 *
 * Security-significant: the decision to drop AI on web (Decisions
 * table in docs/AI_ASSISTANT.md) means the right-sidebar toggle in
 * the top nav must NOT render in the web build. This test guards
 * the regression so a future refactor can't silently bring AI back
 * on web by re-introducing the button.
 *
 * Desktop-mode positive case is covered indirectly by every other
 * React test that defaults to building the navbar through
 * `renderWithProviders`.
 */

import * as React from 'react';
import { screen } from '@testing-library/react';

import { Navbar } from '../../src/browser/react/components/Navbar';
import { renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  whenLanguageReady: () => Promise.resolve(),
  normalizeLanguage: (lng: string) => lng,
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

describe('<Navbar> — AI Assistant toggle visibility', () => {
  it('renders the AI assistant toggle when mode is desktop', () => {
    renderWithProviders(<Navbar />, {
      managers: { mode: 'desktop' },
    });
    expect(document.getElementById('assistant-toggle')).not.toBeNull();
  });

  it('hides the AI assistant toggle when mode is web (regression — P7 decision)', () => {
    // Regression: web AI was dropped (no localStorage keys). The
    // Navbar toggle must NOT render in web mode; the right-sidebar
    // Panel is also gone, so the button would dangle.
    renderWithProviders(<Navbar />, {
      managers: { mode: 'web' },
    });
    expect(document.getElementById('assistant-toggle')).toBeNull();
    expect(screen.queryByText('navbar:toggle_assistant_tooltip')).toBeNull();
  });
});
