import * as React from 'react';
import type { ApiProviderId } from '../../../../app/interfaces/Assistant';
import { getAssistantConnection } from '../../../core/assistantConnection';
import { useAssistantConfig } from '../../contexts/AssistantContext';
import { useModals } from '../../contexts/ModalsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Icon } from '../Icon';
import { ProviderLogo } from './ProviderLogo';

/** Credential onboarding also replaces the composer without removing history. */
export const ProviderConnection: React.FC<{
  provider: ApiProviderId;
  compact?: boolean;
}> = ({ provider, compact = false }) => {
  const { snapshot, manager } = useAssistantConfig();
  const { openModal } = useModals();
  const { t } = useTranslation();
  const inputId = React.useId();
  const [keyInput, setKeyInput] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const auth = provider === 'openai' ? snapshot.chatgpt : undefined;
  const connection = getAssistantConnection(provider, snapshot);
  const disabled =
    !manager ||
    !snapshot.encryptionAvailable ||
    saving ||
    auth?.signingIn ||
    auth?.busy;
  const label = t(`assistant-settings:provider_${provider}`);
  const actionClass =
    'h-auto min-h-8 w-full whitespace-normal break-words px-3 py-2 text-center';
  const canUsePlan =
    auth?.connected &&
    auth.planEnabled !== false &&
    auth.error !== 'permission_required' &&
    auth.error !== 'sign_in_required';
  if (connection === 'loading')
    return (
      <p
        role="status"
        className="p-4 text-center text-xs text-muted-foreground"
      >
        {t('assistant-settings:loading')}
      </p>
    );

  const saveKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !keyInput.trim() || !manager) return;
    setSaving(true);
    setFailed(false);
    const pending = manager.connectWithApiKey(provider, keyInput);
    setKeyInput('');
    setShowKey(false);
    try {
      setFailed(!(await pending));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      data-testid={`provider-connect-${provider}`}
      className={
        compact
          ? 'max-h-[60%] shrink-0 overflow-y-auto border-t border-border p-3 thin-scrollbars'
          : 'flex h-full min-h-0 flex-col overflow-y-auto px-5 py-6 thin-scrollbars'
      }
    >
      <div
        className={
          compact
            ? 'mx-auto flex w-full max-w-sm flex-col gap-3'
            : 'm-auto flex w-full max-w-sm flex-col gap-4 py-4'
        }
      >
        <div className="flex items-center gap-2">
          <ProviderLogo
            provider={provider}
            className="h-5 w-5 shrink-0 text-muted-foreground"
          />
          <h2 id={`${inputId}-title`} className="text-sm font-semibold">
            {t('assistant-connect:title', { provider: label })}
          </h2>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {t(
            provider === 'openai'
              ? 'assistant-connect:openai_description'
              : 'assistant-connect:api_description',
            { provider: label },
          )}
        </p>
        {provider === 'anthropic' && (
          <p
            role="note"
            className="rounded-md border border-border bg-editor px-3 py-2 text-xs leading-5 text-muted-foreground"
          >
            {t('assistant-connect:anthropic_subscription_note')}
          </p>
        )}
        {!snapshot.encryptionAvailable && (
          <p role="alert" className="text-xs text-destructive">
            {t('assistant-settings:encryption_unavailable')}
          </p>
        )}
        {provider === 'openai' && auth && (
          <div className="flex flex-col gap-2">
            {auth.busy && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('assistant-connect:updating')}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className={actionClass}
              disabled={disabled}
              onClick={() => {
                if (canUsePlan)
                  manager?.chatGptCommand({ action: 'mode', mode: 'chatgpt' });
                else
                  manager?.chatGptCommand({
                    action: 'sign-in',
                    accountId: auth.activeId,
                  });
              }}
            >
              <ProviderLogo provider="openai" className="h-4 w-4" />
              {t(
                canUsePlan ? 'assistant-connect:use_plan' : 'chatgpt:continue',
              )}
            </Button>
            {auth.signingIn && (
              <>
                <p
                  role="status"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {t('chatgpt:waiting')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => manager?.chatGptCommand({ action: 'cancel' })}
                >
                  {t('chatgpt:cancel')}
                </Button>
              </>
            )}
            {auth.error && (
              <p role="alert" className="text-xs text-destructive">
                {t(`chatgpt:error_${auth.error}`)}
              </p>
            )}
          </div>
        )}
        <form
          onSubmit={(event) => void saveKey(event)}
          className="flex flex-col gap-2"
        >
          <Label htmlFor={inputId}>{t('assistant-connect:api_option')}</Label>
          {provider === 'openai' && snapshot.config?.openai.hasKey ? (
            <Button
              type="button"
              variant="outline"
              className={actionClass}
              disabled={disabled}
              onClick={() =>
                manager?.chatGptCommand({ action: 'mode', mode: 'api-key' })
              }
            >
              {t('assistant-connect:use_saved_key')}
            </Button>
          ) : (
            <>
              <div className="flex gap-1">
                <Input
                  id={inputId}
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(
                    'assistant-settings:api_key_placeholder_empty',
                  )}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={t(
                    showKey
                      ? 'assistant-settings:hide_key'
                      : 'assistant-settings:show_key',
                  )}
                  onClick={() => setShowKey(!showKey)}
                >
                  <Icon name={showKey ? 'eye-slash' : 'eye'} />
                </Button>
              </div>
              <Button
                type="submit"
                className={actionClass}
                disabled={disabled || !keyInput.trim()}
              >
                {t(
                  saving
                    ? 'assistant-connect:saving'
                    : 'assistant-connect:save',
                )}
              </Button>
            </>
          )}
          {provider !== 'anthropic' && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t('assistant-connect:api_help', { provider: label })}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-xs text-destructive">
              {t('assistant-connect:save_failed')}
            </p>
          )}
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={actionClass}
          onClick={() => openModal('settings', { tab: 'assistant' })}
        >
          {t('assistant:open_settings')}
        </Button>
      </div>
    </section>
  );
};
