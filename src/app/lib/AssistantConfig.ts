import type {
  ApiProviderConfig,
  AssistantStoreFile,
  ConfigSetRequest,
  OllamaProviderConfig,
  ProviderConfigMap,
  ProviderId,
} from '../interfaces/Assistant';
import { DEFAULT_PROVIDER_CONFIG } from '../interfaces/Assistant';
import { isThinkingLevel } from '../shared/assistantModels';
import { loadAssistantStore, writeAssistantStore } from './assistantStoreFile';

/**
 * AssistantConfig
 *
 * Non-secret config (enabled flags, default models, Ollama base URL)
 * for the three providers. Stored in the `config` section of
 * `~/.mkeditor/assistant.json`; shares the file with `AssistantKeyStore`
 * via `assistantStoreFile.ts`.
 *
 * Sibling to `AppSession` and `AssistantKeyStore`: pure-static, never
 * throws, returns sensible defaults when the file is missing or
 * malformed. The renderer reads this via the sanitized `from:ai:config`
 * push (which also carries `hasKey: boolean` per provider — folded in
 * by `AppBridge` from `AssistantKeyStore.hasKey`).
 */
export class AssistantConfig {
  /**
   * Read the current provider config. Always returns a fully-populated
   * `ProviderConfigMap` — missing slots are backfilled from defaults so
   * callers never have to ?-chain into nested fields.
   */
  static load(): ProviderConfigMap {
    const store = loadAssistantStore();
    return AssistantConfig.withDefaults(store.providers);
  }

  // ----- private helpers below -----

  /**
   * Replace the on-disk config with the given map. Atomic write via the
   * shared helper. Returns true on success. Use `update()` for partial
   * per-provider changes (which is what the settings UI will send).
   */
  static save(config: ProviderConfigMap): boolean {
    const store = loadAssistantStore();
    store.providers = config;
    return writeAssistantStore(store);
  }

  /**
   * Apply a partial change to one provider's config. Used by the
   * `to:ai:config:set` IPC handler in `AppBridge`. Returns the merged
   * config on success so the AppBridge can broadcast a fresh
   * `from:ai:config` push without re-reading the file.
   */
  static update(request: ConfigSetRequest): ProviderConfigMap | null {
    if (!request || !AssistantConfig.PROVIDERS.includes(request.provider))
      return null;
    const store = loadAssistantStore();
    const merged: ProviderConfigMap = {
      ...AssistantConfig.withDefaults(store.providers),
    };
    switch (request.provider) {
      case 'anthropic':
        merged.anthropic = AssistantConfig.mergeApi(
          merged.anthropic,
          request.config,
        );
        break;
      case 'openai':
        merged.openai = AssistantConfig.mergeApi(merged.openai, request.config);
        break;
      case 'ollama':
        merged.ollama = AssistantConfig.mergeOllama(
          merged.ollama,
          request.config,
        );
        break;
    }
    store.providers = merged;
    return writeAssistantStore(store) ? merged : null;
  }

  /**
   * Backfill any missing provider slots with `DEFAULT_PROVIDER_CONFIG`
   * so callers (and the renderer downstream) always see a complete
   * map. The on-disk schema validator already rejects files missing
   * top-level provider keys, but a slot can still be partially shaped
   * if a future schema bump adds a field.
   */
  private static withDefaults(
    partial: AssistantStoreFile['providers'],
  ): ProviderConfigMap {
    return {
      anthropic: AssistantConfig.mergeApi(
        DEFAULT_PROVIDER_CONFIG.anthropic,
        partial.anthropic,
      ),
      openai: AssistantConfig.mergeApi(
        DEFAULT_PROVIDER_CONFIG.openai,
        partial.openai,
      ),
      ollama: AssistantConfig.mergeOllama(
        DEFAULT_PROVIDER_CONFIG.ollama,
        partial.ollama,
      ),
    };
  }

  private static mergeApi(
    current: ApiProviderConfig,
    patch: unknown,
  ): ApiProviderConfig {
    const value =
      typeof patch === 'object' && patch !== null
        ? (patch as Record<string, unknown>)
        : {};
    return {
      enabled:
        typeof value.enabled === 'boolean' ? value.enabled : current.enabled,
      defaultModel:
        typeof value.defaultModel === 'string' && value.defaultModel.trim()
          ? value.defaultModel
          : current.defaultModel,
      ...(isThinkingLevel(value.thinkingLevel)
        ? { thinkingLevel: value.thinkingLevel }
        : current.thinkingLevel !== undefined
          ? { thinkingLevel: current.thinkingLevel }
          : {}),
    };
  }

  private static mergeOllama(
    current: OllamaProviderConfig,
    patch: unknown,
  ): OllamaProviderConfig {
    const value =
      typeof patch === 'object' && patch !== null
        ? (patch as Record<string, unknown>)
        : {};
    return {
      ...AssistantConfig.mergeApi(current, value),
      baseUrl:
        typeof value.baseUrl === 'string' && value.baseUrl.trim()
          ? value.baseUrl
          : current.baseUrl,
      ...(typeof value.contextLength === 'number' &&
      Number.isInteger(value.contextLength) &&
      value.contextLength >= 0 &&
      value.contextLength <= 1048576
        ? { contextLength: value.contextLength }
        : current.contextLength !== undefined
          ? { contextLength: current.contextLength }
          : {}),
    };
  }

  // ProviderId re-exported for callers that don't want to depend on
  // the interfaces module directly. Kept as a type-only export so it
  // gets erased at runtime.
  static readonly PROVIDERS: readonly ProviderId[] = [
    'anthropic',
    'openai',
    'ollama',
  ] as const;
}
