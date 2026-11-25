import * as React from 'react';

import type {
  ApiProviderId,
  ChatErrorEvent,
  ProviderId,
} from '../../../../app/interfaces/Assistant';
import { useManagers } from '../../contexts/ManagersContext';
import { useAssistantConfig } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { sonnerToast } from '../../../notify';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { Icon } from '../Icon';
import { ProviderLogo } from './ProviderLogo';
import { ProviderModelSettings } from './ProviderModelSettings';
import { ChatGptSettings } from './ChatGptSettings';
import { getThinkingLevels } from '../../../../app/shared/assistantModels';

/**
 * AI Assistant settings. Mounted inside `<SettingsModal>` on the
 * "AI Providers" tab.
 *
 * Layout: two-column grid for Anthropic + OpenAI (similar shapes); a
 * full-width row below for Ollama (which has more content — base URL
 * + dynamic model select). Warning banners (web-mode localStorage
 * notice + encryption-unavailable) sit full-width at the top.
 *
 * Reads sanitized config from `useAssistantConfig`; writes via the
 * manager's mutators (`setProviderConfig`, `setKey`, `clearKey`,
 * `refreshOllamaModels`, `testConnection`). React never touches IPC.
 */
export const AssistantSettings: React.FC = () => {
  const { mode } = useManagers();
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();

  if (!snapshot.config || !manager) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('assistant-settings:loading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === 'web' && (
        <div
          role="note"
          className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <Icon name="exclamation-circle" className="mr-1" />
          {t('assistant-settings:web_warning')}
        </div>
      )}

      {!snapshot.encryptionAvailable && (
        <div
          role="note"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <Icon name="exclamation-circle" className="mr-1" />
          {t('assistant-settings:encryption_unavailable')}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ApiProviderRow
          provider="anthropic"
          label={t('assistant-settings:provider_anthropic')}
        />
        <ApiProviderRow
          provider="openai"
          label={t('assistant-settings:provider_openai')}
        />
        <div className="lg:col-span-2">
          <OllamaProviderRow label={t('assistant-settings:provider_ollama')} />
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  API-key providers (Anthropic, OpenAI)                                */
/* -------------------------------------------------------------------- */

const ApiProviderRow: React.FC<{
  provider: ApiProviderId;
  label: string;
}> = ({ provider, label }) => {
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();
  const cfg = snapshot.config?.[provider];

  const [keyInput, setKeyInput] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const connection = useConnectionStatus(
    JSON.stringify([
      cfg?.defaultModel,
      cfg?.hasKey,
      provider === 'openai' ? snapshot.chatgpt : null,
    ]),
  );
  const keyInputRef = React.useRef<HTMLInputElement>(null);

  if (!cfg || !manager) return null;
  const disabledByEncryption = !snapshot.encryptionAvailable;

  const commitKey = () => {
    if (!keyInput || disabledByEncryption) return;
    // Fire-and-clear: setKey RSA-encrypts the plaintext in the
    // renderer before shipping IPC (compliance), but we don't make
    // the user wait on the await — the field clears immediately
    // and any encryption failure surfaces via the unchanged
    // `hasKey` state in the subsequent config push.
    void manager.setKey(provider, keyInput);
    setKeyInput('');
    setShowKey(false);
    connection.reset();
  };

  const handleClear = () => {
    manager.clearKey(provider);
    connection.reset();
  };

  const handleEnable = (next: boolean) => {
    manager.setProviderConfig({
      provider,
      config: { enabled: next },
    });
  };

  const handleModelChange = (model: string) => {
    if (model === cfg.defaultModel) return;
    manager.setProviderConfig({
      provider,
      config: {
        defaultModel: model,
        ...(cfg.thinkingLevel &&
        cfg.thinkingLevel !== 'auto' &&
        !getThinkingLevels(provider, model).includes(cfg.thinkingLevel)
          ? { thinkingLevel: 'auto' as const }
          : {}),
      },
    });
    connection.reset();
  };

  const runTest = async () => {
    const ticket = connection.start();
    const result = await manager.testConnection(provider, cfg.defaultModel);
    if (!connection.complete(ticket, result.ok)) return;
    if (result.ok) {
      sonnerToast(
        'success',
        t('assistant-settings:test_connection_success', { provider: label }),
      );
    } else {
      sonnerToast(
        'error',
        t('assistant-settings:test_connection_failure', {
          provider: label,
          message: formatTestError(result.code, result.message, t),
        }),
      );
    }
  };

  const usePlan = provider === 'openai' && snapshot.chatgpt?.mode === 'chatgpt';
  const canTest =
    (usePlan
      ? snapshot.chatgpt?.connected && snapshot.chatgpt.planEnabled !== false
      : cfg.hasKey) &&
    !!cfg.defaultModel &&
    !disabledByEncryption;

  return (
    <ProviderCard
      provider={provider}
      label={label}
      enabled={cfg.enabled}
      onEnabledChange={handleEnable}
      disabled={disabledByEncryption}
    >
      {provider === 'openai' && <ChatGptSettings />}
      {provider === 'anthropic' && (
        <p
          role="note"
          className="rounded-md border border-border bg-editor px-3 py-2 text-xs leading-5 text-muted-foreground"
        >
          {t('assistant-connect:anthropic_subscription_note')}
        </p>
      )}
      {!usePlan && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${provider}-key`}>
            {t('assistant-settings:api_key_label')}
          </Label>
          {/* Input + show/hide eye on one row, action buttons on the next.
            Keeps things readable at ~320 px per provider column without
            squeezing the key input below 200 px. */}
          <div className="flex items-center gap-2">
            <Input
              ref={keyInputRef}
              id={`${provider}-key`}
              type={showKey ? 'text' : 'password'}
              placeholder={
                cfg.hasKey
                  ? t('assistant-settings:api_key_placeholder_saved')
                  : t('assistant-settings:api_key_placeholder_empty')
              }
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitKey();
              }}
              disabled={disabledByEncryption}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setShowKey((v) => !v)}
              title={
                showKey
                  ? t('assistant-settings:hide_key')
                  : t('assistant-settings:show_key')
              }
              aria-label={
                showKey
                  ? t('assistant-settings:hide_key')
                  : t('assistant-settings:show_key')
              }
              className="h-8 w-8 shrink-0"
            >
              <Icon name={showKey ? 'eye-slash' : 'eye'} />
            </Button>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                'flex items-center gap-1.5 text-xs',
                cfg.hasKey ? 'text-success' : 'text-muted-foreground',
              )}
            >
              <Icon
                name={cfg.hasKey ? 'check' : 'question-circle'}
                className="h-3.5 w-3.5"
              />
              {t(
                cfg.hasKey
                  ? 'assistant-settings:key_configured'
                  : 'assistant-settings:key_not_configured',
              )}
            </span>
            <div className="flex items-center gap-1">
              {(!cfg.hasKey || keyInput) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={commitKey}
                  disabled={!keyInput || disabledByEncryption}
                >
                  {t('assistant-settings:save_key')}
                </Button>
              )}
              {cfg.hasKey && !keyInput && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => keyInputRef.current?.focus()}
                  disabled={disabledByEncryption}
                >
                  {t('assistant-settings:replace_key')}
                </Button>
              )}
              {cfg.hasKey && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                >
                  {t('assistant-settings:clear_key')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {(!usePlan ||
        (snapshot.chatgpt?.connected &&
          snapshot.chatgpt.planEnabled !== false)) && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <ProviderModelSettings
              provider={provider}
              model={cfg.defaultModel}
              thinkingLevel={cfg.thinkingLevel}
              onModelChange={handleModelChange}
              onThinkingChange={(thinkingLevel) =>
                manager.setProviderConfig({
                  provider,
                  config: { thinkingLevel },
                })
              }
            />
          </div>

          <ConnectionFooter
            provider={provider}
            connection={connection}
            onTest={runTest}
            disabled={!canTest}
          />
        </>
      )}
    </ProviderCard>
  );
};

/* -------------------------------------------------------------------- */
/*  Ollama (local provider, no key — base URL + dynamic model list)      */
/* -------------------------------------------------------------------- */

const OllamaProviderRow: React.FC<{ label: string }> = ({ label }) => {
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();
  const cfg = snapshot.config?.ollama;

  const [baseUrl, setBaseUrl] = React.useState(cfg?.baseUrl ?? '');
  const [model, setModel] = React.useState(cfg?.defaultModel ?? '');
  const [models, setModels] = React.useState<string[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const connection = useConnectionStatus(
    JSON.stringify([cfg?.baseUrl, cfg?.defaultModel, cfg?.contextLength]),
  );

  React.useEffect(() => {
    if (cfg?.baseUrl) setBaseUrl(cfg.baseUrl);
  }, [cfg?.baseUrl]);
  React.useEffect(() => {
    if (cfg?.defaultModel) setModel(cfg.defaultModel);
  }, [cfg?.defaultModel]);

  if (!cfg || !manager) return null;

  const handleEnable = (next: boolean) => {
    manager.setProviderConfig({
      provider: 'ollama',
      config: { enabled: next },
    });
  };

  const handleBaseUrlBlur = () => {
    const trimmed = baseUrl.trim();
    if (!trimmed || trimmed === cfg.baseUrl) return;
    manager.setProviderConfig({
      provider: 'ollama',
      config: { baseUrl: trimmed },
    });
    connection.reset();
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    if (next && next !== cfg.defaultModel) {
      manager.setProviderConfig({
        provider: 'ollama',
        config: { defaultModel: next },
      });
      connection.reset();
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const list = await manager.refreshOllamaModels(baseUrl);
      setModels(list);
      sonnerToast(
        'success',
        t('assistant-settings:ollama_refresh_success', {
          count: String(list.length),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sonnerToast(
        'error',
        t('assistant-settings:ollama_refresh_failure', { message }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const runTest = async () => {
    const ticket = connection.start();
    const result = await manager.testConnection('ollama', cfg.defaultModel);
    if (!connection.complete(ticket, result.ok)) return;
    if (result.ok) {
      sonnerToast(
        'success',
        t('assistant-settings:test_connection_success', { provider: label }),
      );
    } else {
      sonnerToast(
        'error',
        t('assistant-settings:test_connection_failure', {
          provider: label,
          message: formatTestError(result.code, result.message, t),
        }),
      );
    }
  };

  const visibleModels = Array.from(new Set([model, ...models].filter(Boolean)));
  const contextLength = cfg.contextLength ?? 0;
  const contextSizes = Array.from(
    new Set([
      0,
      4096,
      8192,
      16384,
      32768,
      65536,
      131072,
      262144,
      contextLength,
    ]),
  ).sort((a, b) => a - b);

  // Ollama lives on its own full-width row (no key field, more
  // dynamic content). The internal layout uses a two-column grid so
  // base URL and model select sit side by side, with the test
  // connection action below.
  return (
    <ProviderCard
      provider="ollama"
      label={label}
      enabled={cfg.enabled}
      onEnabledChange={handleEnable}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ollama-baseurl">
            {t('assistant-settings:ollama_baseurl_label')}
          </Label>
          <Input
            id="ollama-baseurl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={handleBaseUrlBlur}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {t('assistant-settings:ollama_baseurl_help')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="ollama-model">
            {t('assistant-settings:default_model_label')}
          </Label>
          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={handleModelChange}>
              <SelectTrigger id="ollama-model" className="flex-1">
                <SelectValue
                  placeholder={t('assistant-settings:ollama_model_placeholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {visibleModels.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <Icon name="refresh" />
              <span>{t('assistant-settings:ollama_refresh')}</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ollama-context">
          {t('assistant-settings:ollama_context_label')}
        </Label>
        <Select
          value={String(contextLength)}
          onValueChange={(value) => {
            manager.setProviderConfig({
              provider: 'ollama',
              config: { contextLength: Number(value) },
            });
            connection.reset();
          }}
        >
          <SelectTrigger
            id="ollama-context"
            aria-describedby="ollama-context-help"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {contextSizes.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size === 0
                  ? t('assistant-settings:ollama_context_default')
                  : size.toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="ollama-context-help" className="text-xs text-muted-foreground">
          {t('assistant-settings:ollama_context_help')}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('assistant-settings:ollama_tool_support_hint')}
      </p>

      <ConnectionFooter
        provider="ollama"
        connection={connection}
        onTest={runTest}
        disabled={!model}
      />
    </ProviderCard>
  );
};

/* -------------------------------------------------------------------- */
/*  Shared building blocks                                                */
/* -------------------------------------------------------------------- */

type TestStatus = 'unknown' | 'testing' | 'connected' | 'failed';

/** A connection result belongs to the configuration that was actually tested. */
function useConnectionStatus(identity: string) {
  const [status, setStatus] = React.useState<TestStatus>('unknown');
  const [lastTested, setLastTested] = React.useState<number | null>(null);
  const version = React.useRef(0);
  const reset = React.useCallback(() => {
    version.current++;
    setStatus('unknown');
    setLastTested(null);
  }, []);
  React.useEffect(() => {
    reset();
    return () => {
      version.current++;
    };
  }, [identity, reset]);
  return {
    status,
    lastTested,
    reset,
    start: () => {
      const ticket = ++version.current;
      setStatus('testing');
      return ticket;
    },

    complete: (ticket: number, ok: boolean) => {
      if (ticket !== version.current) return false;
      setStatus(ok ? 'connected' : 'failed');
      setLastTested(Date.now());
      return true;
    },
  };
}

const ConnectionFooter: React.FC<{
  provider: ProviderId;
  connection: ReturnType<typeof useConnectionStatus>;
  onTest: () => void;
  disabled: boolean;
}> = ({ provider, connection, onTest, disabled }) => {
  const { t } = useTranslation();
  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4">
      <div role="status" className="min-w-0 text-xs">
        <div
          className={cn(
            'flex items-center gap-2',
            connection.status === 'connected'
              ? 'text-success'
              : connection.status === 'failed'
                ? 'text-destructive'
                : 'text-muted-foreground',
          )}
          data-testid={'status-pill-' + provider}
        >
          <Icon
            name={
              connection.status === 'connected'
                ? 'check'
                : connection.status === 'failed'
                  ? 'exclamation-circle'
                  : 'question-circle'
            }
            className="h-3.5 w-3.5"
          />
          <span>
            {t(
              connection.status === 'unknown'
                ? 'assistant-settings:connection_not_tested'
                : 'assistant-settings:status_' + connection.status,
            )}
          </span>
        </div>
        {connection.lastTested !== null && (
          <p className="mt-1 pl-5 text-muted-foreground">
            {t('assistant-settings:last_tested', {
              time: new Date(connection.lastTested).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={disabled || connection.status === 'testing'}
      >
        <Icon name="refresh" className="h-3.5 w-3.5" />
        {t(
          connection.status === 'testing'
            ? 'assistant-settings:testing'
            : 'assistant-settings:test_connection',
        )}
      </Button>
    </div>
  );
};

const ProviderCard: React.FC<{
  provider: ProviderId;
  label: string;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ provider, label, enabled, onEnabledChange, disabled, children }) => {
  const { t } = useTranslation();
  return (
    <section
      aria-label={label}
      className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-4">
        <h4 className="flex items-center gap-2 text-base font-semibold">
          <ProviderLogo provider={provider} className="h-5 w-5" />
          <span>{label}</span>
        </h4>
        <div className="flex items-center gap-2">
          <Label htmlFor={provider + '-enabled'} className="sr-only">
            {t('assistant-settings:enable_label')}
          </Label>
          <Switch
            id={provider + '-enabled'}
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={disabled}
          />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs',
              enabled
                ? 'bg-success/10 text-success'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {t(
              enabled
                ? 'assistant-settings:provider_enabled'
                : 'assistant-settings:provider_disabled',
            )}
          </span>
        </div>
      </div>
      {children}
    </section>
  );
};

function formatTestError(
  code: ChatErrorEvent['code'] | undefined,
  detail: string | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  const key = code ?? 'unknown';
  const translated = t(
    `${key.startsWith('chatgpt_') ? 'chatgpt' : 'assistant-settings'}:error_${key}`,
  );
  return detail ? `${translated} — ${detail}` : translated;
}

export type { ProviderId };
