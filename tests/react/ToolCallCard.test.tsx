/**
 * ToolCallCard (AI Assistant P5) unit tests.
 *
 * Stateless component driven entirely by the `invocation` prop. We
 * walk each `status` and assert: the data attribute, the badge
 * label, and the expand-to-show args/result/error contents.
 */

import * as React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';

import { ToolCallCard } from '../../src/browser/react/components/assistant/ToolCallCard';
import type { ToolInvocation } from '../../src/app/interfaces/Assistant';
import { renderWithProviders } from '../utils/render';

// P8: ToolCallCard now reads useAssistantChat() (for the retry
// button's manager / activeConversation context). Tests use
// renderWithProviders so the full context tree is mounted; the
// default fake AssistantManager covers the chat snapshot the
// retry-button gate consults.
const render: typeof renderWithProviders = (ui, options) =>
  renderWithProviders(ui, options);

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  normalizeLanguage: (lng: string) => lng,
  whenLanguageReady: () => Promise.resolve(),
  getAvailableLocales: jest.fn(async () => []),
  initI18n: jest.fn(),
  changeLanguage: jest.fn(),
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
    expect(
      within(card).getByText('assistant-tools:args_label'),
    ).toBeInTheDocument();
    // Result block also shown.
    expect(
      within(card).getByText('assistant-tools:result_label'),
    ).toBeInTheDocument();
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

/* ---------- Inline confirmation rendering --------------------------- */

// The InlineDiffPreview component would otherwise need a full Monaco
// mount per render here, which doesn't add value for testing the card's
// routing logic. Stub it; we test InlineDiffPreview's own behaviour in
// its dedicated spec. InsertPreview stays unmocked — it's a pure
// <pre> and asserting against its DOM is useful.
jest.mock(
  '../../src/browser/react/components/assistant/InlineDiffPreview',
  () => ({
    InlineDiffPreview: (props: {
      original: string;
      modified: string;
      fetchFullOriginal?: () => Promise<string>;
      fetchFullModified?: () => Promise<string>;
      onPopOut?: (s: { original: string; modified: string }) => void;
    }) => (
      <div
        data-testid="inline-diff-preview-stub"
        data-original={props.original}
        data-modified={props.modified}
        data-has-fetch-original={props.fetchFullOriginal !== undefined}
        data-has-fetch-modified={props.fetchFullModified !== undefined}
        data-has-pop-out={props.onPopOut !== undefined}
      >
        {props.onPopOut && (
          <button
            type="button"
            data-testid="inline-diff-pop-out-stub"
            onClick={() =>
              props.onPopOut!({
                original: props.original,
                modified: props.modified,
              })
            }
          />
        )}
      </div>
    ),
  }),
);

describe('<ToolCallCard> inline confirmation', () => {
  function pendingInvocation(
    overrides: Partial<ToolInvocation> = {},
  ): ToolInvocation {
    return {
      toolCallId: 'tc-pending',
      toolName: 'write_file',
      arguments: { path: '/a.md', content: 'NEW CONTENT' },
      status: 'pending-confirm',
      ...overrides,
    };
  }

  function pendingChatSnapshot(pendingConfirm: {
    toolCallId: string;
    toolName: string;
    callId: string;
    preview: ToolInvocation['arguments'] extends infer A
      ? {
          kind: 'edit' | 'write' | 'create' | 'replace' | 'insert';
          path?: string;
          before?: string;
          after: string;
          detail?: string;
        } | null
      : never;
  }) {
    return {
      conversations: { anthropic: [], openai: [], ollama: [] },
      activeConversation: { anthropic: null, openai: null, ollama: null },
      drafts: {},
      inflight: {},
      pendingConfirms: { [pendingConfirm.toolCallId]: pendingConfirm },
    } as Parameters<
      ReturnType<
        typeof import('../utils/render').fakeAssistantManager
      >['_setChatSnapshot']
    >[0];
  }

  it('renders the InlineDiffPreview for write/edit/replace kinds', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'write_file',
        callId: 'chat-1',
        preview: {
          kind: 'write',
          path: '/a.md',
          before: 'OLD',
          after: 'NEW CONTENT',
        },
      }),
    });
    render(<ToolCallCard invocation={pendingInvocation()} />, {
      managers: { assistantManager: am },
    });
    const stub = screen.getByTestId('inline-diff-preview-stub');
    expect(stub.dataset.original).toBe('OLD');
    expect(stub.dataset.modified).toBe('NEW CONTENT');
    // write_file: original-fetch wires to disk via the path; modified
    // fetch resolves args.content synchronously.
    expect(stub.dataset.hasFetchOriginal).toBe('true');
    expect(stub.dataset.hasFetchModified).toBe('true');
  });

  it('renders the InsertPreview for insert/create kinds', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'create_file',
        callId: 'chat-1',
        preview: {
          kind: 'create',
          path: '/new.md',
          after: '# Hello',
        },
      }),
    });
    render(
      <ToolCallCard
        invocation={pendingInvocation({
          toolName: 'create_file',
          arguments: { parent: '/', name: 'new.md', content: '# Hello' },
        })}
      />,
      { managers: { assistantManager: am } },
    );
    expect(screen.getByTestId('insert-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-diff-preview-stub')).toBeNull();
  });

  it('Accept button calls manager.respondToConfirm(toolCallId, true)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'insert_at_cursor',
        callId: 'chat-1',
        preview: {
          kind: 'insert',
          after: 'snippet',
        },
      }),
    });
    render(
      <ToolCallCard
        invocation={pendingInvocation({
          toolName: 'insert_at_cursor',
          arguments: { content: 'snippet' },
        })}
      />,
      { managers: { assistantManager: am } },
    );
    fireEvent.click(screen.getByTestId('tool-call-accept-tc-pending'));
    expect(am.respondToConfirm).toHaveBeenCalledWith('tc-pending', true);
  });

  it('Reject button calls manager.respondToConfirm(toolCallId, false)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'insert_at_cursor',
        callId: 'chat-1',
        preview: { kind: 'insert', after: 'snippet' },
      }),
    });
    render(
      <ToolCallCard
        invocation={pendingInvocation({
          toolName: 'insert_at_cursor',
          arguments: { content: 'snippet' },
        })}
      />,
      { managers: { assistantManager: am } },
    );
    fireEvent.click(screen.getByTestId('tool-call-reject-tc-pending'));
    expect(am.respondToConfirm).toHaveBeenCalledWith('tc-pending', false);
  });

  it('does NOT render the inline confirmation when no pendingConfirms entry exists for this toolCallId', () => {
    // Pending-confirm status but the snapshot has no matching entry —
    // can happen mid-cleanup (e.g. cancelCall just fired and the entry
    // was dropped before this card unmounted). The card should fall
    // back to the simple muted styling, no Accept/Reject row.
    render(<ToolCallCard invocation={pendingInvocation()} />);
    expect(screen.queryByTestId('tool-call-accept-tc-pending')).toBeNull();
    expect(screen.queryByTestId('tool-call-reject-tc-pending')).toBeNull();
    expect(screen.queryByTestId('inline-diff-preview-stub')).toBeNull();
    expect(screen.queryByTestId('insert-preview')).toBeNull();
  });

  it('does NOT render the inline confirmation when status is not pending-confirm', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'write_file',
        callId: 'chat-1',
        preview: { kind: 'write', path: '/x', after: 'a' },
      }),
    });
    render(
      <ToolCallCard invocation={pendingInvocation({ status: 'succeeded' })} />,
      { managers: { assistantManager: am } },
    );
    expect(screen.queryByTestId('inline-diff-preview-stub')).toBeNull();
  });

  it('clicking pop-out forwards the visible content to fileManager.openDiffTab', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeAssistantManager } = require('../utils/render');
    const am = fakeAssistantManager({
      initialChatSnapshot: pendingChatSnapshot({
        toolCallId: 'tc-pending',
        toolName: 'write_file',
        callId: 'chat-1',
        preview: {
          kind: 'write',
          path: '/abs/README.md',
          before: 'OLD',
          after: 'NEW CONTENT',
        },
      }),
    });
    // FilesContext.useSyncExternalStore requires getSnapshot to return
    // a STABLE reference between emits — returning a fresh object
    // would loop React forever. Cache once.
    const filesSnap = { tabs: [], activeFile: null };
    const fileManager = {
      // Only the methods <ToolCallCard> reaches for. Other FileManager
      // surface stays absent to keep the failure mode loud if we
      // accidentally reach for something else.
      openDiffTab: jest.fn(),
      on: jest.fn(() => () => {}),
      getSnapshot: jest.fn(() => filesSnap),
    };
    render(<ToolCallCard invocation={pendingInvocation()} />, {
      managers: {
        assistantManager: am,
        fileManager: fileManager as never,
      },
    });
    fireEvent.click(screen.getByTestId('inline-diff-pop-out-stub'));
    expect(fileManager.openDiffTab).toHaveBeenCalledTimes(1);
    const call = fileManager.openDiffTab.mock.calls[0][0];
    expect(call.id).toBe('diff://tc-pending');
    // Tab name derives from the basename of preview.path.
    expect(call.name).toBe('Δ README.md');
    expect(call.original).toBe('OLD');
    expect(call.modified).toBe('NEW CONTENT');
    expect(call.sourcePath).toBe('/abs/README.md');
  });
});
