/**
 * ChatMessage (AI Assistant P4) unit tests.
 *
 * Focuses on the per-status visual contract — the bubble's role
 * markup, the cancelled / failed footers, the streaming dot when the
 * content is still empty. The markdown render path itself is mocked
 * since these tests aren't about Markdown.ts (covered in
 * `tests/markdown.test.ts`).
 */

import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { ChatMessage } from '../../src/browser/react/components/assistant/ChatMessage';
import type {
  ToolInvocation,
  UiChatMessage,
} from '../../src/app/interfaces/Assistant';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

jest.mock('../../src/browser/core/Markdown', () => ({
  renderAssistantMarkdown: (s: string) => `<p data-md="true">${s}</p>`,
  Markdown: { render: (s: string) => s },
}));

function msg(overrides: Partial<UiChatMessage> = {}): UiChatMessage {
  return {
    id: 'm-1',
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('<ChatMessage>', () => {
  it('renders a user bubble with the content as preserved-whitespace text', () => {
    render(
      <ChatMessage
        message={msg({
          id: 'u-1',
          role: 'user',
          content: 'line 1\nline 2',
          status: 'complete',
        })}
      />,
    );
    const bubble = screen.getByTestId('chat-message-u-1');
    expect(bubble.getAttribute('data-role')).toBe('user');
    expect(bubble.getAttribute('data-status')).toBe('complete');
    // The bubble contains the literal newline (whitespace-pre-wrap preserves it).
    expect(bubble.textContent).toContain('line 1');
    expect(bubble.textContent).toContain('line 2');
    // No markdown rendering for user messages.
    expect(bubble.querySelector('[data-md="true"]')).toBeNull();
  });

  it('renders an assistant bubble through renderAssistantMarkdown once the lazy chunk loads', async () => {
    render(
      <ChatMessage
        message={msg({
          id: 'a-1',
          content: '## heading',
          status: 'complete',
        })}
      />,
    );
    // First render uses the plain-text fallback because the markdown
    // chunk is loaded dynamically (keeps the main bundle small —
    // hljs + KaTeX would otherwise pull in ~450 KB eagerly). Once
    // the dynamic import resolves, the bubble re-renders through the
    // mocked `renderAssistantMarkdown`.
    await waitFor(() => {
      const bubble = screen.getByTestId('chat-message-a-1');
      expect(bubble.querySelector('[data-md="true"]')?.textContent).toBe(
        '## heading',
      );
    });
  });

  it('renders the ThinkingIndicator (rotating gerund + dot) when an assistant message is empty but streaming', () => {
    render(<ChatMessage message={msg({ status: 'streaming', content: '' })} />);
    // The indicator owns the streaming aria-label now (previously the
    // bare dot did). The gerund text reads "Thinking…" / "Pondering…"
    // etc. — sourced from the i18n key the test mock returns verbatim.
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
    expect(
      screen.getByLabelText('assistant-chat:streaming'),
    ).toBeInTheDocument();
  });

  it('does NOT show the thinking indicator once content has arrived', () => {
    render(
      <ChatMessage
        message={msg({ status: 'streaming', content: 'partial output' })}
      />,
    );
    expect(screen.queryByTestId('thinking-indicator')).toBeNull();
    expect(screen.queryByLabelText('assistant-chat:streaming')).toBeNull();
  });

  it('shows the cancelled footer when status is cancelled', () => {
    render(
      <ChatMessage
        message={msg({ status: 'cancelled', content: 'partial' })}
      />,
    );
    expect(
      screen.getByText('assistant-chat:message_cancelled'),
    ).toBeInTheDocument();
  });

  it('shows the translated error code when status is failed', () => {
    render(
      <ChatMessage
        message={msg({
          status: 'failed',
          content: '',
          errorCode: 'invalid_key',
          errorMessage: '401',
        })}
      />,
    );
    expect(
      screen.getByText('assistant-settings:error_invalid_key'),
    ).toBeInTheDocument();
  });

  it('falls back to error_unknown when no code is set on a failed message', () => {
    render(<ChatMessage message={msg({ status: 'failed', content: '' })} />);
    expect(
      screen.getByText('assistant-settings:error_unknown'),
    ).toBeInTheDocument();
  });

  // ----- P5: tool-call render branch ---------------------------------

  function tc(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
    return {
      toolCallId: 'tc-1',
      toolName: 'read_file',
      arguments: { path: '/a.md' },
      status: 'succeeded',
      ...overrides,
    };
  }

  it('renders a tool-call list inside an assistant bubble when toolCalls is non-empty (P5)', () => {
    render(
      <ChatMessage
        message={msg({
          id: 'a-tools',
          status: 'complete',
          content: 'Done.',
          toolCalls: [
            tc({ toolCallId: 'tc-a', toolName: 'read_file' }),
            tc({ toolCallId: 'tc-b', toolName: 'list_files' }),
          ],
        })}
      />,
    );
    const list = screen.getByTestId('tool-call-list');
    expect(list).toBeInTheDocument();
    // One card per invocation, keyed by toolCallId via ToolCallCard's
    // own testid contract (`tool-call-<toolCallId>`).
    expect(screen.getByTestId('tool-call-tc-a')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-tc-b')).toBeInTheDocument();
  });

  it('does NOT render the tool-call list on a user bubble even when toolCalls is set', () => {
    // User bubbles never carry toolCalls in practice, but the guard
    // (`!isUser && ...`) is worth pinning.
    render(
      <ChatMessage
        message={msg({
          id: 'u-tools',
          role: 'user',
          content: 'hello',
          status: 'complete',
          toolCalls: [tc()],
        })}
      />,
    );
    expect(screen.queryByTestId('tool-call-list')).toBeNull();
  });

  it('does NOT render a tool-call list container when toolCalls is empty', () => {
    render(
      <ChatMessage
        message={msg({
          id: 'a-empty',
          status: 'complete',
          content: 'ok',
          toolCalls: [],
        })}
      />,
    );
    expect(screen.queryByTestId('tool-call-list')).toBeNull();
  });
});
