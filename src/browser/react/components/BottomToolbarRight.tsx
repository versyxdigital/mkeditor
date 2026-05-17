import * as React from 'react';
import { createPortal } from 'react-dom';

import { APP_VERSION } from '../../version';
import { useManagers } from '../contexts/ManagersContext';
import { useModals } from '../contexts/ModalsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

/**
 * Right-side of the bottom toolbar.
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
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-2"
        title={t('navbar:theme_switch_notice')}
      >
        <Switch
          id="darkmode-setting"
          checked={settings.darkmode}
          disabled={darkmodeDisabled}
          onCheckedChange={(v) => updateSetting('darkmode', v)}
        />
        <Label
          htmlFor="darkmode-setting"
          id="darkmode-icon"
          className={settings.darkmode ? 'text-yellow-400' : 'text-foreground'}
        >
          <Icon name="moon" />
        </Label>
      </div>
      <span
        id="app-build-id"
        className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        onClick={() => openModal('about')}
      >
        v{APP_VERSION}
      </span>
    </div>,
    host,
  );
};
