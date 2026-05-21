/**
 * <InsertPreview> unit tests.
 *
 * The component is intentionally small — a single green block for
 * pure-addition previews (`insert_at_cursor`, `create_file`). Tests
 * verify it renders the content, surfaces the optional detail line,
 * and applies the maxHeight cap to the scroll container.
 */

import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../src/browser/react/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

import { InsertPreview } from '../../src/browser/react/components/assistant/InsertPreview';
import { PREVIEW_TRUNCATION_MARKER } from '../../src/browser/core/AssistantTools';

describe('<InsertPreview>', () => {
  it('renders the content verbatim inside a scrollable block', () => {
    const content = '# Hello\n\nWorld';
    render(<InsertPreview content={content} />);
    expect(screen.getByTestId('insert-preview')).toBeInTheDocument();
    // `getByText` normalises whitespace by default — assert against the
    // raw text content of the <pre> so the newlines aren't collapsed.
    const pre = screen
      .getByTestId('insert-preview')
      .querySelector('pre') as HTMLPreElement;
    expect(pre.textContent).toBe(content);
  });

  it('renders the "after" label so the user knows it is the new content', () => {
    render(<InsertPreview content="anything" />);
    // The hook mock returns keys verbatim — assert against the key.
    expect(
      screen.getByText('assistant-tools:preview_after'),
    ).toBeInTheDocument();
  });

  it('renders the optional detail line when provided', () => {
    render(<InsertPreview content="x" detail="Insert at line 42 column 7" />);
    expect(screen.getByText('Insert at line 42 column 7')).toBeInTheDocument();
  });

  it('omits the detail span when none is provided', () => {
    render(<InsertPreview content="x" />);
    const container = screen.getByTestId('insert-preview');
    // Only one span (the "After" label). Detail span absent.
    expect(container.querySelectorAll('span')).toHaveLength(1);
  });

  it('applies the maxHeight cap to the pre block', () => {
    render(<InsertPreview content="x" maxHeight={120} />);
    const pre = screen
      .getByTestId('insert-preview')
      .querySelector('pre') as HTMLPreElement;
    expect(pre.style.maxHeight).toBe('120px');
  });

  it('defaults maxHeight to 240px when unspecified', () => {
    render(<InsertPreview content="x" />);
    const pre = screen
      .getByTestId('insert-preview')
      .querySelector('pre') as HTMLPreElement;
    expect(pre.style.maxHeight).toBe('240px');
  });

  it('shows no expander when content is not truncated, even with a fetcher', () => {
    render(
      <InsertPreview
        content="short"
        fetchFull={() => Promise.resolve('full')}
      />,
    );
    expect(screen.queryByTestId('insert-preview-toggle')).toBeNull();
  });

  it('shows no expander when content is truncated but no fetcher was supplied', () => {
    render(<InsertPreview content={`head${PREVIEW_TRUNCATION_MARKER}`} />);
    expect(screen.queryByTestId('insert-preview-toggle')).toBeNull();
  });

  it('shows the expander and swaps in the full content on click when truncated + fetcher supplied', async () => {
    const truncated = `head${PREVIEW_TRUNCATION_MARKER}`;
    const fetchFull = jest.fn(() => Promise.resolve('head + tail'));
    render(<InsertPreview content={truncated} fetchFull={fetchFull} />);

    const toggle = screen.getByTestId('insert-preview-toggle');
    expect(toggle.textContent).toBe('assistant-tools:preview_show_full');

    await act(async () => {
      toggle.click();
    });

    await waitFor(() => expect(fetchFull).toHaveBeenCalledTimes(1));
    const pre = screen
      .getByTestId('insert-preview')
      .querySelector('pre') as HTMLPreElement;
    expect(pre.textContent).toBe('head + tail');
    expect(screen.getByTestId('insert-preview-toggle').textContent).toBe(
      'assistant-tools:preview_show_less',
    );
  });

  it('surfaces a fetcher error with a Retry button', async () => {
    const truncated = `head${PREVIEW_TRUNCATION_MARKER}`;
    let calls = 0;
    const fetchFull = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('disk error');
      return 'eventually full';
    });
    render(<InsertPreview content={truncated} fetchFull={fetchFull} />);

    await act(async () => {
      screen.getByTestId('insert-preview-toggle').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('insert-preview-error').textContent).toBe(
        'disk error',
      ),
    );
    expect(screen.getByTestId('insert-preview-toggle').textContent).toBe(
      'assistant-tools:preview_retry',
    );

    // Retry — succeeds.
    await act(async () => {
      screen.getByTestId('insert-preview-toggle').click();
    });
    await waitFor(() => expect(fetchFull).toHaveBeenCalledTimes(2));
    const pre = screen
      .getByTestId('insert-preview')
      .querySelector('pre') as HTMLPreElement;
    expect(pre.textContent).toBe('eventually full');
  });
});
