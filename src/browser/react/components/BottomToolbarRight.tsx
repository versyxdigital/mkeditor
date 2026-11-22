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
 * Theme and version controls in the document status row.
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
          checked={settings.effectiveDarkmode}
          disabled={darkmodeDisabled}
          onCheckedChange={(v) => updateSetting('darkmode', v)}
        />
        <Label
          htmlFor="darkmode-setting"
          id="darkmode-icon"
          className="text-muted-foreground"
        >
          <Icon name="moon" />
        </Label>
      </div>
      <button
        type="button"
        id="app-build-id"
        className="inline-flex h-6 cursor-pointer items-center rounded-sm px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => openModal('about')}
      >
        v{APP_VERSION}
      </button>
    </div>,
    host,
  );
};
