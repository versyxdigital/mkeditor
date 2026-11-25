/**
 * useExpandableContent hook unit tests.
 *
 * Behaviour matrix:
 *   - not truncated → no expand affordance, no fetcher call
 *   - truncated + toggle → fetcher invoked, content swapped on resolve
 *   - second toggle (collapse) → switches back without re-fetching
 *   - third toggle (re-expand) → uses cached full content, no fetch
 *   - fetcher rejection → error surfaced, content stays truncated,
 *     retry refetches
 *   - prop change → state resets, truncation re-evaluated against
 *     the new initial content
 */

import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import { useExpandableContent } from '../../src/browser/react/hooks/useExpandableContent';
import { PREVIEW_TRUNCATION_MARKER } from '../../src/browser/core/AssistantTools';

/** Tiny probe that mounts the hook and renders its result for assertion. */
function Probe({
  initialContent,
  fetcher,
  onState,
}: {
  initialContent: string;
  fetcher: () => Promise<string>;
  onState?: (state: ReturnType<typeof useExpandableContent>) => void;
}) {
  const state = useExpandableContent(initialContent, fetcher);
  React.useEffect(() => {
    onState?.(state);
  });
  return (
    <div>
      <span data-testid="content">{state.content}</span>
      <span data-testid="truncated">{String(state.isTruncated)}</span>
      <span data-testid="expanded">{String(state.isExpanded)}</span>
      <span data-testid="loading">{String(state.isLoading)}</span>
      <span data-testid="error">{state.error ?? ''}</span>
      <button data-testid="toggle" onClick={state.toggle}>
        toggle
      </button>
    </div>
  );
}

describe('useExpandableContent', () => {
  it('deduplicates rapid expansion clicks while a read is pending', async () => {
    const fetcher = jest.fn(() => new Promise<string>(() => {}));
    render(
      <Probe
        initialContent={`head${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={fetcher}
      />,
    );
    await act(async () => {
      screen.getByTestId('toggle').click();
      screen.getByTestId('toggle').click();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('discards an old read when a new preview arrives while it is pending', async () => {
    let finishOld!: (value: string) => void;
    let finishNew!: (value: string) => void;
    const oldFetcher = () =>
      new Promise<string>((resolve) => {
        finishOld = resolve;
      });

    const newFetcher = () =>
      new Promise<string>((resolve) => {
        finishNew = resolve;
      });
    const { rerender } = render(
      <Probe
        initialContent={`old${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={oldFetcher}
      />,
    );
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    rerender(
      <Probe
        initialContent={`new${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={newFetcher}
      />,
    );
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await act(async () => {
      finishOld('stale old text');
    });
    expect(screen.getByTestId('content').textContent).toBe(
      `new${PREVIEW_TRUNCATION_MARKER}`,
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    await act(async () => {
      finishNew('current full text');
    });
    expect(screen.getByTestId('content')).toHaveTextContent(
      'current full text',
    );
  });

  it('ignores failures belonging to an earlier preview', async () => {
    let fail!: (error: Error) => void;
    const { rerender } = render(
      <Probe
        initialContent={`old${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={() =>
          new Promise<string>((_resolve, reject) => {
            fail = reject;
          })
        }
      />,
    );
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    rerender(
      <Probe initialContent="current" fetcher={async () => 'current'} />,
    );
    await act(async () => {
      fail(new Error('obsolete failure'));
    });
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('content')).toHaveTextContent('current');
  });

  it('surfaces a synchronous fetcher error as a recoverable read failure', async () => {
    render(
      <Probe
        initialContent={`head${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={() => {
          throw new Error('synchronous failure');
        }}
      />,
    );
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    expect(screen.getByTestId('error')).toHaveTextContent(
      'synchronous failure',
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('returns the content as-is when not truncated', () => {
    const fetcher = jest.fn();
    render(<Probe initialContent="short" fetcher={fetcher} />);
    expect(screen.getByTestId('content').textContent).toBe('short');
    expect(screen.getByTestId('truncated').textContent).toBe('false');
    expect(screen.getByTestId('expanded').textContent).toBe('false');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('toggling on truncated content invokes the fetcher and swaps the content', async () => {
    const truncated = `head${PREVIEW_TRUNCATION_MARKER}`;
    const full = 'head + tail';
    const fetcher = jest.fn(() => Promise.resolve(full));
    render(<Probe initialContent={truncated} fetcher={fetcher} />);
    expect(screen.getByTestId('truncated').textContent).toBe('true');

    await act(async () => {
      screen.getByTestId('toggle').click();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('content').textContent).toBe(full);
    expect(screen.getByTestId('expanded').textContent).toBe('true');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('collapse + re-expand reuses the cached full content (no second fetch)', async () => {
    const truncated = `head${PREVIEW_TRUNCATION_MARKER}`;
    const full = 'full content';
    const fetcher = jest.fn(() => Promise.resolve(full));
    render(<Probe initialContent={truncated} fetcher={fetcher} />);

    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('content').textContent).toBe(full);

    // Collapse — content reverts to truncated, fetcher untouched.
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    expect(screen.getByTestId('expanded').textContent).toBe('false');
    expect(screen.getByTestId('content').textContent).toBe(truncated);

    // Re-expand — uses cache, no second fetch.
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('content').textContent).toBe(full);
  });

  it('surfaces fetcher rejection as error; content stays truncated and retry refetches', async () => {
    const truncated = `head${PREVIEW_TRUNCATION_MARKER}`;
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('read failed');
      return 'recovered';
    });
    render(<Probe initialContent={truncated} fetcher={fetcher} />);

    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('read failed'),
    );
    expect(screen.getByTestId('expanded').textContent).toBe('false');
    expect(screen.getByTestId('content').textContent).toBe(truncated);

    // Retry — fires the fetcher again and succeeds.
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('expanded').textContent).toBe('true'),
    );
    expect(screen.getByTestId('content').textContent).toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('resets state when initialContent prop changes', () => {
    const fetcher = jest.fn(() => Promise.resolve('full'));
    const { rerender } = render(
      <Probe
        initialContent={`head${PREVIEW_TRUNCATION_MARKER}`}
        fetcher={fetcher}
      />,
    );
    expect(screen.getByTestId('truncated').textContent).toBe('true');
    rerender(<Probe initialContent="now short" fetcher={fetcher} />);
    expect(screen.getByTestId('truncated').textContent).toBe('false');
    expect(screen.getByTestId('expanded').textContent).toBe('false');
    expect(screen.getByTestId('content').textContent).toBe('now short');
  });
});
