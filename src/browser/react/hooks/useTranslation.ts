import * as React from 'react';
import i18next from 'i18next';

import { t } from '../../i18n';

/**
 * Thin React hook over the existing i18next instance. Triggers a re-render
 * of the consumer when the language changes, so labels and tooltips stay
 * in sync with `setLanguage(...)` calls from anywhere in the app.
 */
export function useTranslation() {
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    const handler = () => forceUpdate();
    i18next.on('languageChanged', handler);
    return () => {
      i18next.off('languageChanged', handler);
    };
  }, []);

  return { t };
}
