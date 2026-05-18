import * as React from 'react';

import { useModals } from '../contexts/ModalsContext';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Icon } from './Icon';

/**
 * Provider tab order — also the labels rendered in the tab strip. P2
 * is intentionally hardcoded; P3 derives the visible set from
 * `AssistantManager`'s sanitized config (only enabled providers show
 * up). Order is fixed across phases so the user's muscle memory of
 * "OpenAI is in the middle" doesn't shift between launches.
 */
const PROVIDERS = ['Anthropic', 'OpenAI', 'Ollama'] as const;
type ProviderTab = (typeof PROVIDERS)[number];

/**
 * Right-hand AI Assistant sidebar (P2 shell). Renders the provider
 * tab strip + an empty-state placeholder per tab. Conversation UI,
 * provider connection, and chat input arrive in P3 / P4 — this phase
 * exists so the layout, toggle, resize, and session persistence are
 * wired before any chat logic lands.
 *
 * Active tab is local state for now (each tab body is identical, so
 * lifting to context would be wasted plumbing). P4 will move this
 * selection into `AssistantManager` and persist it alongside drafts.
 */
export const AssistantSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<ProviderTab>('Anthropic');
  const { openModal } = useModals();
  const { t } = useTranslation();

  return (
    <div
      id="assistant-sidebar"
      className="flex h-full flex-col"
      data-testid="assistant-sidebar"
    >
      <div className="explorer-title px-3 pt-3">{t('assistant:title')}</div>
      <div
        role="tablist"
        aria-label={t('assistant:tabs_label')}
        className="flex border-b border-border"
      >
        {PROVIDERS.map((provider) => {
          const isActive = activeTab === provider;
          return (
            <button
              key={provider}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-state={isActive ? 'active' : 'inactive'}
              data-provider={provider.toLowerCase()}
              onClick={() => setActiveTab(provider)}
              className={cn(
                'flex-1 px-2 py-1.5 text-xs transition-colors',
                isActive
                  ? 'border-b-2 border-primary text-foreground font-medium'
                  : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {provider}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        aria-label={activeTab}
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <Icon name="comments" className="text-3xl text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('assistant:empty_state', { provider: activeTab })}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openModal('settings')}
        >
          {t('assistant:open_settings')}
        </Button>
      </div>
    </div>
  );
};
