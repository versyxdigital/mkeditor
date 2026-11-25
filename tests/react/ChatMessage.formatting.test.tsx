import * as React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ChatMessage } from '../../src/browser/react/components/assistant/ChatMessage';
import { renderWithProviders } from '../utils/render';
import { sonnerToast } from '../../src/browser/notify';
import { renderAssistantDiagrams } from '../../src/browser/react/lib/assistantDiagrams';
import type { UiChatMessage } from '../../src/app/interfaces/Assistant';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,

  normalizeLanguage: () => 'en',
}));
jest.mock('../../src/browser/notify', () => ({
  ...jest.requireActual('../../src/browser/notify'),
  sonnerToast: jest.fn(),
}));
jest.mock('../../src/browser/react/lib/assistantDiagrams', () => ({
  renderAssistantDiagrams: jest.fn(async () => {}),
}));

function message(
  content: string,
  status: UiChatMessage['status'] = 'complete',
): UiChatMessage {
  return { id: 'formatting', role: 'assistant', content, status, createdAt: 1 };
}
const clipboard = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
});

test('copies the original Unicode source without the language header or syntax markup', async () => {
  renderWithProviders(
    <ChatMessage
      message={message('```js\nconsole.log("café 日本語 😀");\n```')}
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'assistant-chat:copy_code' }),
  );
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith('console.log("café 日本語 😀");\n'),
  );
  expect(sonnerToast).toHaveBeenCalledWith('success', 'navbar:code_copied');
  expect(document.querySelector('.assistant-markdown pre')).toHaveAttribute(
    'tabindex',
    '0',
  );
});

test('reports clipboard failure without modifying the code', async () => {
  clipboard.mockRejectedValue(new Error('denied'));
  renderWithProviders(
    <ChatMessage message={message('```text\nkeep this\n```')} />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'assistant-chat:copy_code' }),
  );
  await waitFor(() =>
    expect(sonnerToast).toHaveBeenCalledWith(
      'error',
      'assistant-chat:copy_failed',
    ),
  );
  expect(screen.getByText('keep this')).toBeInTheDocument();
});

test('fragment links scroll to and focus the heading inside their own message', async () => {
  const scroll = jest.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  renderWithProviders(
    <ChatMessage message={message('[Jump](#lists)\n\n## Lists\n\n- One')} />,
  );
  const heading = await screen.findByRole('heading', { name: 'Lists' });
  fireEvent.click(screen.getByRole('link', { name: 'Jump' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  expect(heading).toHaveFocus();
});

test('diagrams wait for streaming to finish and cancel their work on unmount', async () => {
  const content = '```mermaid\ngraph TD\nA --> B\n```';
  const view = renderWithProviders(
    <ChatMessage message={message(content, 'streaming')} />,
  );
  await screen.findByRole('button', { name: 'assistant-chat:copy_code' });
  expect(renderAssistantDiagrams).not.toHaveBeenCalled();
  view.rerender(<ChatMessage message={message(content)} />);
  await waitFor(() => expect(renderAssistantDiagrams).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(renderAssistantDiagrams).mock.calls[0][2];
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});
