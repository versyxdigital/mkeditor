import * as React from 'react';

import type { ProviderId } from '../../../app/interfaces/Assistant';
import {
  useAssistantChat,
  useAssistantConfig,
} from '../contexts/AssistantContext';
import { useModals } from '../contexts/ModalsContext';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { ProviderLogo } from './assistant/ProviderLogo';
import { ProviderTab } from './assistant/ProviderTab';
import { Button } from './ui/button';
import { Icon } from './Icon';

/**
 * Fixed display order — also the labels rendered in the tab strip.
 * The active set is filtered down to providers whose sanitized config
 * carries `enabled === true`; disabling a provider hides its tab
 * without removing the persisted config.
 *
 * Order is stable across phases so the user's muscle memory ("OpenAI
 * sits in the middle") doesn't shift between launches.
 */
const PROVIDER_ORDER: readonly ProviderId[] = [
  'anthropic',
  'openai',
  'ollama',
] as const;

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
};

/**
 * Right-hand AI Assistant sidebar.
 *
 * P3: now reads the sanitized config snapshot from `AssistantContext`.
 * Only enabled providers contribute tabs; the active tab automatically
 * falls back to the first enabled provider if the previously-selected
 * one is disabled. When no providers are enabled, a single CTA opens
 * the Settings modal.
 *
 * Chat UI lands in P4; this phase still renders the empty-state
 * placeholder per provider.
 */
export const AssistantSidebar: React.FC = () => {
  const { snapshot } = useAssistantConfig();
  const { chat } = useAssistantChat();
  const { openModal } = useModals();
  const { t } = useTranslation();

  // P8 — per-provider streaming indicator. Pulses on the tab when
  // that provider has any in-flight call (useful when the user is
  // viewing a different provider tab and won't see the streaming
  // dot inside the bubble).
  const streamingProviders = React.useMemo(() => {
    const set = new Set<ProviderId>();
    for (const call of Object.values(chat.inflight)) {
      set.add(call.provider);
    }
    return set;
  }, [chat.inflight]);

  const enabledProviders = React.useMemo<ProviderId[]>(() => {
    if (!snapshot.config) return [];
    return PROVIDER_ORDER.filter((id) => snapshot.config?.[id]?.enabled);
  }, [snapshot.config]);

  const [activeTab, setActiveTab] = React.useState<ProviderId | null>(null);

  // Keep `activeTab` valid: when the previously-active provider gets
  // disabled (or no provider is enabled yet), fall back to the first
  // enabled one — or null when none are.
  React.useEffect(() => {
    if (enabledProviders.length === 0) {
      if (activeTab !== null) setActiveTab(null);
      return;
    }
    if (!activeTab || !enabledProviders.includes(activeTab)) {
      setActiveTab(enabledProviders[0]);
    }
  }, [enabledProviders, activeTab]);

  return (
    <div
      id="assistant-sidebar"
      className="flex h-full flex-col"
      data-testid="assistant-sidebar"
    >
      <div className="explorer-title px-3 pt-3">{t('assistant:title')}</div>
      {enabledProviders.length === 0 ? (
        <EmptyState
          onOpenSettings={() => openModal('settings', { tab: 'assistant' })}
          message={t('assistant:no_providers_enabled')}
          cta={t('assistant:open_settings')}
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('assistant:tabs_label')}
            className="flex border-b border-border"
          >
            {enabledProviders.map((provider) => {
              const isActive = activeTab === provider;
              const isStreaming = streamingProviders.has(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-state={isActive ? 'active' : 'inactive'}
                  data-provider={provider}
                  data-streaming={isStreaming || undefined}
                  onClick={() => setActiveTab(provider)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs transition-colors',
                    isActive
                      ? 'border-b-2 border-primary text-foreground font-medium'
                      : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <ProviderLogo
                    provider={provider}
                    className="h-3.5 w-3.5"
                  />
                  <span>{PROVIDER_LABEL[provider]}</span>
                  {isStreaming && (
                    <span
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
                      aria-label={t('assistant-chat:streaming')}
                      data-testid={`provider-tab-streaming-${provider}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            aria-label={activeTab ? PROVIDER_LABEL[activeTab] : undefined}
            className="flex flex-1 flex-col overflow-hidden"
          >
            {activeTab ? <ProviderTab provider={activeTab} /> : null}
          </div>
        </>
      )}
    </div>
  );
};

const EmptyState: React.FC<{
  onOpenSettings: () => void;
  message: string;
  cta: string;
}> = ({ onOpenSettings, message, cta }) => (
  <div
    role="tabpanel"
    className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
  >
    <Icon name="comments" className="text-3xl text-muted-foreground" />
    <p className="text-xs text-muted-foreground">{message}</p>
    <Button size="sm" variant="outline" onClick={onOpenSettings}>
      {cta}
    </Button>
  </div>
);
