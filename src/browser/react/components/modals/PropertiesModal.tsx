import * as React from 'react';

import { useProperties } from '../../contexts/PropertiesContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * File/folder properties modal. Phase 8 replaces the legacy
 * `showFilePropertiesWindow` SweetAlert2 popup in dom.ts. Triggered by
 * the explorer right-click "Show properties" item, which sends
 * `to:file:properties` over the bridge; the main process replies with
 * `from:path:properties` carrying a FileProperties payload, which
 * BridgeListeners routes here via `showPropertiesExternal`.
 */
export const PropertiesModal: React.FC = () => {
  const { info, close } = useProperties();
  const { t } = useTranslation();

  const open = info !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('modals-properties:title')}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 small">
          {info && <PropertiesBody info={info} t={t} />}
          <div className="d-flex justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-sm btn-primary rounded-1"
              onClick={close}
            >
              {t('modals-properties:close_button')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const PropertiesBody: React.FC<{
  info: NonNullable<ReturnType<typeof useProperties>['info']>;
  t: (key: string) => string;
}> = ({ info, t }) => {
  const pathType = info.isDirectory
    ? t('modals-properties:type_directory')
    : t('modals-properties:type_file');

  return (
    <dl className="mb-0 small text-start">
      <Row label={t('modals-properties:label_path')} value={info.path} />
      <Row label={t('modals-properties:label_type')} value={pathType} />
      <Row
        label={t('modals-properties:label_size')}
        value={String(info.size)}
      />
      <Row
        label={t('modals-properties:label_created')}
        value={new Date(info.created).toLocaleString()}
      />
      <Row
        label={t('modals-properties:label_modified')}
        value={new Date(info.modified).toLocaleString()}
      />
    </dl>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <>
    <dt className="col-auto fw-semibold me-2">{label}</dt>
    <dd className="col-auto me-4 text-break">{value}</dd>
  </>
);
