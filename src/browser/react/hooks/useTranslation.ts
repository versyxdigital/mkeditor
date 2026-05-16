import * as React from 'react';
import i18next from 'i18next';

import { t } from '../../i18n';

/**
 * Subscribe to every i18next event that affects whether `t(...)`
 * resolves to real translations or to the raw key:
 *
 *  - `languageChanged` — user switched locale, OR the boot-time
 *    `changeLanguage(lng)` finally lands when the target differs from
 *    `init()`'s lng.
 *  - `initialized`     — i18next.init() resolved. Fires AFTER React
 *    mounts because `initI18n`'s promise chain is fire-and-forget.
 *  - `added`           — a namespace bundle was added via
 *    `addResourceBundle`. This is how `loadCombinedBundle` /
 *    `loadFallbackBundles` deliver translations into i18next (we
 *    don't use a backend loader, so `loaded` never fires). Without
 *    listening to this, the first-render keys would stay visible
 *    until the user manually switched language.
 *
 * `languageChanged` alone is NOT enough: i18next 25 treats
 * `changeLanguage(currentLng)` as a no-op, so when the user's locale
 * happens to match the value passed to `init()` (the common case on
 * boot) no `languageChanged` event ever fires.
 *
 * The bump counter that backs the snapshot is what guarantees a
 * re-render even when neither the initialised flag nor the language
 * code actually change between events (e.g. multiple `added` events
 * for the same locale's namespaces).
 */
let eventBump = 0;

function subscribe(callback: () => void) {
  const fire = () => {
    eventBump += 1;
    callback();
  };
  i18next.on('languageChanged', fire);
  i18next.on('initialized', fire);
  i18next.on('added', fire);
  return () => {
    i18next.off('languageChanged', fire);
    i18next.off('initialized', fire);
    i18next.off('added', fire);
  };
}

/**
 * String snapshot suitable for `===` comparison. Encodes the bump
 * counter so EVERY notable i18next event invalidates `useMemo`s that
 * depend on it (e.g. the explorer context menu items).
 */
function getSnapshot(): string {
  return `${eventBump}|${i18next.isInitialized ? '1' : '0'}|${i18next.language ?? ''}`;
}

/**
 * Thin React hook over the existing i18next instance. Triggers a
 * re-render of the consumer when i18next initialises, when a new
 * locale bundle loads, or when the user switches language.
 *
 * `language` is the snapshot string described above — pass it as a
 * `useMemo`/`useCallback` dependency in components that build
 * translated values eagerly (e.g. the explorer context menu).
 */
export function useTranslation() {
  const language = React.useSyncExternalStore(subscribe, getSnapshot);
  return { t, language };
}
