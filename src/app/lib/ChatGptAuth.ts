import { shell } from 'electron';
import { AssistantConfig } from './AssistantConfig';
import type {
  ChatGptCommand,
  ChatGptCallbackCopy,
  ChatGptError,
  ChatGptSnapshot,
} from '../interfaces/ChatGpt';
import {
  decryptChatGptTokens,
  encryptChatGptTokens,
  ensureChatGptHost,
  isRecord,
  loadChatGptStore,
  saveChatGptStore,
} from './ChatGptStore';
import type { ChatGptAccount, ChatGptTokens } from './ChatGptStore';
import {
  ChatGptAuthError,
  exchangeChatGptTokens,
  hasChatGptPermission,
  openaiDiscovery,
  OPENAI_RESOURCE,
  startChatGptLogin,
  trustedAuthUrl,
  verifyChatGptIdentity,
} from './ChatGptOAuth';
import type { ChatGptLogin } from './ChatGptOAuth';
import { isChatGptCallbackCopy } from './ChatGptCallbackPage';

const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);

/** Subscription authentication is independent of the API key and its billing. */
export class ChatGptAuth {
  private login?: ChatGptLogin;
  private signingIn = false;
  private revision = 0;
  private models: ChatGptSnapshot['models'] = [];
  private error?: ChatGptError;
  private refresh?: Promise<string>;
  private busy = false;
  private changingConnection = false;
  private signingOut = false;
  private disposed = false;

  constructor(
    private changed: () => void,
    private stopRequests: () => void,
  ) {}

  snapshot(): ChatGptSnapshot {
    const store = loadChatGptStore();
    const active = store.accounts.find((a) => a.id === store.activeId);
    const connected =
      !!active?.encryptedTokens &&
      !this.signingOut &&
      this.error !== 'sign_in_required';
    return {
      mode: store.mode,
      activeId: store.activeId,
      signingIn: this.signingIn,
      connected,
      planEnabled: active?.planEnabled === true,
      busy: this.changingConnection,
      accounts: store.accounts.flatMap((a, index) =>
        a.encryptedTokens && (a.id !== store.activeId || connected)
          ? [
              {
                id: a.id,
                label: `${a.email || 'ChatGPT'} (${index + 1})`,
              },
            ]
          : [],
      ),
      models: this.models,
      error: this.error,
      welcome:
        connected &&
        active.planEnabled === true &&
        !active.welcomed &&
        store.mode === 'chatgpt',
    };
  }

  usesPlan(): boolean {
    return loadChatGptStore().mode === 'chatgpt';
  }

  requireConnection(reason: 'sign_in_required' | 'permission_required'): void {
    this.error = reason;
    this.models = [];
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.login?.cancel();
  }

  private notify(): void {
    if (!this.disposed) this.changed();
  }

  /** Validate renderer input here as well as at the TypeScript boundary. */
  async command(input: ChatGptCommand): Promise<void> {
    if (!isRecord(input) || this.disposed) return;
    if (input.action === 'usage') {
      try {
        await shell.openExternal('https://chatgpt.com/settings/usage');
      } catch {
        this.error = 'network_error';
        this.notify();
      }
      return;
    }
    if (input.action === 'cancel') {
      if (!this.signingIn) return;
      this.revision++;
      this.login?.cancel();
      this.login = undefined;
      this.signingIn = false;
      this.notify();
      return;
    }
    // Account/mode changes must not race encryption, refresh or sign-out.
    if (this.busy || (this.signingIn && input.action !== 'welcome')) return;
    this.busy = true;
    this.changingConnection =
      input.action === 'sign-out' ||
      input.action === 'select' ||
      input.action === 'mode';
    this.signingOut = input.action === 'sign-out';
    if (this.changingConnection) this.notify();
    try {
      if (
        input.action === 'sign-out' ||
        input.action === 'select' ||
        input.action === 'mode'
      )
        this.stopRequests();
      // Finish a rotating refresh before changing accounts or signing out.
      // Otherwise its replacement token could be discarded after the server
      // has invalidated the credential still on disk.
      const revision = this.revision;
      if (this.refresh) await this.refresh.catch(() => undefined);
      if (revision !== this.revision || this.disposed) return;
      switch (input.action) {
        case 'mode': {
          if (input.mode !== 'api-key' && input.mode !== 'chatgpt') return;
          this.stopRequests();
          this.revision++;
          const store = loadChatGptStore();
          store.mode = input.mode;
          saveChatGptStore(store);
          this.error = undefined;
          if (input.mode === 'chatgpt') void this.loadModels();
          break;
        }
        case 'select': {
          if (typeof input.accountId !== 'string') return;
          const store = loadChatGptStore();
          if (!store.accounts.some((a) => a.id === input.accountId)) return;
          this.stopRequests();
          this.revision++;
          this.models = [];
          store.activeId = input.accountId;
          saveChatGptStore(store);
          this.error = undefined;
          void this.loadModels();
          break;
        }
        case 'sign-in':
          if (
            input.accountId !== undefined &&
            typeof input.accountId !== 'string'
          )
            return;
          // Sign-in has its own lifetime so Cancel remains available.
          void this.signIn(input.accountId, input.callback);
          break;
        case 'sign-out':
          await this.signOut();
          break;
        case 'models':
          await this.loadModels();
          break;
        case 'welcome': {
          const store = loadChatGptStore();
          const account = store.accounts.find((a) => a.id === store.activeId);
          if (account) {
            account.welcomed = true;
            saveChatGptStore(store);
          }
          break;
        }
      }
    } catch (error) {
      this.report(error);
    } finally {
      this.busy = false;
      this.changingConnection = false;
      this.signingOut = false;
      this.notify();
    }
  }

  private report(error: unknown): void {
    const code = error instanceof Error ? error.message : '';
    const known: ChatGptError[] = [
      'sign_in_required',
      'permission_required',
      'storage_failed',
      'network_error',
      'revocation_unconfirmed',
      'usage_limit',
      'unavailable',
    ];
    if (code === 'access_denied') {
      this.error = 'permission_required';
      return;
    }
    this.error = known.includes(code as ChatGptError)
      ? (code as ChatGptError)
      : 'sign_in_failed';
  }

  private async signIn(
    accountId?: string,
    page?: ChatGptCallbackCopy,
  ): Promise<void> {
    this.signingIn = true;
    this.error = undefined;
    this.notify();
    const revision = ++this.revision;
    let login: ChatGptLogin | undefined;
    try {
      if (!isChatGptCallbackCopy(page))
        throw new ChatGptAuthError('sign_in_failed');
      const store = ensureChatGptHost();
      const selected = accountId
        ? store.accounts.find((a) => a.id === accountId)
        : undefined;
      if (accountId && !selected) throw new ChatGptAuthError('sign_in_failed');
      const previous = selected ? await decryptChatGptTokens(selected) : null;
      if (this.revision !== revision) return;
      login = startChatGptLogin({
        page,
        hostId: store.hostId,
        clientId: selected?.id,
        idTokenHint: previous?.idToken,
        requestConsent:
          !!selected && (!previous || !hasChatGptPermission(previous)),
      });
      this.login = login;
      const result = await login.result;
      if (this.revision !== revision) return;
      if (
        selected &&
        (result.subject !== selected.subject || result.clientId !== selected.id)
      )
        throw new ChatGptAuthError('sign_in_failed');
      const encryptedTokens = await encryptChatGptTokens(result.tokens);
      if (this.revision !== revision) return;
      const current = loadChatGptStore();
      const existing = current.accounts.find((a) => a.id === result.clientId);
      if (existing && existing.subject !== result.subject)
        throw new ChatGptAuthError('sign_in_failed');
      const account: ChatGptAccount = {
        id: result.clientId,
        subject: result.subject,
        email: result.email,
        encryptedTokens,
        welcomed: existing?.welcomed,
        planEnabled: hasChatGptPermission(result.tokens),
      };
      if (existing)
        current.accounts = current.accounts.map((a) =>
          a.id === account.id ? account : a,
        );
      else current.accounts.push(account);
      current.activeId = account.id;
      current.mode = 'chatgpt';
      this.stopRequests();
      saveChatGptStore(current);
      login.finish(
        hasChatGptPermission(result.tokens) ? 'success' : 'permission',
      );
      this.models = [];
      if (!hasChatGptPermission(result.tokens))
        this.error = 'permission_required';
      this.login = undefined;
      this.signingIn = false;
      this.notify();
      if (hasChatGptPermission(result.tokens)) await this.loadModels();
    } catch (error) {
      login?.finish('error');
      if (this.revision === revision) this.report(error);
    } finally {
      if (this.revision === revision) {
        this.login = undefined;
        this.signingIn = false;
        this.notify();
      }
    }
  }

  /** Serialize rotating refresh tokens, and refuse results from a signed-out account. */
  async accessToken(forInference = false): Promise<string> {
    if (forInference && this.changingConnection)
      throw new ChatGptAuthError('sign_in_required');
    if (this.refresh) return this.refresh;
    const pending = this.getAccessToken();
    this.refresh = pending;
    try {
      return await pending;
    } finally {
      if (this.refresh === pending) this.refresh = undefined;
    }
  }

  private async getAccessToken(): Promise<string> {
    const revision = this.revision;
    const store = loadChatGptStore();
    const account = store.accounts.find((a) => a.id === store.activeId);
    if (!account || this.disposed || !this.usesPlan())
      throw new ChatGptAuthError('sign_in_required');
    const tokens = await decryptChatGptTokens(account);
    if (this.revision !== revision || !tokens)
      throw new ChatGptAuthError('sign_in_required');
    if (!hasChatGptPermission(tokens))
      throw new ChatGptAuthError('permission_required');
    if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
    try {
      const renewed = await exchangeChatGptTokens(
        {
          grant_type: 'refresh_token',
          client_id: account.id,
          refresh_token: tokens.refreshToken,
        },
        tokens,
      );
      if (renewed.idToken !== tokens.idToken) {
        const identity = await verifyChatGptIdentity(
          renewed.idToken,
          account.id,
        );
        if (identity.subject !== account.subject)
          throw new ChatGptAuthError('sign_in_required');
      }
      const encryptedTokens = await encryptChatGptTokens(renewed);
      const current = loadChatGptStore();
      const saved = current.accounts.find((a) => a.id === account.id);
      if (!saved || saved.encryptedTokens !== account.encryptedTokens)
        throw new ChatGptAuthError('sign_in_required');
      saved.encryptedTokens = encryptedTokens;
      saved.planEnabled = hasChatGptPermission(renewed);
      saveChatGptStore(current);
      // A window may close during renewal. Preserve the rotating token for
      // relaunch, but never hand it back to a cancelled/changed session.
      if (this.revision !== revision || this.disposed)
        throw new ChatGptAuthError('sign_in_required');
      if (!hasChatGptPermission(renewed))
        throw new ChatGptAuthError('permission_required');
      return renewed.accessToken;
    } catch (error) {
      if (
        error instanceof ChatGptAuthError &&
        TERMINAL_REFRESH_ERRORS.has(error.code) &&
        this.revision === revision
      ) {
        const current = loadChatGptStore();
        const saved = current.accounts.find((a) => a.id === account.id);
        if (saved && saved.encryptedTokens === account.encryptedTokens) {
          delete saved.encryptedTokens;
          saveChatGptStore(current);
        }
        this.error = 'sign_in_required';
        this.notify();
        throw new ChatGptAuthError('sign_in_required');
      }
      throw error;
    }
  }

  async loadModels(): Promise<void> {
    const revision = this.revision;
    try {
      const token = await this.accessToken();
      const response = await fetch(`${OPENAI_RESOURCE}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new ChatGptAuthError(
          response.status === 401
            ? 'sign_in_required'
            : response.status === 429
              ? 'usage_limit'
              : 'unavailable',
        );
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.models))
        throw new ChatGptAuthError('unavailable');
      const models = body.models
        .filter(
          (m) =>
            isRecord(m) &&
            m.visibility === 'list' &&
            typeof m.slug === 'string' &&
            !!m.slug &&
            typeof m.display_name === 'string',
        )
        .map((m) => ({
          id: m.slug as string,
          label: m.display_name as string,
        }));
      if (this.revision !== revision || this.disposed) return;
      this.models = models;
      this.error = undefined;
      const selectedModel = AssistantConfig.load().openai.defaultModel;
      if (
        models.length &&
        !models.some((model) => model.id === selectedModel)
      ) {
        if (
          !AssistantConfig.update({
            provider: 'openai',
            config: { defaultModel: models[0].id },
          })
        ) {
          throw new ChatGptAuthError('storage_failed');
        }
      }
    } catch (error) {
      if (this.revision === revision && !this.disposed) this.report(error);
    }
    this.notify();
  }

  private async signOut(): Promise<void> {
    this.stopRequests();
    this.revision++;
    this.models = [];
    const store = loadChatGptStore();
    const account = store.accounts.find((a) => a.id === store.activeId);
    if (!account) return;
    const tokens = await decryptChatGptTokens(account);
    let confirmed = false;
    if (tokens) {
      try {
        const discovery = await openaiDiscovery();
        const endpoint = trustedAuthUrl(discovery.revocation_endpoint);
        // One bounded retry; local sign-out remains available during an outage.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 250));
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(5000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                token: tokens.refreshToken,
                token_type_hint: 'refresh_token',
                client_id: account.id,
              }),
            });
            confirmed = response.status === 200;
            if (confirmed || response.status < 500) break;
          } catch {
            /* Retry once, then report unconfirmed revocation. */
          }
        }
      } catch {
        /* Clear locally even if discovery/revocation is unavailable. */
      }
    }
    const current = loadChatGptStore();
    const saved = current.accounts.find((a) => a.id === account.id);
    if (saved && saved.encryptedTokens === account.encryptedTokens) {
      delete saved.encryptedTokens;
      saveChatGptStore(current);
    }
    this.error = confirmed ? undefined : 'revocation_unconfirmed';
  }
}
