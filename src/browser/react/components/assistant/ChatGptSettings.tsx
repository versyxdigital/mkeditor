import * as React from 'react';
import { useAssistantConfig } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { ProviderLogo } from './ProviderLogo';
import { Icon } from '../Icon';

export const ChatGptUsage: React.FC = () => {
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();
  const auth = snapshot.chatgpt;
  if (
    auth?.mode !== 'chatgpt' ||
    !auth.connected ||
    auth.planEnabled === false ||
    auth.busy ||
    auth.error === 'sign_in_required' ||
    auth.error === 'permission_required'
  )
    return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t('chatgpt:using_plan')}</span>
      <Button
        variant="link"
        size="sm"
        onClick={() => manager?.chatGptCommand({ action: 'usage' })}
      >
        {t('chatgpt:manage_usage')}
      </Button>
    </div>
  );
};

export const ChatGptSettings: React.FC = () => {
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();
  const auth = snapshot.chatgpt;
  if (!auth || !manager) return null;
  const disabled = auth.signingIn || auth.busy || !snapshot.encryptionAvailable;
  const active = auth.accounts.find((account) => account.id === auth.activeId);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="openai-auth-mode">{t('chatgpt:connection')}</Label>
      <Select
        value={auth.mode}
        disabled={disabled}
        onValueChange={(mode) => {
          if (mode === 'api-key' || mode === 'chatgpt')
            manager.chatGptCommand({ action: 'mode', mode });
        }}
      >
        <SelectTrigger id="openai-auth-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="api-key">
            {t('assistant-settings:api_key_label')}
          </SelectItem>
          <SelectItem value="chatgpt">{t('chatgpt:plan')}</SelectItem>
        </SelectContent>
      </Select>
      {auth.mode === 'chatgpt' && (
        <>
          <p className="text-xs text-muted-foreground">
            {t('chatgpt:description')}
          </p>
          {auth.accounts.length > 0 && (
            <>
              <Label htmlFor="chatgpt-account">{t('chatgpt:account')}</Label>
              <Select
                value={auth.activeId}
                disabled={disabled}
                onValueChange={(accountId) =>
                  manager.chatGptCommand({ action: 'select', accountId })
                }
              >
                <SelectTrigger id="chatgpt-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {auth.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                manager.chatGptCommand({
                  action: 'sign-in',
                  accountId: auth.activeId,
                })
              }
            >
              <ProviderLogo provider="openai" className="mr-1 h-4 w-4" />
              {t('chatgpt:continue')}
            </Button>
            {auth.signingIn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => manager.chatGptCommand({ action: 'cancel' })}
              >
                {t('chatgpt:cancel')}
              </Button>
            )}
            {active && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => manager.chatGptCommand({ action: 'sign-in' })}
              >
                {t('chatgpt:add_account')}
              </Button>
            )}
            {auth.connected && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => manager.chatGptCommand({ action: 'sign-out' })}
              >
                {t('chatgpt:sign_out')}
              </Button>
            )}
          </div>
          {auth.signingIn && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('chatgpt:waiting')}
            </p>
          )}
          {auth.busy && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('assistant-connect:updating')}
            </p>
          )}
          {auth.error && (
            <p role="alert" className="text-xs text-destructive">
              {t(`chatgpt:error_${auth.error}`)}
            </p>
          )}
          <ChatGptUsage />
          {auth.connected && auth.planEnabled !== false && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => manager.chatGptCommand({ action: 'models' })}
            >
              {t('chatgpt:refresh_models')}
            </Button>
          )}
        </>
      )}
      <ChatGptWelcome />
    </div>
  );
};

export const ChatGptWelcome: React.FC = () => {
  const { snapshot, manager } = useAssistantConfig();
  const { t } = useTranslation();
  const acknowledgeRef = React.useRef<HTMLButtonElement>(null);
  const auth = snapshot.chatgpt;
  if (!auth || !manager) return null;
  const active = auth.accounts.find((account) => account.id === auth.activeId);
  return (
    <Dialog
      open={auth.welcome}
      onOpenChange={(open) => {
        if (!open) manager.chatGptCommand({ action: 'welcome' });
      }}
    >
      <DialogContent
        className="max-w-[440px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          acknowledgeRef.current?.focus();
        }}
      >
        <div className="space-y-4 px-6 pb-6 pt-6">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary"
          >
            <ProviderLogo provider="openai" className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <DialogTitle className="pr-2 text-lg leading-7">
              {t('chatgpt:welcome')}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {t('chatgpt:description')}
            </DialogDescription>
          </div>
          {active && (
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-editor px-3 py-2 text-sm">
              <Icon
                name="check"
                aria-hidden="true"
                className="shrink-0 text-success"
              />
              <span className="min-w-0 break-words">{active.label}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => manager.chatGptCommand({ action: 'usage' })}
          >
            {t('chatgpt:manage_usage')}
          </Button>
          <Button
            ref={acknowledgeRef}
            onClick={() => manager.chatGptCommand({ action: 'welcome' })}
          >
            {t('chatgpt:got_it')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
