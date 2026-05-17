import * as React from 'react';

import { useProperties } from '../../contexts/PropertiesContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * File/folder properties modal. Triggered by the explorer right-click
 * "Show properties" item, which sends `to:file:properties` over the
 * bridge; the main process replies with `from:path:properties` carrying
 * a FileProperties payload, which BridgeListeners routes here via
 * `showPropertiesExternal`.
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
        <div className="px-4 pb-4 text-sm">
          {info && <PropertiesBody info={info} t={t} />}
          <div className="mt-4 flex justify-end">
            <Button type="button" size="sm" onClick={close}>
              {t('modals-properties:close_button')}
            </Button>
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
    <dl className="m-0 text-left text-xs">
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
  <div className="mb-2 flex gap-2">
    <dt className="font-semibold text-foreground shrink-0">{label}</dt>
    <dd className="m-0 break-all">{value}</dd>
  </div>
);
