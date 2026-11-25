/** @jest-environment node */
import { renderChatGptCallbackPage } from '../src/app/lib/ChatGptCallbackPage';
import { callbackCopy } from './fixtures/chatgptCallbackCopy';

test('renders translated permission guidance and shared light/dark palettes', () => {
  const page = renderChatGptCallbackPage(
    {
      ...callbackCopy,
      language: 'de',
      permissionTitle: 'Tarifzugriff erforderlich',
    },
    'permission',
    'nonce',
  );
  expect(page).toContain('<html lang="de">');
  expect(page).toContain('Tarifzugriff erforderlich');
  expect(page).toContain('prefers-color-scheme: dark');
  expect(page).not.toContain(callbackCopy.successTitle);
});

test('escapes callback copy and does not load remote resources', () => {
  const page = renderChatGptCallbackPage(
    {
      ...callbackCopy,
      successTitle: '<img src=x onerror=alert(1)>',
      returnToApp: '<script>alert(1)</script>',
    },
    'success',
    'nonce',
  );
  expect(page).toContain('&lt;img');
  expect(page).not.toContain('<img');
  expect(page).not.toContain('<script>alert');
  expect(page).not.toMatch(/<[a-z][^>]*\s(?:src|href)\s*=/i);
});
