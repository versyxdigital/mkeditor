import * as React from 'react';
import type {
  ApiProviderId,
  ThinkingLevel,
} from '../../../../app/interfaces/Assistant';
import {
  ASSISTANT_MODELS,
  getThinkingLevels,
  isThinkingLevel,
} from '../../../../app/shared/assistantModels';
import { useTranslation } from '../../hooks/useTranslation';
import { useAssistantConfig } from '../../contexts/AssistantContext';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const CUSTOM_MODEL = '__custom_model__';

export const ProviderModelSettings: React.FC<{
  provider: ApiProviderId;
  model: string;
  thinkingLevel?: ThinkingLevel;
  onModelChange: (model: string) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  idPrefix?: string;
  modelLabel?: string;
  modelAriaLabel?: string;
  compact?: boolean;
}> = ({
  provider,
  model,
  thinkingLevel,
  onModelChange,
  onThinkingChange,
  idPrefix = provider,
  modelLabel,
  modelAriaLabel,
  compact = false,
}) => {
  const { t } = useTranslation();
  const { snapshot } = useAssistantConfig();
  const auth = provider === 'openai' ? snapshot.chatgpt : undefined;
  const models =
    auth?.mode === 'chatgpt' ? auth.models : ASSISTANT_MODELS[provider];
  const knownModel = models.some((entry) => entry.id === model);
  const [custom, setCustom] = React.useState(!knownModel);
  const [draft, setDraft] = React.useState(model);

  React.useEffect(() => {
    setCustom(!models.some((entry) => entry.id === model));
    setDraft(model);
  }, [model, models]);

  const levels = getThinkingLevels(provider, model);
  const selectedLevel = levels.includes(thinkingLevel ?? 'auto')
    ? thinkingLevel
    : 'auto';
  const commitCustom = () => {
    const next = draft.trim();
    if (next && next !== model) onModelChange(next);
    else if (!next) setDraft(model);
  };

  return (
    <>
      <div className="flex min-w-0 max-w-full flex-col gap-1">
        <Label
          htmlFor={`${idPrefix}-model`}
          className={compact ? 'sr-only' : undefined}
        >
          {modelLabel ?? t('assistant-settings:default_model_label')}
        </Label>
        <Select
          value={custom ? CUSTOM_MODEL : model}
          onValueChange={(next) => {
            setCustom(next === CUSTOM_MODEL);
            if (next !== CUSTOM_MODEL) onModelChange(next);
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-model`}
            aria-label={modelAriaLabel}
            compact={compact}
            title={
              compact
                ? `${modelLabel ?? t('assistant-settings:default_model_label')}: ${models.find((entry) => entry.id === model)?.label ?? model}`
                : undefined
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MODEL}>
              {t('assistant-settings:custom_model')}
            </SelectItem>
          </SelectContent>
        </Select>
        {custom && (
          <div className="mt-1 flex flex-col gap-1">
            <Label htmlFor={`${idPrefix}-custom-model`}>
              {t('assistant-settings:custom_model_id')}
            </Label>
            <Input
              id={`${idPrefix}-custom-model`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitCustom}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitCustom();
              }}
              spellCheck={false}
            />
          </div>
        )}
      </div>
      <div className="flex min-w-0 max-w-full flex-col gap-1">
        <Label
          htmlFor={`${idPrefix}-thinking`}
          className={compact ? 'sr-only' : undefined}
        >
          {t('assistant-settings:thinking_label')}
        </Label>
        <Select
          value={selectedLevel ?? 'auto'}
          disabled={levels.length === 0}
          onValueChange={(next) => {
            if (isThinkingLevel(next)) onThinkingChange(next);
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-thinking`}
            compact={compact}
            title={
              compact
                ? `${t('assistant-settings:thinking_label')}: ${t(`assistant-settings:thinking_${selectedLevel ?? 'auto'}`)}`
                : undefined
            }
            aria-describedby={compact ? undefined : `${idPrefix}-thinking-help`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['auto', ...levels] as const).map((level) => (
              <SelectItem key={level} value={level}>
                {t(`assistant-settings:thinking_${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!compact && (
          <p
            id={`${idPrefix}-thinking-help`}
            className="text-xs text-muted-foreground"
          >
            {t(
              levels.length > 0
                ? 'assistant-settings:thinking_help'
                : 'assistant-settings:thinking_unavailable',
            )}
          </p>
        )}
      </div>
    </>
  );
};
