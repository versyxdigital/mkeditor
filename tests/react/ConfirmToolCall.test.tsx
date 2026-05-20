/**
 * ConfirmToolCall (AI Assistant P5) unit tests.
 *
 * Drives the dialog through `ToolConfirmProvider` rather than the
 * module-level seam — that way we can assert the resolve/reject
 * Promise outcomes directly. The seam itself is just a getter for
 * the provider's `open` function (covered indirectly).
 */

import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { ConfirmToolCall } from '../../src/browser/react/components/assistant/ConfirmToolCall';
import {
  ToolConfirmProvider,
  useToolConfirm,
} from '../../src/browser/react/contexts/ToolConfirmContext';
import type { ToolConfirmPreview } from '../../src/browser/core/AssistantTools';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

/** Test harness: probes useToolConfirm so we can open the dialog imperatively. */
function Harness({
  onOpen,
}: {
  onOpen: (open: ReturnType<typeof useToolConfirm>['open']) => void;
}) {
  const { open } = useToolConfirm();
  React.useEffect(() => {
    onOpen(open);
  }, [open, onOpen]);
  return null;
}

function renderWithProvider() {
  let openFn: ReturnType<typeof useToolConfirm>['open'] | null = null;
  render(
    <ToolConfirmProvider>
      <Harness
        onOpen={(o) => {
          openFn = o;
        }}
      />
      <ConfirmToolCall />
    </ToolConfirmProvider>,
  );
  if (!openFn) throw new Error('opener never registered');
  return openFn;
}

describe('<ConfirmToolCall>', () => {
  it('does not render a dialog when no request is open', () => {
    render(
      <ToolConfirmProvider>
        <ConfirmToolCall />
      </ToolConfirmProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when a request is opened; accept resolves the Promise with true', async () => {
    const open = renderWithProvider();
    const promise = open({
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: { path: '/x.md', content: 'new' },
      preview: {
        kind: 'write',
        path: '/x.md',
        after: 'new',
      } as ToolConfirmPreview,
    });

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByTestId('tool-confirm-accept'));
    await expect(promise).resolves.toBe(true);
  });

  it('reject resolves the Promise with false', async () => {
    const open = renderWithProvider();
    const promise = open({
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: {},
      preview: null,
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByTestId('tool-confirm-reject'));
    await expect(promise).resolves.toBe(false);
  });

  it('renders the preview block (before + after) for write/edit kinds', async () => {
    const open = renderWithProvider();
    open({
      toolCallId: 'tc-1',
      toolName: 'edit_file',
      arguments: {},
      preview: {
        kind: 'edit',
        path: '/x.md',
        before: 'old line',
        after: 'new line',
        detail: 'Lines 3–4',
      },
    });
    await screen.findByRole('dialog');
    expect(screen.getByTestId('tool-confirm-preview')).toBeInTheDocument();
    expect(screen.getByText('old line')).toBeInTheDocument();
    expect(screen.getByText('new line')).toBeInTheDocument();
  });

  it('falls back to the args JSON block when no preview is provided', async () => {
    const open = renderWithProvider();
    open({
      toolCallId: 'tc-1',
      toolName: 'something',
      arguments: { foo: 'bar' },
      preview: null,
    });
    await screen.findByRole('dialog');
    expect(screen.getByTestId('tool-confirm-args')).toBeInTheDocument();
    // JSON stringified inside a pre block.
    expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
  });

  it('queues a second open() behind the first instead of force-cancelling it', async () => {
    // Regression guard. Previously this provider force-resolved the
    // first request as `false` when a second one came in — surfacing
    // as "User declined the tool call" for an action the user never
    // got to evaluate. With parallel tool calls (multiple write_file
    // events in one assistant turn) that fired routinely.
    const open = renderWithProvider();
    const firstReq = {
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: { path: '/a.md', content: 'first-payload' },
      preview: {
        kind: 'write',
        path: '/a.md',
        after: 'first-payload',
      } as ToolConfirmPreview,
    };
    const secondReq = {
      toolCallId: 'tc-2',
      toolName: 'edit_file',
      arguments: { path: '/b.md' },
      preview: {
        kind: 'edit',
        path: '/b.md',
        before: 'second-before',
        after: 'second-after',
      } as ToolConfirmPreview,
    };
    let first!: Promise<boolean>;
    act(() => {
      first = open(firstReq);
    });
    await screen.findByRole('dialog');
    // Confirm the FIRST dialog is showing by its preview content
    // (the `t()` mock interpolates the path into a heading string,
    // but the `after`/`before` strings land verbatim inside a <pre>).
    expect(screen.getByText('first-payload')).toBeInTheDocument();

    let second!: Promise<boolean>;
    act(() => {
      second = open(secondReq);
    });

    // Neither Promise has resolved yet — the second is queued.
    expect(screen.getByText('first-payload')).toBeInTheDocument();
    expect(screen.queryByText('second-after')).toBeNull();

    // Accept the first — it resolves with the user's actual choice.
    fireEvent.click(screen.getByTestId('tool-confirm-accept'));
    await expect(first).resolves.toBe(true);

    // The queued second one promotes into the on-screen slot.
    await waitFor(() =>
      expect(screen.getByText('second-after')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('tool-confirm-reject'));
    await expect(second).resolves.toBe(false);
  });

  it('cancelForCallId drops every confirmation tagged with that callId', async () => {
    // A chat-cancel mid-flight needs to clear both the on-screen
    // dialog and anything queued behind it — otherwise the user gets
    // prompted for tool-calls belonging to a chat they walked away
    // from.
    let cancelFn: ((callId: string) => void) | null = null;
    const opens: ReturnType<typeof useToolConfirm>['open'][] = [];
    render(
      <ToolConfirmProvider>
        <Probe
          onMount={(state) => {
            cancelFn = state.cancelForCallId;
            opens.push(state.open);
          }}
        />
        <ConfirmToolCall />
      </ToolConfirmProvider>,
    );
    await waitFor(() => expect(opens.length).toBeGreaterThan(0));
    const open = opens[0];

    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    let c!: Promise<boolean>;
    act(() => {
      a = open({
        toolCallId: 'tc-1',
        toolName: 'write_file',
        arguments: {},
        preview: null,
        callId: 'chat-A',
      });
      b = open({
        toolCallId: 'tc-2',
        toolName: 'write_file',
        arguments: {},
        preview: null,
        callId: 'chat-A',
      });
      c = open({
        toolCallId: 'tc-3',
        toolName: 'write_file',
        arguments: {},
        preview: null,
        callId: 'chat-B',
      });
    });

    await screen.findByRole('dialog');

    // Cancel chat-A — drops the on-screen request AND the queued
    // tc-2, but leaves tc-3 (chat-B) intact. `act` wraps the
    // synchronous setRequest the cancel triggers so the assertion
    // below reads the post-flush DOM.
    act(() => {
      cancelFn!('chat-A');
    });

    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);

    // chat-B's confirmation should now be on screen.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tool-confirm-accept'));
    await expect(c).resolves.toBe(true);
  });
});

/** Probes the context for tests that need cancelForCallId in addition to open. */
function Probe({
  onMount,
}: {
  onMount: (state: ReturnType<typeof useToolConfirm>) => void;
}) {
  const state = useToolConfirm();
  React.useEffect(() => {
    onMount(state);
  }, [state, onMount]);
  return null;
}
