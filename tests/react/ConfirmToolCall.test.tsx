/**
 * ConfirmToolCall (AI Assistant P5) unit tests.
 *
 * Drives the dialog through `ToolConfirmProvider` rather than the
 * module-level seam — that way we can assert the resolve/reject
 * Promise outcomes directly. The seam itself is just a getter for
 * the provider's `open` function (covered indirectly).
 */

import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
      preview: { kind: 'write', path: '/x.md', after: 'new' } as ToolConfirmPreview,
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

  it('a second open() while the dialog is up cancels the first Promise as rejected', async () => {
    const open = renderWithProvider();
    const first = open({
      toolCallId: 'tc-1',
      toolName: 'write_file',
      arguments: {},
      preview: null,
    });
    await screen.findByRole('dialog');
    const second = open({
      toolCallId: 'tc-2',
      toolName: 'edit_file',
      arguments: {},
      preview: null,
    });
    // The first promise must resolve false (it was superseded).
    await expect(first).resolves.toBe(false);
    // Accept the second.
    await waitFor(() =>
      expect(screen.getByTestId('tool-confirm-accept')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('tool-confirm-accept'));
    await expect(second).resolves.toBe(true);
  });
});
