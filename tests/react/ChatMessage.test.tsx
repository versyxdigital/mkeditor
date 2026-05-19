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
import { screen, waitFor } from '@testing-library/react';

import { ChatMessage } from '../../src/browser/react/components/assistant/ChatMessage';
import type {
  ToolInvocation,
  UiChatMessage,
} from '../../src/app/interfaces/Assistant';
import { renderWithProviders } from '../utils/render';

// P8: ToolCallCard (rendered inline when message.segments contains
// tool-call entries) now reads useAssistantChat() for the retry-
// button gate. Tests use renderWithProviders so the manager context
// is available; non-tool-call cases work the same as before.
const render = (ui: React.ReactElement) => renderWithProviders(ui);

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
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

  it('renders the ThinkingIndicator (rotating gerund + dot) whenever the assistant message is streaming', () => {
    render(<ChatMessage message={msg({ status: 'streaming', content: '' })} />);
    // The indicator owns the streaming aria-label now (previously the
    // bare dot did). The gerund text reads "Thinking…" / "Pondering…"
    // etc. — sourced from the i18n key the test mock returns verbatim.
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
    expect(
      screen.getByLabelText('assistant-chat:streaming'),
    ).toBeInTheDocument();
  });

  it('keeps the indicator visible after content has started streaming (covers the tool-input generation gap)', () => {
    // Previously the indicator hid as soon as one character of text
    // arrived. For Anthropic write_file calls the model can spend
    // 30+ seconds generating the tool's `content` argument (e.g. a
    // 3000-word essay) AFTER the user-visible "I'll write that for
    // you" text completes — during which the only signal of
    // activity was the Stop button. The indicator now stays put
    // for the entire `status === 'streaming'` window so users
    // always have a "model is working" cue.
    render(
      <ChatMessage
        message={msg({
          status: 'streaming',
          content: "I'll write that for you.",
        })}
      />,
    );
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
  });

  it('keeps the indicator visible while a tool call is executing mid-turn', () => {
    render(
      <ChatMessage
        message={msg({
          status: 'streaming',
          content: "I'll save that for you. ",
          toolCalls: [
            {
              toolCallId: 'tc-write',
              toolName: 'write_file',
              arguments: { path: '/a.md', content: 'hi' },
              status: 'executing',
            },
          ],
          segments: [
            { type: 'text', text: "I'll save that for you. " },
            { type: 'tool-call', toolCallId: 'tc-write' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
  });

  it('hides the indicator once the message is no longer streaming (status flips to complete)', () => {
    // Final guard: the indicator's only gate is `status ===
    // 'streaming'`. When the model finishes the turn — whether
    // mid-text or post-tool — the bubble loses its activity cue.
    render(
      <ChatMessage
        message={msg({
          status: 'complete',
          content: "I'll save that. Done!",
          toolCalls: [
            {
              toolCallId: 'tc-write',
              toolName: 'write_file',
              arguments: {},
              status: 'succeeded',
              result: { ok: true },
            },
          ],
          segments: [
            { type: 'text', text: "I'll save that. " },
            { type: 'tool-call', toolCallId: 'tc-write' },
            { type: 'text', text: 'Done!' },
          ],
        })}
      />,
    );
    expect(screen.queryByTestId('thinking-indicator')).toBeNull();
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

  it('renders the upstream errorMessage detail under the translated code (P8 polish)', () => {
    // Regression for the Ollama smoke: the user saw "Connection
    // failed." with no inner detail. The translated code stays for
    // the headline, but the upstream "gemma3:4b does not support
    // tools" line now appears below it so the user can act on it.
    render(
      <ChatMessage
        message={msg({
          status: 'failed',
          content: '',
          errorCode: 'model_unsupported_tools',
          errorMessage:
            'registry.ollama.ai/library/gemma3:4b does not support tools',
        })}
      />,
    );
    expect(
      screen.getByText('assistant-settings:error_model_unsupported_tools'),
    ).toBeInTheDocument();
    const detail = screen.getByTestId('chat-message-error-detail');
    expect(detail.textContent).toContain('does not support tools');
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

  // ----- P6 polish: segment-ordered interleaving ---------------------

  it('renders text and tool-call segments in emission order (regression for concatenated text + cards-below)', async () => {
    // Before P6 polish, two text streams that bracketed a tool call
    // (text1 → tool → text2) collapsed into one concatenated content
    // block with all tool cards dumped below. The new `segments`
    // array preserves emission order so text appears above AND below
    // its tool cards.
    const tc = (id: string, name: string): ToolInvocation => ({
      toolCallId: id,
      toolName: name,
      arguments: {},
      status: 'succeeded',
    });
    render(
      <ChatMessage
        message={msg({
          id: 'a-segs',
          status: 'complete',
          content: 'before-toolafter-tool', // legacy field — not used when segments is set
          toolCalls: [tc('tc-1', 'create_file')],
          segments: [
            { type: 'text', text: 'before-tool' },
            { type: 'tool-call', toolCallId: 'tc-1' },
            { type: 'text', text: 'after-tool' },
          ],
        })}
      />,
    );
    await waitFor(() => {
      const container = screen.getByTestId('assistant-segments');
      expect(container).toBeInTheDocument();
    });
    // The legacy tool-call-list container is NOT rendered when
    // segments is present — the cards live inline in the segment row.
    expect(screen.queryByTestId('tool-call-list')).toBeNull();
    const container = screen.getByTestId('assistant-segments');
    // Children appear in segment order: text → tool card → text.
    const kids = Array.from(container.children) as HTMLElement[];
    expect(kids).toHaveLength(3);
    expect(kids[0].textContent).toContain('before-tool');
    expect(kids[1].getAttribute('data-testid')).toBe('tool-call-tc-1');
    expect(kids[2].textContent).toContain('after-tool');
  });

  it('skips empty text segments and missing tool-call refs gracefully', () => {
    render(
      <ChatMessage
        message={msg({
          id: 'a-skip',
          status: 'complete',
          content: 'visible',
          toolCalls: [], // no entries — the tool-call segment below is orphaned
          segments: [
            { type: 'text', text: '' }, // empty → skipped
            { type: 'tool-call', toolCallId: 'tc-orphan' }, // no matching toolCall → skipped
            { type: 'text', text: 'visible' },
          ],
        })}
      />,
    );
    const container = screen.getByTestId('assistant-segments');
    expect(container.textContent).toContain('visible');
    // No tool card rendered for the orphaned segment.
    expect(screen.queryByTestId('tool-call-tc-orphan')).toBeNull();
  });
});
