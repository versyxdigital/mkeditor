import type {
  ApiProviderId,
  ProviderId,
  ThinkingLevel,
} from '../interfaces/Assistant';

export interface AssistantModel {
  id: string;
  label: string;
  thinkingLevels: readonly ThinkingLevel[];
}

const EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const OPTIONAL_EFFORT = ['none', ...EFFORT] as const;
const GPT5_EFFORT = ['minimal', 'low', 'medium', 'high'] as const;
const GPT54_EFFORT = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
const CLAUDE46_EFFORT = ['low', 'medium', 'high', 'max'] as const;

/**
 * Curated text/tool models, verified 2026-11-22 against:
 * https://platform.claude.com/docs/en/models/overview
 * https://platform.claude.com/docs/en/build-with-claude/effort
 * https://developers.openai.com/api/docs/models
 * https://developers.openai.com/api/docs/guides/reasoning
 * Keep IDs, labels and capabilities together. Custom IDs remain supported.
 */
export const ASSISTANT_MODELS: Record<
  ApiProviderId,
  readonly AssistantModel[]
> = {
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', thinkingLevels: EFFORT },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', thinkingLevels: EFFORT },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinkingLevels: EFFORT },
    { id: 'claude-fable-5-2', label: 'Fable 5.2', thinkingLevels: EFFORT },
    {
      id: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      thinkingLevels: CLAUDE46_EFFORT,
    },
    {
      id: 'claude-opus-4-6',
      label: 'Opus 4.6',
      thinkingLevels: CLAUDE46_EFFORT,
    },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', thinkingLevels: [] },
  ],
  openai: [
    { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', thinkingLevels: EFFORT },
    { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', thinkingLevels: EFFORT },
    {
      id: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      thinkingLevels: OPTIONAL_EFFORT,
    },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', thinkingLevels: OPTIONAL_EFFORT },
    { id: 'gpt-5.5', label: 'GPT-5.5', thinkingLevels: GPT54_EFFORT },
    { id: 'gpt-5.4', label: 'GPT-5.4', thinkingLevels: GPT54_EFFORT },
    { id: 'gpt-5', label: 'GPT-5', thinkingLevels: GPT5_EFFORT },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', thinkingLevels: GPT5_EFFORT },
    { id: 'gpt-5-nano', label: 'GPT-5 nano', thinkingLevels: GPT5_EFFORT },
    { id: 'gpt-4.1', label: 'GPT-4.1', thinkingLevels: [] },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', thinkingLevels: [] },
  ],
};

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'auto',
  'none',
  'minimal',
  ...EFFORT,
];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

export function getThinkingLevels(
  provider: ProviderId,
  model: string,
): readonly ThinkingLevel[] {
  if (provider === 'ollama') return [];
  return (
    ASSISTANT_MODELS[provider].find((entry) => entry.id === model)
      ?.thinkingLevels ?? []
  );
}

/** Unknown models and incompatible per-conversation overrides use provider defaults. */
export function getThinkingProviderOptions(
  provider: ProviderId,
  model: string,
  level: ThinkingLevel | undefined,
): Record<string, Record<string, string | { type: string }>> | undefined {
  if (
    !level ||
    level === 'auto' ||
    !getThinkingLevels(provider, model).includes(level)
  ) {
    return undefined;
  }
  if (provider === 'anthropic') {
    return { anthropic: { thinking: { type: 'adaptive' }, effort: level } };
  }
  return { openai: { reasoningEffort: level } };
}
