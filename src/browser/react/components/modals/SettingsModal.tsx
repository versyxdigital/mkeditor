import * as React from 'react';

import {
  getAvailableLocales,
  normalizeLanguage,
  type LocaleInfo,
} from '../../../i18n';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Editor settings dialog. Drives SettingsContext directly — every input
 * change calls `updateSetting(key, value)` which writes state, applies
 * the Monaco/theme side effect, emits to subscribers, and persists.
 * The explicit "Save Settings" button preserves the legacy UX (desktop
 * pushes the combined settings+exportSettings payload to the main
 * process); under web mode the per-change persist already handled it.
 */
export const SettingsModal: React.FC = () => {
  const { mode, bridgeManager, providers } = useManagers();
  const { open, closeModal } = useModals();
  const { settings, updateSetting } = useSettings();
  const { t } = useTranslation();

  const [locales, setLocales] = React.useState<LocaleInfo[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    getAvailableLocales()
      .then((list) => {
        if (cancelled) return;
        list.sort(
          (a, b) =>
            a.native.localeCompare(b.native) || a.code.localeCompare(b.code),
        );
        setLocales(list);
      })
      .catch(() => {
        // no-op; the select will just be empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = () => {
    if (
      mode === 'desktop' &&
      bridgeManager &&
      providers.settings &&
      providers.exportSettings
    ) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: providers.exportSettings.getSettings(),
      });
    }
    closeModal();
  };

  return (
    <Dialog open={open === 'settings'} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('modals-settings:title')}</DialogTitle>
        </DialogHeader>
        <div className="modal-body small pt-0">
          <p className="text-muted">{t('modals-settings:intro')}</p>
          {mode === 'desktop' && (
            <p className="text-muted">
              <span>{t('modals-settings:settings_file_info')}</span>{' '}
              <span className="font-monospace small">
                ~/.mkeditor/settings.json
              </span>
              .
            </p>
          )}

          <hr />
          <p className="text-muted">
            <strong>{t('modals-settings:formatting')}</strong>
          </p>
          <ToggleRow
            id="autoindent-setting"
            label={t('modals-settings:autoindent_label')}
            help={t('modals-settings:autoindent_help')}
            checked={settings.autoindent}
            onChange={(v) => updateSetting('autoindent', v)}
          />
          <ToggleRow
            id="wordwrap-setting"
            label={t('modals-settings:wordwrap_label')}
            help={t('modals-settings:wordwrap_help')}
            checked={settings.wordwrap}
            onChange={(v) => updateSetting('wordwrap', v)}
            className="mt-3"
          />

          <hr />
          <p className="text-muted">
            <strong>{t('modals-settings:editing')}</strong>
          </p>
          <ToggleRow
            id="whitespace-setting"
            label={t('modals-settings:whitespace_label')}
            help={t('modals-settings:whitespace_help')}
            checked={settings.whitespace}
            onChange={(v) => updateSetting('whitespace', v)}
            className="mt-3"
          />

          <hr />
          <p className="text-muted">
            <strong>{t('modals-settings:miscellaneous')}</strong>
          </p>
          <ToggleRow
            id="minimap-setting"
            label={t('modals-settings:minimap_label')}
            help={t('modals-settings:minimap_help')}
            checked={settings.minimap}
            onChange={(v) => updateSetting('minimap', v)}
            className="mt-3"
          />
          <ToggleRow
            id="scrollsync-setting"
            label={t('modals-settings:scrollsync_label')}
            help={t('modals-settings:scrollsync_help')}
            checked={settings.scrollsync}
            onChange={(v) => updateSetting('scrollsync', v)}
            className="mt-3"
          />

          <hr />
          <p className="text-muted">
            <strong>{t('modals-settings:appearance')}</strong>
          </p>
          {mode === 'desktop' && (
            <ToggleRow
              id="systemtheme-setting"
              label={t('modals-settings:systemtheme_label')}
              help={t('modals-settings:systemtheme_help')}
              checked={settings.systemtheme}
              onChange={(v) => updateSetting('systemtheme', v)}
              className="mt-3"
            />
          )}
          <div className="form-group mt-3">
            <label htmlFor="locale-setting" className="form-label">
              {t('modals-settings:language_label')}
            </label>
            <select
              id="locale-setting"
              className="form-select form-select-sm"
              value={normalizeLanguage(settings.locale || 'en')}
              onChange={(e) => updateSetting('locale', e.target.value)}
            >
              {locales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} ({l.name})
                </option>
              ))}
            </select>
            <small className="text-muted">
              {t('modals-settings:language_help')}
            </small>
          </div>

          <hr />
          <div className="form-group d-flex align-items-center gap-3 mt-4 mb-3">
            <button
              type="button"
              className="btn btn-sm btn-primary rounded-1"
              onClick={handleSave}
            >
              <Icon name="save" />
              <span className="ms-1">{t('modals-settings:save_settings')}</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface ToggleRowProps {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  id,
  label,
  help,
  checked,
  onChange,
  className,
}) => (
  <div className={`form-check ${className ?? ''}`.trim()}>
    <input
      type="checkbox"
      className="form-check-input setting"
      id={id}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <label className="form-check-label d-flex flex-column" htmlFor={id}>
      <span>{label}</span>
      <small className="text-muted">{help}</small>
    </label>
  </div>
);
