/**
 * ToolCallCard (AI Assistant P5) unit tests.
 *
 * Stateless component driven entirely by the `invocation` prop. We
 * walk each `status` and assert: the data attribute, the badge
 * label, and the expand-to-show args/result/error contents.
 */

import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { ToolCallCard } from '../../src/browser/react/components/assistant/ToolCallCard';
import type { ToolInvocation } from '../../src/app/interfaces/Assistant';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

function invocation(overrides: Partial<ToolInvocation>): ToolInvocation {
  return {
    toolCallId: 'tc-1',
    toolName: 'read_file',
    arguments: { path: '/x.md' },
    status: 'succeeded',
    ...overrides,
  };
}

describe('<ToolCallCard>', () => {
  it('renders the tool name and a status data-attribute reflecting status', () => {
    render(<ToolCallCard invocation={invocation({ status: 'executing' })} />);
    const card = screen.getByTestId('tool-call-tc-1');
    expect(card.getAttribute('data-status')).toBe('executing');
    expect(within(card).getByText('read_file')).toBeInTheDocument();
  });

  it('clicking the row toggles the expanded args block', () => {
    render(
      <ToolCallCard
        invocation={invocation({
          status: 'succeeded',
          result: { ok: true, content: 'file body' },
        })}
      />,
    );
    const card = screen.getByTestId('tool-call-tc-1');
    // Collapsed by default — no args label visible.
    expect(within(card).queryByText('assistant-tools:args_label')).toBeNull();
    fireEvent.click(within(card).getByRole('button'));
    expect(within(card).getByText('assistant-tools:args_label')).toBeInTheDocument();
    // Result block also shown.
    expect(within(card).getByText('assistant-tools:result_label')).toBeInTheDocument();
  });

  it('failed status shows the translated error code and message', () => {
    render(
      <ToolCallCard
        invocation={invocation({
          status: 'failed',
          errorCode: 'execution_failed',
          errorMessage: 'disk full',
        })}
      />,
    );
    const card = screen.getByTestId('tool-call-tc-1');
    fireEvent.click(within(card).getByRole('button'));
    expect(
      within(card).getByText(/assistant-tools:error_execution_failed/),
    ).toBeInTheDocument();
    expect(within(card).getByText(/disk full/)).toBeInTheDocument();
  });

  it('rejected error uses the error_rejected translation key', () => {
    render(
      <ToolCallCard
        invocation={invocation({ status: 'failed', errorCode: 'rejected' })}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByText(/assistant-tools:error_rejected/),
    ).toBeInTheDocument();
  });

  it('pending-confirm status renders the awaiting-confirmation badge', () => {
    render(
      <ToolCallCard invocation={invocation({ status: 'pending-confirm' })} />,
    );
    expect(
      screen.getByText('assistant-tools:status_pending-confirm'),
    ).toBeInTheDocument();
  });

  it('executing status renders the pulsing-dot badge (aria-labelled)', () => {
    render(<ToolCallCard invocation={invocation({ status: 'executing' })} />);
    expect(
      screen.getByLabelText('assistant-tools:status_executing'),
    ).toBeInTheDocument();
  });

  it('succeeded card stays collapsed until clicked — args block hidden initially', () => {
    render(<ToolCallCard invocation={invocation({ status: 'succeeded' })} />);
    expect(screen.queryByText('assistant-tools:args_label')).toBeNull();
  });
});
