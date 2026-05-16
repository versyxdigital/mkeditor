import * as React from 'react';
import { createPortal } from 'react-dom';

import { APP_VERSION } from '../../version';
import { useManagers } from '../contexts/ManagersContext';
import { useModals } from '../contexts/ModalsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';

/**
 * Right-side of the bottom toolbar. Phase 6 left this `<ul>` legacy
 * (darkmode toggle + build-version chip); Phase 7 brings it into React
 * because its two dependencies — SettingsContext (darkmode) and
 * ModalsContext (about modal) — are now React.
 *
 * Rendered via `createPortal` into a stable host (`#bottom-toolbar-right`)
 * inside the legacy bottom `<nav>` shell. The `<nav>` itself stays in
 * static HTML so the `fixed-bottom` Bootstrap positioning continues to
 * work without restyling.
 */
export const BottomToolbarRight: React.FC = () => {
  const { mode } = useManagers();
  const { settings, updateSetting } = useSettings();
  const { openModal } = useModals();
  const { t } = useTranslation();

  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(document.getElementById('bottom-toolbar-right'));
  }, []);
  if (!host) return null;

  // Disabling the darkmode toggle when systemtheme is on is desktop-only
  // (the system-theme override is hidden in web mode).
  const darkmodeDisabled = mode === 'desktop' && settings.systemtheme;

  return createPortal(
    <>
      <li className="nav-item">
        <div
          className="form-check form-switch me-2"
          title={t('navbar:theme_switch_notice')}
        >
          <input
            type="checkbox"
            className="form-check-input"
            id="darkmode-setting"
            checked={settings.darkmode}
            disabled={darkmodeDisabled}
            onChange={(e) => updateSetting('darkmode', e.target.checked)}
          />
          <label
            className={`form-check-label ms-1 ${
              settings.darkmode ? 'text-warning' : 'text-dark'
            }`}
            htmlFor="darkmode-setting"
            id="darkmode-icon"
          >
            <Icon name="moon" />
          </label>
        </div>
      </li>
      <li className="nav-item">
        <span
          className="text-muted"
          id="app-build-id"
          style={{ cursor: 'pointer' }}
          onClick={() => openModal('about')}
        >
          v{APP_VERSION}
        </span>
      </li>
    </>,
    host,
  );
};
