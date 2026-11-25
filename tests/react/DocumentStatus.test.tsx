import * as React from 'react';
import { act } from '@testing-library/react';
import { DocumentStatus } from '../../src/browser/react/components/DocumentStatus';
import { renderWithProviders, fakeDispatcher } from '../utils/render';

it('keeps status counts current after moving them out of the navigation bar', () => {
  const host = document.createElement('div');
  host.id = 'document-status';
  document.body.appendChild(host);
  const dispatcher = fakeDispatcher();
  let value = 'Hello world';
  const { unmount } = renderWithProviders(<DocumentStatus />, {
    managers: {
      dispatcher: dispatcher as never,
      editorManager: { getValue: () => value } as never,
    },
  });
  expect(host.querySelector('#word-count')).toHaveTextContent('2');
  expect(host.querySelector('#character-count')).toHaveTextContent('11');
  act(() => {
    value = 'A longer document now';
    dispatcher.render();
  });
  expect(host.querySelector('#word-count')).toHaveTextContent('4');
  unmount();
  host.remove();
});
