import { randomBytes } from 'crypto';
import type { ServerResponse } from 'http';
import type { ChatGptCallbackCopy } from '../interfaces/ChatGpt';
import {
  lightPalette,
  darkPalette,
  paletteVariables,
  interfaceFont,
} from '../shared/designTokens';
import { isRecord } from './ChatGptStore';

export type ChatGptCallbackOutcome = 'success' | 'error' | 'permission';

export function isChatGptCallbackCopy(
  value: unknown,
): value is ChatGptCallbackCopy {
  const fields: Array<keyof ChatGptCallbackCopy> = [
    'language',
    'successTitle',
    'successBody',
    'errorTitle',
    'errorBody',
    'permissionTitle',
    'permissionBody',
    'returnToApp',
  ];
  return (
    isRecord(value) &&
    fields.every(
      (key) =>
        typeof value[key] === 'string' &&
        value[key].length > 0 &&
        value[key].length <= 2000,
    )
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

/** Self-contained callback: shared palette, no external assets or account data. */
export function renderChatGptCallbackPage(
  copy: ChatGptCallbackCopy,
  outcome: ChatGptCallbackOutcome,
  nonce: string,
): string {
  const title = copy[`${outcome}Title`];
  const body = copy[`${outcome}Body`];
  const language = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(copy.language)
    ? copy.language
    : 'en';
  const icon =
    outcome === 'success'
      ? '<path d="m7 12 3 3 7-7"/>'
      : '<path d="M12 7v6m0 4h.01"/>';
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · MKEditor</title>
<style nonce="${nonce}">
:root { ${paletteVariables(lightPalette)} color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { ${paletteVariables(darkPalette)} color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--bg-app); color: var(--text-primary); font-family: ${interfaceFont}; }
main { width: 100%; max-width: 440px; padding: 32px; border: 1px solid var(--border-default); border-radius: 10px; background: var(--bg-editor); }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; font-size: 14px; font-weight: 600; }
.mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; background: var(--accent-fill); color: var(--text-on-accent); }
.status { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 20px; border-radius: 50%; background: var(--accent-subtle); color: var(--accent-primary); }
h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.3; letter-spacing: -.025em; overflow-wrap: anywhere; }
p { margin: 0; font-size: 14px; line-height: 1.65; color: var(--text-secondary); overflow-wrap: anywhere; }
.return { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-subtle); }
@media (max-width: 380px) { body { padding: 16px; } main { padding: 24px; } }
</style>
</head>
<body>
<main aria-labelledby="result-title">
<div class="brand"><span class="mark" aria-hidden="true">M</span>MKEditor</div>
<div class="status" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div>
<h1 id="result-title">${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p class="return">${escapeHtml(copy.returnToApp)}</p>
</main>
<script nonce="${nonce}">history.replaceState(null, '', '/auth/complete');</script>
</body>
</html>`;
}

export function sendChatGptCallbackPage(
  response: ServerResponse,
  copy: ChatGptCallbackCopy,
  outcome: ChatGptCallbackOutcome,
  status = 200,
  finished?: () => void,
): void {
  if (response.destroyed || response.writableEnded) {
    finished?.();
    return;
  }
  const nonce = randomBytes(18).toString('base64url');
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  response.end(renderChatGptCallbackPage(copy, outcome, nonce), finished);
}
