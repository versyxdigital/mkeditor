import * as React from 'react';

import type { ExportSettings } from '../../../interfaces/Editor';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useExportSettings } from '../../contexts/ExportSettingsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../Icon';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * HTML/PDF export settings dialog. ExportSettingsContext drives every
 * input change through `updateSetting(key, value)`, which already
 * (a) runs `syncPreviewToExportSettings` so the live preview reflects
 * the change immediately and (b) schedules a debounced persist
 * (250ms default, 400ms for the lineSpacing slider).
 */
export const ExportSettingsModal: React.FC = () => {
  const { mode, bridgeManager, providers } = useManagers();
  const { open, closeModal } = useModals();
  const { settings, updateSetting } = useExportSettings();
  const { t } = useTranslation();

  const handleSave = () => {
    if (mode === 'desktop' && bridgeManager && providers.settings) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: settings,
      });
    }
    closeModal();
  };

  const handleReset = () => {
    const defaults = providers.exportSettings?.getDefaultSettings();
    if (!defaults) return;
    (Object.keys(defaults) as (keyof ExportSettings)[]).forEach((key) => {
      updateSetting(key, defaults[key] as never);
    });
    if (mode === 'desktop' && bridgeManager && providers.settings) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: defaults,
      });
    }
  };

  return (
    <Dialog
      open={open === 'exportSettings'}
      onOpenChange={(o) => !o && closeModal()}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('modals-export:title')}</DialogTitle>
        </DialogHeader>
        <div className="modal-body small pt-0">
          <p className="text-muted">{t('modals-export:intro')}</p>
          {mode === 'desktop' && (
            <p className="text-muted">
              {t('modals-export:settings_file_info')}
            </p>
          )}

          <hr />
          <div className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              id="export-with-styles"
              checked={settings.withStyles}
              onChange={(e) => updateSetting('withStyles', e.target.checked)}
            />
            <label
              className="form-check-label d-flex flex-column"
              htmlFor="export-with-styles"
            >
              <span>{t('modals-export:export_with_styles_label')}</span>
              <small className="text-muted">
                {t('modals-export:export_with_styles_help')}
              </small>
            </label>
          </div>

          <hr />
          <div className="form-group mt-3">
            <label htmlFor="export-setting-container" className="form-label">
              {t('modals-export:set_container_label')}
            </label>
            <select
              id="export-setting-container"
              className="form-select form-select-sm"
              value={settings.container}
              onChange={(e) =>
                updateSetting(
                  'container',
                  e.target.value as ExportSettings['container'],
                )
              }
            >
              <option value="container">
                {t('modals-export:set_container_option_container')}
              </option>
              <option value="container-fluid">
                {t('modals-export:set_container_option_container_fluid')}
              </option>
            </select>
            <small className="text-muted">
              {t('modals-export:set_container_help')}
            </small>
          </div>

          <div className="form-group mt-3">
            <label htmlFor="export-setting-fontsize" className="form-label">
              {t('modals-export:set_font_size_label')}
            </label>
            <input
              type="number"
              id="export-setting-fontsize"
              className="form-control form-control-sm"
              min={6}
              max={72}
              value={settings.fontSize}
              onChange={(e) =>
                updateSetting(
                  'fontSize',
                  Math.max(6, parseInt(e.target.value, 10) || 16),
                )
              }
            />
            <small className="text-muted">
              {t('modals-export:set_font_size_help')}
            </small>
          </div>

          <div className="form-group mt-3">
            <label htmlFor="export-setting-linespacing" className="form-label">
              {t('modals-export:set_line_spacing_label')}
            </label>
            <input
              type="range"
              id="export-setting-linespacing"
              className="form-range mb-0"
              min={1}
              max={3}
              step={0.1}
              value={settings.lineSpacing}
              onChange={(e) =>
                updateSetting('lineSpacing', parseFloat(e.target.value))
              }
            />
            <small className="text-muted">
              {t('modals-export:set_line_spacing_help')}
            </small>
          </div>

          <hr />
          <div className="d-flex flex-wrap align-items-center gap-5 mt-3">
            <ColorField
              id="export-setting-background"
              label={t('modals-export:set_background_colour_label')}
              help={t('modals-export:set_background_colour_help')}
              value={settings.background}
              onChange={(v) => updateSetting('background', v)}
            />
            <ColorField
              id="export-setting-font-color"
              label={t('modals-export:set_font_colour_label')}
              help={t('modals-export:set_font_colour_help')}
              value={settings.fontColor}
              onChange={(v) => updateSetting('fontColor', v)}
            />
          </div>

          <div className="form-group d-flex align-items-center gap-3 mt-4 mb-3">
            <button
              type="button"
              className="btn btn-sm btn-primary rounded-1"
              onClick={handleSave}
            >
              <Icon name="save" />
              <span className="ms-1">{t('modals-export:save_settings')}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary rounded-1"
              onClick={handleReset}
            >
              <Icon name="refresh" />
              <span className="ms-1">
                {t('modals-export:reset_to_default')}
              </span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface ColorFieldProps {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (next: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  help,
  value,
  onChange,
}) => (
  <div className="form-group">
    <label htmlFor={id} className="form-label">
      {label}
    </label>
    <div className="d-flex align-items-center gap-2 mb-2">
      <input
        type="color"
        id={id}
        className="form-control form-control-sm form-control-color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="small text-muted">{value.toUpperCase()}</span>
    </div>
    <small className="text-muted">{help}</small>
  </div>
);
