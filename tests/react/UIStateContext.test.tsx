/**
 * UIStateContext seams (AI Assistant P2) unit tests.
 *
 * Direct coverage for the three module-level exports the composition
 * root + BridgeListeners + FileManager wire to:
 *   - `applyRestoredAssistantState` (BridgeListeners → React state)
 *   - `getCurrentAssistantState`     (FileManager pulls at save time)
 *   - `registerAssistantStateChangeListener`
 *                                     (composition root → save trigger)
 *
 * `AssistantSidebar.test.tsx` exercises these indirectly via the
 * sidebar's rendering path; this file isolates them.
 */

import * as React from 'react';
import { act, render } from '@testing-library/react';

import {
  UIStateProvider,
  useUIState,
  applyRestoredAssistantState,
  getCurrentAssistantState,
  registerAssistantStateChangeListener,
  clearAssistantStateChangeListener,
} from '../../src/browser/react/contexts/UIStateContext';

interface Capture {
  current: ReturnType<typeof useUIState> | null;
}

function Probe({ capture }: { capture: Capture }) {
  capture.current = useUIState();
  return null;
}

afterEach(() => {
  clearAssistantStateChangeListener();
});

describe('applyRestoredAssistantState', () => {
  it('updates both rightSidebarOpen and rightSidebarSize and reflects in getCurrentAssistantState', () => {
    const capture: Capture = { current: null };
    render(
      <UIStateProvider initialSidebarOpen>
        <Probe capture={capture} />
      </UIStateProvider>,
    );

    // Defaults: closed @ 20%.
    expect(capture.current?.rightSidebarOpen).toBe(false);
    expect(capture.current?.rightSidebarSize).toBe(20);
    expect(getCurrentAssistantState()).toEqual({
      sidebarOpen: false,
      size: 20,
    });

    act(() => {
      applyRestoredAssistantState({ sidebarOpen: true, size: 33 });
    });

    expect(capture.current?.rightSidebarOpen).toBe(true);
    expect(capture.current?.rightSidebarSize).toBe(33);
    // Live mirror picked up the change (via the effect that syncs on
    // every render after state updates).
    expect(getCurrentAssistantState()).toEqual({
      sidebarOpen: true,
      size: 33,
    });
  });

  it('is a no-op when no provider is mounted (BridgeListeners stays safe under pre-mount events)', () => {
    expect(() =>
      applyRestoredAssistantState({ sidebarOpen: true, size: 25 }),
    ).not.toThrow();
  });
});

describe('registerAssistantStateChangeListener', () => {
  it('fires on setRightSidebarOpen, toggleRightSidebar, and setRightSidebarSize', () => {
    const listener = jest.fn();
    registerAssistantStateChangeListener(listener);

    const capture: Capture = { current: null };
    render(
      <UIStateProvider initialSidebarOpen>
        <Probe capture={capture} />
      </UIStateProvider>,
    );

    act(() => {
      capture.current?.setRightSidebarOpen(true);
    });
    expect(listener).toHaveBeenCalledTimes(1);

    act(() => {
      capture.current?.toggleRightSidebar();
    });
    expect(listener).toHaveBeenCalledTimes(2);

    act(() => {
      capture.current?.setRightSidebarSize(42);
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does NOT fire on setSidebarOpen (left sidebar state is not persisted)', () => {
    const listener = jest.fn();
    registerAssistantStateChangeListener(listener);

    const capture: Capture = { current: null };
    render(
      <UIStateProvider initialSidebarOpen>
        <Probe capture={capture} />
      </UIStateProvider>,
    );

    act(() => {
      capture.current?.setSidebarOpen(false);
    });
    act(() => {
      capture.current?.toggleSidebar();
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('getCurrentAssistantState', () => {
  it('returns a fresh object on every call (callers cannot mutate the internal mirror)', () => {
    const first = getCurrentAssistantState();
    first.size = 999;
    const second = getCurrentAssistantState();
    expect(second.size).not.toBe(999);
  });
});
