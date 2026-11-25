import { fakeAssistantManager } from '../utils/render';
import {
  DEFAULT_PROVIDER_CONFIG,
  type ConfigPushPayload,
} from '../../src/app/interfaces/Assistant';

export const connectedSnapshot: ConfigPushPayload = {
  encryptionAvailable: true,
  config: {
    anthropic: {
      ...DEFAULT_PROVIDER_CONFIG.anthropic,
      enabled: true,
      hasKey: true,
    },
    openai: { ...DEFAULT_PROVIDER_CONFIG.openai, enabled: true, hasKey: true },
    ollama: { ...DEFAULT_PROVIDER_CONFIG.ollama, enabled: true, hasKey: false },
  },
};

export function connectedAssistant(
  init: Parameters<typeof fakeAssistantManager>[0] = {},
) {
  return fakeAssistantManager({ initialSnapshot: connectedSnapshot, ...init });
}
