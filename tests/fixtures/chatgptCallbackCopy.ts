import en from '../../locale/en/chatgpt.json';
import type { ChatGptCallbackCopy } from '../../src/app/interfaces/ChatGpt';

export const callbackCopy: ChatGptCallbackCopy = {
  language: 'en',
  successTitle: en.callback_success_title,
  successBody: en.callback_success_body,
  errorTitle: en.callback_error_title,
  errorBody: en.callback_error_body,
  permissionTitle: en.callback_permission_title,
  permissionBody: en.callback_permission_body,
  returnToApp: en.callback_return,
};
