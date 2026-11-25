import * as React from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { sonnerToast } from '../../../notify';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

/** Discover local models when opened; retain the current ID even if the daemon is offline. */
export const OllamaChatModelSelect: React.FC<{
  model: string;
  onChange: (model: string) => void;
  loadModels: () => Promise<string[]>;
  compact?: boolean;
}> = ({ model, onChange, loadModels, compact = false }) => {
  const { t } = useTranslation();
  const [models, setModels] = React.useState<string[]>([]);
  const [custom, setCustom] = React.useState(false);
  const [draft, setDraft] = React.useState(model);
  const request = React.useRef(0);
  React.useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  React.useEffect(() => {
    setDraft(model);
  }, [model]);
  const refresh = async () => {
    const current = ++request.current;
    try {
      const next = await loadModels();
      if (request.current === current) setModels(next);
    } catch (error) {
      if (request.current === current)
        sonnerToast(
          'error',
          t('assistant-settings:ollama_refresh_failure', {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    }
  };

  const commit = () => {
    if (draft.trim()) onChange(draft.trim());
    else setDraft(model);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor="chat-model" className={compact ? 'sr-only' : undefined}>
        {t('assistant-chat:model_label')}
      </Label>
      <Select
        value={custom ? '__custom__' : model}
        onOpenChange={(open) => {
          if (open) void refresh();
        }}
        onValueChange={(value) => {
          setCustom(value === '__custom__');
          if (value !== '__custom__') onChange(value);
        }}
      >
        <SelectTrigger
          id="chat-model"
          aria-label={t('assistant-chat:model_aria')}
          compact={compact}
          title={`${t('assistant-chat:model_label')}: ${model}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([model, ...models].filter(Boolean))].map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
          <SelectItem value="__custom__">
            {t('assistant-settings:custom_model')}
          </SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <>
          <Label htmlFor="chat-custom-model">
            {t('assistant-settings:custom_model_id')}
          </Label>
          <Input
            id="chat-custom-model"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
            }}
            spellCheck={false}
          />
        </>
      )}
    </div>
  );
};
