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
import { act, screen } from '@testing-library/react';
import { getCurrentAssistantState } from '../../src/browser/assistantUiState';

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
  Group: ({
    children,
    id,
    onLayoutChanged,
    resizeTargetMinimumSize,
  }: {
    children: React.ReactNode;
    id?: string;
    onLayoutChanged?: (layout: Record<string, number>) => void;
    resizeTargetMinimumSize?: { fine: number };
  }) => (
    <div
      data-group-id={id}
      data-target-size={resizeTargetMinimumSize?.fine}
      onPointerUp={() => onLayoutChanged?.({ 'assistant-pane': 35 })}
      onDoubleClick={() => onLayoutChanged?.({ 'assistant-pane': 0 })}
    >
      {children}
    </div>
  ),

  Panel: ({ children, id }: { children: React.ReactNode; id?: string }) => (
    <div data-panel-id={id}>{children}</div>
  ),

  Separator: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} role="separator">
      {children}
    </div>
  ),
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
  it('provides a visible, labelled resize handle and persists settled widths without clearing them on collapse', () => {
    const groupRef = React.createRef<GroupImperativeHandle>();
    renderWithProviders(<Shell workspaceGroupRef={groupRef} />, {
      managers: { mode: 'desktop' },
    });
    const handle = screen.getByRole('separator', {
      name: 'assistant:resize_sidebar',
    });
    expect(handle).toHaveClass('w-2', 'cursor-col-resize');
    const group = document.querySelector('[data-group-id="mkeditor-layout"]')!;
    expect(group).toHaveAttribute('data-target-size', '18');
    act(() => group.dispatchEvent(new Event('pointerup', { bubbles: true })));
    expect(getCurrentAssistantState().size).toBe(35);
    act(() =>
      group.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    expect(getCurrentAssistantState().size).toBe(35);
  });
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
