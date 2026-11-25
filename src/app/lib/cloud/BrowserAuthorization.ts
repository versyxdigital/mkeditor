import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import type { CloudCallbackCopy } from '../../interfaces/Cloud';
import type { CloudTokens } from './CloudProvider';
import { CloudError } from './CloudError';

/** One-shot loopback OAuth/PKCE, shared by the desktop providers. */
export async function beginBrowserAuthorization({
  authorizeUrl,
  parameters,
  exchange,
  openBrowser,
  port = 0,
  timeoutMs = 180_000,
  copy = defaultCopy,
}: {
  authorizeUrl: string;
  parameters: Record<string, string>;
  exchange: (form: Record<string, string>) => Promise<CloudTokens>;
  openBrowser: (url: string) => Promise<void>;
  port?: number;
  timeoutMs?: number;
  copy?: CloudCallbackCopy;
}): Promise<{ result: Promise<CloudTokens>; cancel: () => void }> {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  let settled = false;
  let rejectFlow!: (reason: CloudError) => void;
  let resolveFlow!: (value: CloudTokens) => void;
  const result = new Promise<CloudTokens>((resolve, reject) => {
    resolveFlow = resolve;
    rejectFlow = reject;
  });
  // Callers attach immediately after this method returns; browser launch can fail earlier.
  void result.catch(() => {});
  const cancel = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server?.close();
    server?.closeAllConnections();
    rejectFlow(new CloudError('cancelled'));
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const values = url.searchParams;
    const provided = values.get('state') ?? '';
    const valid =
      request.method === 'GET' &&
      url.pathname === '/oauth/callback' &&
      values.getAll('state').length === 1 &&
      Buffer.byteLength(provided) === Buffer.byteLength(state) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(state)) &&
      ((values.getAll('code').length === 1 &&
        Boolean(values.get('code')) &&
        values.get('code')!.length <= 4096 &&
        !values.has('error')) ||
        (values.getAll('error').length === 1 &&
          Boolean(values.get('error')) &&
          !values.has('code')));
    if (settled || !valid) {
      response.writeHead(400, {
        'Content-Type': 'text/plain; charset=utf-8',
        Connection: 'close',
        'Cache-Control': 'no-store',
      });
      response.end(copy.invalid);
      return;
    }
    settled = true;
    clearTimeout(timer);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      Connection: 'close',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(callbackPage(!values.has('error'), copy));
    server.close();
    if (values.has('error')) {
      rejectFlow(new CloudError('cancelled'));
      return;
    }
    void exchange({
      grant_type: 'authorization_code',
      code: values.get('code')!,
      redirect_uri: redirect,
      code_verifier: verifier,
    }).then(resolveFlow, rejectFlow);
  });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
  } catch {
    cancel();
    throw new CloudError('network');
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    cancel();
    throw new CloudError('network');
  }
  const redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({
    ...parameters,
    redirect_uri: redirect,
    response_type: 'code',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  try {
    await openBrowser(url.toString());
  } catch {
    cancel();
    throw new CloudError('network');
  }
  return { result, cancel };
}

const defaultCopy: CloudCallbackCopy = {
  title: 'Return to MKEditor',
  accepted:
    'Your browser has returned the sign-in response. MKEditor will confirm when your connection is ready.',
  cancelled: 'Sign-in cancelled.',
  close: 'You can close this tab.',
  invalid:
    'Invalid or expired sign-in request. Return to MKEditor and try again.',
};
function callbackPage(accepted: boolean, copy: CloudCallbackCopy): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MKEditor</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#f5f6f8,#181a1d);color:light-dark(#262a30,#e6e8eb);font:16px system-ui}main{max-width:28rem;padding:2rem}h1{font-size:1.5rem}p{line-height:1.6;opacity:.8}strong{color:light-dark(#28766a,#83bdb1)}</style><main><strong>MKEditor</strong><h1>${escape(copy.title)}</h1><p>${escape(accepted ? copy.accepted : copy.cancelled)}</p><p>${escape(copy.close)}</p></main><script>history.replaceState(null,'','/oauth/callback')</script></html>`;
}
