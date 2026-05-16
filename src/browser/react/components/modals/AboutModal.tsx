import * as React from 'react';

import { APP_VERSION } from '../../../version';
import { useModals } from '../../contexts/ModalsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';

/**
 * "About MKEditor" modal. Static info: version, credit, libraries used,
 * source link. Triggered from the build-version chip click in
 * <BottomToolbarRight> and from Ctrl+/ via CommandProvider.
 */
export const AboutModal: React.FC = () => {
  const { open, closeModal } = useModals();
  const { t } = useTranslation();

  return (
    <Dialog open={open === 'about'} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="text-center" aria-describedby={undefined}>
        <DialogTitle className="sr-only">
          {t('modals-about:version_label')} {APP_VERSION}
        </DialogTitle>
        <div className="px-6 pb-6 pt-6 text-sm text-muted-foreground">
          <img src="./icon.png" className="mx-auto mb-3 w-32" />
          <p>
            <span>{t('modals-about:version_label')}</span> {APP_VERSION}
          </p>
          <p>
            <span>{t('modals-about:built_with_love_by')}</span>{' '}
            <a
              className="font-bold text-primary no-underline"
              href="https://versyxdigital.github.io/"
              target="_blank"
              rel="noreferrer"
            >
              Versyx Digital
            </a>
            .
          </p>
          <p className="mb-1 mt-3">
            <span>{t('modals-about:libraries_intro')}</span>
          </p>
          <p>
            <span>{t('modals-about:libraries_list')}</span>
          </p>
          <p className="mb-0 mt-3">
            <span>{t('modals-about:view_source_prefix')}</span>{' '}
            <a
              className="font-bold text-primary no-underline"
              href="https://github.com/versyxdigital/mkeditor"
              target="_blank"
              rel="noreferrer"
            >
              <span>{t('modals-about:view_source_here')}</span>
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
