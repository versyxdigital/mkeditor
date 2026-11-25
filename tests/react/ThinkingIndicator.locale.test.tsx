import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { ChatMessage } from '../../src/browser/react/components/assistant/ChatMessage';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => i18next.t(key),

  normalizeLanguage: (language: string) => language,
}));
jest.mock('../../src/browser/core/Markdown', () => ({
  renderAssistantMarkdown: (text: string) => text,
}));

it('refreshes translated thinking words and keeps the index valid when the next locale has fewer words', async () => {
  await i18next.init({
    lng: 'en',
    initAsync: false,
    resources: {
      en: {
        'assistant-chat': {
          thinking_gerunds: 'Thinking|Planning|Working',
          streaming: 'Streaming',
        },
      },
      de: {
        'assistant-chat': { thinking_gerunds: 'Denken', streaming: 'Antwort' },
      },
    },
  });
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.9);
  try {
    render(
      <ChatMessage
        message={{
          id: 'message',
          role: 'assistant',
          content: '',
          status: 'streaming',
          createdAt: 1,
        }}
      />,
    );
    expect(screen.getByTestId('thinking-indicator')).toHaveTextContent(
      'Working',
    );
    await act(async () => {
      await i18next.changeLanguage('de');
    });
    expect(screen.getByLabelText('Antwort')).toHaveTextContent('Denken');
  } finally {
    random.mockRestore();
  }
});
