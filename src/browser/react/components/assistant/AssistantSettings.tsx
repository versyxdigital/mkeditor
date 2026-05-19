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

/**
 * AI Assistant settings (P3). Mounted inside `<SettingsModal>` on the
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
          className="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <Icon name="exclamation-circle" className="mr-1" />
          {t('assistant-settings:web_warning')}
        </div>
      )}

      {!snapshot.encryptionAvailable && (
        <div
          role="note"
          className="rounded-md border border-red-400/40 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200"
        >
          <Icon name="exclamation-circle" className="mr-1" />
          {t('assistant-settings:encryption_unavailable')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <ApiProviderRow
          provider="anthropic"
          label={t('assistant-settings:provider_anthropic')}
        />
        <ApiProviderRow
          provider="openai"
          label={t('assistant-settings:provider_openai')}
        />
        <div className="col-span-2">
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
  const [modelInput, setModelInput] = React.useState(cfg?.defaultModel ?? '');
  const [status, setStatus] = React.useState<TestStatus>('unknown');

  React.useEffect(() => {
    if (cfg?.defaultModel) setModelInput(cfg.defaultModel);
  }, [cfg?.defaultModel]);

  if (!cfg || !manager) return null;
  const disabledByEncryption = !snapshot.encryptionAvailable;

  const commitKey = () => {
    if (!keyInput || disabledByEncryption) return;
    manager.setKey(provider, keyInput);
    setKeyInput('');
    setShowKey(false);
    setStatus('unknown');
  };

  const handleClear = () => {
    manager.clearKey(provider);
    setStatus('unknown');
  };

  const handleEnable = (next: boolean) => {
    manager.setProviderConfig({
      provider,
      config: { enabled: next },
    });
  };

  const handleModelBlur = () => {
    const trimmed = modelInput.trim();
    if (!trimmed || trimmed === cfg.defaultModel) return;
    manager.setProviderConfig({
      provider,
      config: { defaultModel: trimmed },
    });
  };

  const runTest = async () => {
    setStatus('testing');
    const result = await manager.testConnection(provider, cfg.defaultModel);
    if (result.ok) {
      setStatus('connected');
      sonnerToast(
        'success',
        t('assistant-settings:test_connection_success', { provider: label }),
      );
    } else {
      setStatus('failed');
      sonnerToast(
        'error',
        t('assistant-settings:test_connection_failure', {
          provider: label,
          message: formatTestError(result.code, result.message, t),
        }),
      );
    }
  };

  const canTest = cfg.hasKey && !!cfg.defaultModel && !disabledByEncryption;

  return (
    <ProviderCard
      provider={provider}
      label={label}
      status={status}
      statusKey="assistant-settings"
    >
      <ToggleRow
        id={`${provider}-enabled`}
        label={t('assistant-settings:enable_label')}
        checked={cfg.enabled}
        onChange={handleEnable}
        disabled={disabledByEncryption}
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${provider}-key`}>
          {t('assistant-settings:api_key_label')}
        </Label>
        {/* Input + show/hide eye on one row, action buttons on the next.
            Keeps things readable at ~320 px per provider column without
            squeezing the key input below 200 px. */}
        <div className="flex items-center gap-2">
          <Input
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
            className="flex-1"
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
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={commitKey}
            disabled={!keyInput || disabledByEncryption}
          >
            {t('assistant-settings:save_key')}
          </Button>
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

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${provider}-model`}>
          {t('assistant-settings:default_model_label')}
        </Label>
        <Input
          id={`${provider}-model`}
          type="text"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onBlur={handleModelBlur}
          spellCheck={false}
        />
      </div>

      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={!canTest || status === 'testing'}
        >
          {status === 'testing'
            ? t('assistant-settings:testing')
            : t('assistant-settings:test_connection')}
        </Button>
      </div>
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
  const [status, setStatus] = React.useState<TestStatus>('unknown');

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
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    if (next && next !== cfg.defaultModel) {
      manager.setProviderConfig({
        provider: 'ollama',
        config: { defaultModel: next },
      });
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
    setStatus('testing');
    const result = await manager.testConnection('ollama', cfg.defaultModel);
    if (result.ok) {
      setStatus('connected');
      sonnerToast(
        'success',
        t('assistant-settings:test_connection_success', { provider: label }),
      );
    } else {
      setStatus('failed');
      sonnerToast(
        'error',
        t('assistant-settings:test_connection_failure', {
          provider: label,
          message: formatTestError(result.code, result.message, t),
        }),
      );
    }
  };

  const visibleModels =
    models.length > 0 ? models : cfg.defaultModel ? [cfg.defaultModel] : [];

  // Ollama lives on its own full-width row (no key field, more
  // dynamic content). The internal layout uses a two-column grid so
  // base URL and model select sit side by side, with the test
  // connection action below.
  return (
    <ProviderCard
      provider="ollama"
      label={label}
      status={status}
      statusKey="assistant-settings"
    >
      <ToggleRow
        id="ollama-enabled"
        label={t('assistant-settings:enable_label')}
        checked={cfg.enabled}
        onChange={handleEnable}
      />

      <div className="grid grid-cols-2 gap-3">
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

      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={!model || status === 'testing'}
        >
          {status === 'testing'
            ? t('assistant-settings:testing')
            : t('assistant-settings:test_connection')}
        </Button>
      </div>
    </ProviderCard>
  );
};

/* -------------------------------------------------------------------- */
/*  Shared building blocks                                                */
/* -------------------------------------------------------------------- */

type TestStatus = 'unknown' | 'testing' | 'connected' | 'failed';

const STATUS_CLASS: Record<Exclude<TestStatus, 'unknown'>, string> = {
  testing: 'bg-muted text-muted-foreground',
  connected:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
};

const ProviderCard: React.FC<{
  provider: ProviderId;
  label: string;
  status: TestStatus;
  statusKey: string;
  children: React.ReactNode;
}> = ({ provider, label, status, statusKey, children }) => (
  <section
    aria-label={label}
    className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
  >
    <div className="flex items-center justify-between">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <ProviderLogo provider={provider} className="h-4 w-4" />
        <span>{label}</span>
      </h4>
      {status !== 'unknown' && (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            STATUS_CLASS[status],
          )}
          data-testid={`status-pill-${label.toLowerCase()}`}
        >
          <StatusLabel status={status} statusKey={statusKey} />
        </span>
      )}
    </div>
    {children}
  </section>
);

const StatusLabel: React.FC<{ status: TestStatus; statusKey: string }> = ({
  status,
  statusKey,
}) => {
  const { t } = useTranslation();
  return <>{t(`${statusKey}:status_${status}`)}</>;
};

const ToggleRow: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}> = ({ id, label, checked, onChange, disabled }) => (
  <div className="flex items-center justify-between">
    <Label htmlFor={id} className="text-sm">
      {label}
    </Label>
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
    />
  </div>
);

function formatTestError(
  code: ChatErrorEvent['code'] | undefined,
  detail: string | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  const key = code ?? 'unknown';
  const translated = t(`assistant-settings:error_${key}`);
  return detail ? `${translated} — ${detail}` : translated;
}

export type { ProviderId };
