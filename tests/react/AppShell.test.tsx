/**
 * App `<Shell>` (P7) — web-mode hide assertion for the assistant pane.
 *
 * Security-significant: the decision to drop AI on web (Decisions
 * table in docs/AI_ASSISTANT.md) means the right-hand `assistant-pane`
 * Panel must NOT render in the web build. This test guards the
 * regression so a refactor can't silently bring AI back on web by
 * re-mounting the sidebar.
 *
 * Children stubbed so the test stays focused on the layout gate.
 */

import * as React from 'react';

import { Shell } from '../../src/browser/react/App';
import { renderWithProviders } from '../utils/render';
import type { GroupImperativeHandle } from 'react-resizable-panels';

jest.mock('../../src/browser/react/components/Sidebar', () => ({
  Sidebar: () => <div data-testid="left-sidebar-stub" />,
}));
jest.mock('../../src/browser/react/components/Workspace', () => ({
  Workspace: () => <div data-testid="workspace-stub" />,
}));
jest.mock('../../src/browser/react/components/AssistantSidebar', () => ({
  AssistantSidebar: () => <div data-testid="assistant-sidebar-stub" />,
}));

// react-resizable-panels does ResizeObserver-driven measurement that
// jsdom doesn't support. Stub Group / Panel / Separator into bare
// divs that preserve the `id` as a `data-panel-id` attribute so the
// `[data-panel-id="assistant-pane"]` assertion below can do its job
// without dragging in the real layout machinery.
jest.mock('react-resizable-panels', () => ({
  Group: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <div data-group-id={id}>{children}</div>
  ),
  Panel: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <div data-panel-id={id}>{children}</div>
  ),
  Separator: () => <div data-testid="rrp-separator" />,
}));

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  whenLanguageReady: () => Promise.resolve(),
  normalizeLanguage: (lng: string) => lng,
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
}));

describe('<Shell> — assistant pane visibility', () => {
  it('renders the assistant pane (panel-id="assistant-pane") in desktop mode', () => {
    const groupRef = React.createRef<GroupImperativeHandle>();
    renderWithProviders(<Shell workspaceGroupRef={groupRef} />, {
      managers: { mode: 'desktop' },
    });
    expect(
      document.querySelector('[data-panel-id="assistant-pane"]'),
    ).not.toBeNull();
  });

  it('does NOT render the assistant pane in web mode (P7 decision — AI is desktop-only)', () => {
    const groupRef = React.createRef<GroupImperativeHandle>();
    renderWithProviders(<Shell workspaceGroupRef={groupRef} />, {
      managers: { mode: 'web' },
    });
    expect(
      document.querySelector('[data-panel-id="assistant-pane"]'),
    ).toBeNull();
  });
});
