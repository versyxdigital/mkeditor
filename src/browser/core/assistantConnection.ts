import type {
  ProviderId,
  SanitizedProviderConfig,
} from '../../app/interfaces/Assistant';
import type { ChatGptSnapshot } from '../../app/interfaces/ChatGpt';

export type AssistantConnection =
  | 'loading'
  | 'ready'
  | 'missing-key'
  | 'signed-out'
  | 'permission-required'
  | 'unavailable'
  | 'connecting';

/** One credential-readiness rule for the composer, onboarding and send guard. */
export function getAssistantConnection(
  provider: ProviderId,
  snapshot: {
    config: SanitizedProviderConfig | null;
    encryptionAvailable: boolean;
    chatgpt?: ChatGptSnapshot;
  },
): AssistantConnection {
  if (!snapshot.config) return 'loading';
  if (provider === 'ollama') return 'ready';
  if (!snapshot.encryptionAvailable) return 'unavailable';
  const auth = snapshot.chatgpt;
  if (provider === 'openai' && auth?.mode === 'chatgpt') {
    if (auth.busy || auth.signingIn) return 'connecting';
    if (!auth.connected || auth.error === 'sign_in_required')
      return 'signed-out';
    if (auth.planEnabled === false || auth.error === 'permission_required')
      return 'permission-required';
    return 'ready';
  }
  return snapshot.config[provider].hasKey ? 'ready' : 'missing-key';
}
