import type { CloudProviderId } from '../../../app/interfaces/Cloud';
import type { CloudTokens } from '../../../app/lib/cloud/CloudProvider';
import { CloudError } from '../../../app/lib/cloud/CloudError';
import {
  defaultWebCloudConfig,
  webCloudClientId,
  type WebCloudConfig,
} from './WebCloudConfig';

export { defaultWebCloudConfig, type WebCloudConfig } from './WebCloudConfig';

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  state: string;
  include_granted_scopes: boolean;
  prompt: string;
  callback: (response: unknown) => void;
  error_callback: (error: { type?: string }) => void;
}

interface GoogleOAuth {
  initTokenClient(config: GoogleTokenClientConfig): {
    requestAccessToken(): void;
  };
}

const googleOAuth = (): GoogleOAuth | undefined =>
  (window as Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } })
    .google?.accounts?.oauth2;

let googleLibrary: Promise<void> | undefined;

/** Load Google's maintained browser client directly, only in a configured web runtime. */
function loadGoogleLibrary(): Promise<void> {
  if (googleOAuth()) return Promise.resolve();
  if (googleLibrary) return googleLibrary;
  googleLibrary = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (loaded && googleOAuth()) resolve();
      else {
        script.remove();
        reject(new CloudError('network'));
      }
    };
    const timer = setTimeout(() => finish(false), 20_000);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  }).catch((error: unknown) => {
    googleLibrary = undefined;
    throw error;
  });
  return googleLibrary;
}

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomValue = (): string =>
  base64url(crypto.getRandomValues(new Uint8Array(32)));

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CloudError('auth');
  return value as Record<string, unknown>;
}

/** Intentionally discard refresh_token even if a provider unexpectedly returns one. */
function parseToken(value: unknown, requested: readonly string[]): CloudTokens {
  const data = record(value);
  if (data.error)
    throw new CloudError(data.error === 'access_denied' ? 'cancelled' : 'auth');
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    data.access_token.length > 16_384 ||
    typeof data.token_type !== 'string' ||
    data.token_type.toLowerCase() !== 'bearer' ||
    !['number', 'string'].includes(typeof data.expires_in) ||
    !Number.isFinite(Number(data.expires_in)) ||
    Number(data.expires_in) <= 60 ||
    Number(data.expires_in) > 86_400 ||
    typeof data.scope !== 'string'
  )
    throw new CloudError('auth');
  const scopes = data.scope.split(/\s+/).filter(Boolean);
  // Google may consolidate overlapping grants into the broader Drive scope.
  if (
    !requested.every(
      (scope) =>
        scopes.includes(scope) ||
        (scope === 'https://www.googleapis.com/auth/drive.readonly' &&
          scopes.includes('https://www.googleapis.com/auth/drive')),
    )
  )
    throw new CloudError('permission');
  return {
    access: data.access_token,
    refresh: '',
    expires: Date.now() + Number(data.expires_in) * 1000,
    scopes,
  };
}

export interface WebAuthorization {
  result: Promise<CloudTokens>;
  cancel: () => void;
}

/** Interactive authorization only. The cloud service owns per-connection memory tokens. */
export class WebCloudAuth {
  private flows = new Set<() => void>();
  private reservations: { popup: Window | null; release: () => void }[] = [];
  private disposed = false;

  constructor(
    private readonly config: WebCloudConfig = defaultWebCloudConfig,
    private readonly options: { timeoutMs?: number } = {},
  ) {}

  configured(provider: CloudProviderId): boolean {
    return Boolean(webCloudClientId(this.config, provider));
  }

  registration(provider: CloudProviderId): {
    clientId: string;
    clientValue: '';
  } {
    return {
      clientId: webCloudClientId(this.config, provider),
      clientValue: '',
    };
  }

  /** Start early so requestAccessToken can run directly in a later user gesture. */
  prepare(): Promise<void> {
    return this.configured('google-drive')
      ? loadGoogleLibrary()
      : Promise.resolve();
  }

  /** Called in the original click before a service queues or awaits persistence. */
  reserveAuthorization(provider: CloudProviderId): () => void {
    if (provider !== 'dropbox' || this.disposed || !this.configured(provider))
      return () => {};
    const reservation = {
      popup: window.open('about:blank', '_blank', 'popup,width=520,height=720'),
      release: () => {},
    };
    reservation.release = () => {
      const index = this.reservations.indexOf(reservation);
      if (index < 0) return;
      this.reservations.splice(index, 1);
      reservation.popup?.close();
    };
    this.reservations.push(reservation);
    return reservation.release;
  }

  beginAuthorization(
    provider: CloudProviderId,
    scopes: readonly string[],
  ): WebAuthorization {
    let resolve!: (tokens: CloudTokens) => void;
    let reject!: (error: CloudError) => void;
    let settled = false;
    let cleanup = () => {};
    const result = new Promise<CloudTokens>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    // Desktop-compatible consumers attach after awaiting beginAuthorization.
    void result.catch(() => {});
    const finish = (error?: CloudError, tokens?: CloudTokens) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      this.flows.delete(cancel);
      if (error) reject(error);
      else if (tokens) resolve(tokens);
    };

    const cancel = () => finish(new CloudError('cancelled'));
    const timer = setTimeout(cancel, this.options.timeoutMs ?? 180_000);
    this.flows.add(cancel);
    try {
      const location = new URL(window.location.href);
      if (
        this.disposed ||
        !this.configured(provider) ||
        !scopes.length ||
        !(
          location.protocol === 'https:' ||
          (location.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
        )
      )
        throw new CloudError('configuration');
      const state = randomValue();
      if (provider === 'google-drive') {
        const start = () => {
          if (settled) return;
          const oauth = googleOAuth();
          if (!oauth) throw new CloudError('network');
          const client = oauth.initTokenClient({
            client_id: this.registration(provider).clientId,
            scope: scopes.join(' '),
            state,
            include_granted_scopes: false,
            prompt: 'select_account',
            callback: (response) => {
              if (settled) return;
              try {
                if (record(response).state !== state)
                  throw new CloudError('auth');
                finish(undefined, parseToken(response, scopes));
              } catch (error) {
                finish(
                  error instanceof CloudError ? error : new CloudError('auth'),
                );
              }
            },

            error_callback: (error) =>
              finish(
                new CloudError(
                  error.type === 'popup_closed' ? 'cancelled' : 'auth',
                ),
              ),
          });
          client.requestAccessToken();
        };
        if (googleOAuth()) start();
        else
          void loadGoogleLibrary()
            .then(start)
            .catch(() => finish(new CloudError('network')));
      } else {
        const callback = new URL('cloud-callback.html', document.baseURI);
        if (
          callback.origin !== location.origin ||
          callback.search ||
          callback.hash
        )
          throw new CloudError('configuration');
        // Reserve the popup before awaiting WebCrypto; preserve the click gesture.
        const reservation = this.reservations.shift();
        const popup = reservation
          ? reservation.popup
          : window.open('about:blank', '_blank', 'popup,width=520,height=720');
        if (!popup) throw new CloudError('auth');
        if (popup.closed) throw new CloudError('cancelled');
        const controller = new AbortController();
        let received = false;
        const closed = setInterval(() => {
          if (!received && popup.closed) cancel();
        }, 250);
        const onMessage = (event: MessageEvent<unknown>) => {
          if (
            settled ||
            received ||
            event.origin !== location.origin ||
            event.source !== popup
          )
            return;
          let data: Record<string, unknown>;
          let response: URL;
          try {
            data = record(event.data);
            if (
              data.type !== 'mkeditor-cloud-oauth' ||
              typeof data.url !== 'string' ||
              data.url.length > 16_384
            )
              return;
            response = new URL(data.url);
          } catch {
            return;
          }
          const values = response.searchParams;
          if (
            response.origin !== callback.origin ||
            response.pathname !== callback.pathname ||
            response.username ||
            response.password ||
            response.hash ||
            values.getAll('state').length !== 1 ||
            values.get('state') !== state ||
            !(
              (values.getAll('code').length === 1 &&
                Boolean(values.get('code')) &&
                values.get('code')!.length <= 4096 &&
                !values.has('error')) ||
              (values.getAll('error').length === 1 &&
                Boolean(values.get('error')) &&
                !values.has('code'))
            )
          )
            return;
          received = true;
          popup.close();
          if (values.has('error')) {
            finish(
              new CloudError(
                values.get('error') === 'access_denied' ? 'cancelled' : 'auth',
              ),
            );
            return;
          }
          void fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: this.registration(provider).clientId,
              code: values.get('code')!,
              code_verifier: verifier,
              redirect_uri: callback.href,
            }),
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
          })
            .then(async (reply) => {
              if (!reply.ok) throw new CloudError('auth');
              const tokens = parseToken(await reply.json(), scopes);
              finish(undefined, tokens);
            })
            .catch((error: unknown) => {
              finish(
                error instanceof CloudError ? error : new CloudError('network'),
              );
            });
        };
        window.addEventListener('message', onMessage);
        cleanup = () => {
          clearInterval(closed);
          window.removeEventListener('message', onMessage);
          controller.abort();
          if (!popup.closed) popup.close();
        };
        const verifier = randomValue();
        void crypto.subtle
          .digest('SHA-256', new TextEncoder().encode(verifier))
          .then((digest) => {
            if (settled) return;
            const url = new URL('https://www.dropbox.com/oauth2/authorize');
            url.search = new URLSearchParams({
              client_id: this.registration(provider).clientId,
              redirect_uri: callback.href,
              response_type: 'code',
              token_access_type: 'online',
              scope: scopes.join(' '),
              state,
              code_challenge: base64url(new Uint8Array(digest)),
              code_challenge_method: 'S256',
            }).toString();
            popup.location.href = url.href;
          })
          .catch(() => finish(new CloudError('network')));
      }
    } catch (error) {
      finish(error instanceof CloudError ? error : new CloudError('auth'));
    }
    return { result, cancel };
  }

  dispose(): void {
    this.disposed = true;
    for (const reservation of [...this.reservations]) reservation.release();
    for (const cancel of this.flows) cancel();
  }
}
