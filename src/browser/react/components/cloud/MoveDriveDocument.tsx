import * as React from 'react';
import { useCloud } from '../../hooks/useCloud';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Icon } from '../Icon';
import { GoogleDriveLogo } from './GoogleBrand';

export const MoveDriveDocument: React.FC = () => {
  const { manager, state } = useCloud();
  const { t } = useTranslation();
  const picker = state.movePicker;
  const location = picker?.folders.at(-1);
  return (
    <Dialog
      open={Boolean(picker)}
      onOpenChange={(open) => !open && manager?.closeMove()}
    >
      <DialogContent
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (picker?.moving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('cloud:move_to')}</DialogTitle>
        </DialogHeader>
        {picker && (
          <div className="space-y-4 px-6 pb-6 text-sm">
            <p className="truncate font-medium" title={picker.item.name}>
              {picker.item.name}
            </p>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex h-10 items-center gap-2 border-b border-border px-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t('cloud:back')}
                  disabled={
                    picker.folders.length < 2 || picker.loading || picker.moving
                  }
                  onClick={() =>
                    void manager?.browseMove(picker.folders.slice(0, -1))
                  }
                >
                  <Icon name="chevron-left" />
                </Button>
                <GoogleDriveLogo />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={picker.folders
                    .map((folder) =>
                      folder.id === 'root' ? t('cloud:my_drive') : folder.name,
                    )
                    .join(' / ')}
                >
                  {location?.id === 'root'
                    ? t('cloud:my_drive')
                    : location?.name}
                </span>
              </div>
              <div
                className="thin-scrollbars h-64 overflow-y-auto p-1"
                aria-label={t('cloud:destination')}
                aria-busy={picker.loading || picker.moving}
              >
                {picker.loading ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
                  >
                    <Icon
                      name="circle-notch"
                      className="animate-spin motion-reduce:animate-none"
                    />
                    {t('cloud:loading')}
                  </p>
                ) : (
                  <>
                    {picker.items.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        disabled={picker.moving}
                        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() =>
                          void manager?.browseMove([
                            ...picker.folders,
                            { id: folder.id, name: folder.name },
                          ])
                        }
                      >
                        <Icon
                          name="folder"
                          className="shrink-0 text-muted-foreground"
                        />
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={folder.name}
                        >
                          {folder.name}
                        </span>
                        <Icon
                          name="chevron-right"
                          className="size-2.5 text-muted-foreground"
                        />
                      </button>
                    ))}
                    {!picker.items.length && !picker.error && (
                      <p className="p-3 text-xs text-muted-foreground">
                        {t('cloud:no_folders')}
                      </p>
                    )}
                    {picker.nextPage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={picker.moving}
                        onClick={() =>
                          void manager?.browseMove(picker.folders, true)
                        }
                      >
                        {t('cloud:load_more')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {picker.error && (
              <div role="alert" className="text-xs text-destructive">
                {t(`cloud:error_${picker.error}`)}{' '}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => void manager?.browseMove(picker.folders)}
                >
                  {t('cloud:refresh')}
                </Button>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={picker.moving}
                onClick={() => manager?.closeMove()}
              >
                {t('cloud:cancel')}
              </Button>
              <Button
                size="sm"
                disabled={
                  picker.loading ||
                  picker.moving ||
                  Boolean(picker.error) ||
                  !location ||
                  location.id === picker.sourceFolderId
                }
                onClick={() => void manager?.confirmMove()}
              >
                {picker.moving && (
                  <Icon
                    name="circle-notch"
                    className="animate-spin motion-reduce:animate-none"
                  />
                )}
                {t(picker.moving ? 'cloud:moving' : 'cloud:move_here')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
