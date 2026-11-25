import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import type { Server, ServerResponse } from 'http';
import { shell } from 'electron';
import { isRecord } from './ChatGptStore';
import type { ChatGptTokens } from './ChatGptStore';
import type { ChatGptCallbackCopy } from '../interfaces/ChatGpt';
import {
  sendChatGptCallbackPage,
  type ChatGptCallbackOutcome,
} from './ChatGptCallbackPage';

export const OPENAI_ISSUER = 'https://auth.openai.com';
export const OPENAI_RESOURCE = 'https://api.openai.com/v1';
const TOKEN_URL = `${OPENAI_ISSUER}/api/accounts/oauth/token`;
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;

export class ChatGptAuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function openaiDiscovery(): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${OPENAI_ISSUER}/.well-known/openid-configuration`,
    {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    },
  );
  const value: unknown = await response.json();
  if (!response.ok || !isRecord(value) || value.issuer !== OPENAI_ISSUER) {
    throw new ChatGptAuthError('sign_in_failed');
  }
  return value;
}

export function trustedAuthUrl(value: unknown): URL {
  if (typeof value !== 'string') throw new ChatGptAuthError('sign_in_failed');
  const url = new URL(value);
  if (url.origin !== OPENAI_ISSUER || url.username || url.password)
    throw new ChatGptAuthError('sign_in_failed');
  return url;
}

let keySet:
  ReturnType<(typeof import('jose'))['createRemoteJWKSet']> | undefined;

/** Keep JOSE lazy: only the main-process sign-in path loads it. */
export async function verifyChatGptIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
) {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  if (!keySet) {
    const discovery = await openaiDiscovery();
    keySet = createRemoteJWKSet(trustedAuthUrl(discovery.jwks_uri));
  }
  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: OPENAI_ISSUER,
    audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat'],
    clockTolerance: 5,
    algorithms: ['RS256'],
  });
  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    (nonce !== undefined && payload.nonce !== nonce) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== clientId)
  ) {
    throw new ChatGptAuthError('sign_in_failed');
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
  };
}

export async function exchangeChatGptTokens(
  parameters: Record<string, string>,
  previous?: ChatGptTokens,
  signal?: AbortSignal,
): Promise<ChatGptTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...parameters, resource: OPENAI_RESOURCE }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new ChatGptAuthError('sign_in_failed');
  if (!response.ok) {
    throw new ChatGptAuthError(
      typeof value.error === 'string' ? value.error : 'network_error',
    );
  }
  const refreshToken = value.refresh_token ?? previous?.refreshToken;
  const idToken = value.id_token ?? previous?.idToken;
  const scopes =
    typeof value.scope === 'string'
      ? value.scope.split(/\s+/)
      : previous?.scopes;
  if (
    value.token_type !== 'Bearer' ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    typeof refreshToken !== 'string' ||
    !refreshToken ||
    typeof idToken !== 'string' ||
    !idToken ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    !scopes
  ) {
    throw new ChatGptAuthError('sign_in_failed');
  }
  return {
    accessToken: value.access_token,
    refreshToken,
    idToken,
    scopes,
    expiresAt: Date.now() + value.expires_in * 1000,
  };
}

export function hasChatGptPermission(tokens: ChatGptTokens): boolean {
  return (
    tokens.scopes.includes(PLAN_SCOPE) &&
    tokens.scopes.includes('resource.invoke')
  );
}

export interface ChatGptLogin {
  result: Promise<{
    clientId: string;
    tokens: ChatGptTokens;
    subject: string;
    email: string;
  }>;
  cancel: () => void;
  /** Acknowledge credential persistence before showing browser success. */
  finish: (outcome: ChatGptCallbackOutcome) => void;
}

/** One loopback listener, state, nonce and PKCE verifier per explicit sign-in. */
export function startChatGptLogin(options: {
  hostId: string;
  clientId?: string;
  idTokenHint?: string;
  requestConsent?: boolean;
  page: ChatGptCallbackCopy;
}): ChatGptLogin {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const controller = new AbortController();
  let server: Server | undefined;
  let fail: (reason: unknown) => void;
  let consumed = false;
  let callbackResponse: ServerResponse | undefined;
  let finished = false;
  const result = new Promise<Awaited<ChatGptLogin['result']>>(
    (resolve, reject) => {
      fail = reject;
      server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Security-Policy', "default-src 'none'");
        const address = server?.address();
        if (!address || typeof address === 'string') {
          sendChatGptCallbackPage(response, options.page, 'error', 400);
          return;
        }
        const host = `127.0.0.1:${address.port}`;
        let url: URL;
        try {
          url = new URL(request.url ?? '/', `http://${host}`);
        } catch {
          sendChatGptCallbackPage(response, options.page, 'error', 400);
          return;
        }
        if (
          request.method !== 'GET' ||
          request.headers.host !== host ||
          url.pathname !== '/auth/callback' ||
          consumed
        ) {
          response.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get('state') ?? '';
        if (
          Buffer.byteLength(returnedState) !== Buffer.byteLength(state) ||
          !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state))
        ) {
          sendChatGptCallbackPage(response, options.page, 'error', 400);
          return;
        }
        consumed = true;
        callbackResponse = response;
        const error = url.searchParams.get('error');
        if (error) {
          reject(new ChatGptAuthError(error));
          return;
        }
        const clientId = url.searchParams.get('client_id') ?? options.clientId;
        const code = url.searchParams.get('code');
        if (
          !code ||
          !clientId ||
          clientId === 'dynamic_agent_client' ||
          (options.clientId && options.clientId !== clientId)
        ) {
          reject(new ChatGptAuthError('sign_in_failed'));
          return;
        }
        void (async () => {
          const tokens = await exchangeChatGptTokens(
            {
              grant_type: 'authorization_code',
              client_id: clientId,
              code,
              code_verifier: verifier,
              redirect_uri: `http://${host}/auth/callback`,
            },
            undefined,
            controller.signal,
          );
          const identity = await verifyChatGptIdentity(
            tokens.idToken,
            clientId,
            nonce,
          );
          if (controller.signal.aborted)
            throw new ChatGptAuthError('cancelled');
          resolve({ clientId, tokens, ...identity });
        })().catch(reject);
      });
      server.on('error', () => reject(new ChatGptAuthError('sign_in_failed')));
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (
          !address ||
          typeof address === 'string' ||
          controller.signal.aborted
        )
          return;
        const parameters = new URLSearchParams({
          client_id: options.clientId ?? 'dynamic_agent_client',
          ext_agent_host_id: options.hostId,
          response_type: 'code',
          redirect_uri: `http://127.0.0.1:${address.port}/auth/callback`,
          scope: SCOPES,
          resource: OPENAI_RESOURCE,
          state,
          nonce,
          code_challenge_method: 'S256',
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
        });
        if (!options.clientId) parameters.set('agent_name_hint', 'MKEditor');
        if (options.idTokenHint)
          parameters.set('id_token_hint', options.idTokenHint);
        if (options.requestConsent) parameters.set('prompt', 'consent');
        void shell
          .openExternal(`${OPENAI_ISSUER}/api/accounts/authorize?${parameters}`)
          .catch(reject);
      });
    },
  );
  const finish = (outcome: ChatGptCallbackOutcome) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    controller.abort();
    server?.close();
    if (callbackResponse) {
      sendChatGptCallbackPage(
        callbackResponse,
        options.page,
        outcome,
        200,
        () => server?.closeAllConnections(),
      );
    } else server?.closeAllConnections();
  };

  const cancel = () => {
    finish('error');
    fail(new ChatGptAuthError('cancelled'));
  };
  const timer = setTimeout(cancel, 5 * 60 * 1000);
  return {
    result: result.then(
      (value) => {
        clearTimeout(timer);
        return value;
      },
      (error: unknown) => {
        finish('error');
        throw error;
      },
    ),
    cancel,
    finish,
  };
}
