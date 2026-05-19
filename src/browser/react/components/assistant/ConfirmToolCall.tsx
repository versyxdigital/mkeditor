import * as React from 'react';

import { useToolConfirm } from '../../contexts/ToolConfirmContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Icon } from '../Icon';

/**
 * Tool-call confirmation dialog.
 *
 * Driven by `ToolConfirmContext`: whenever a write-class tool fires
 * (and the conversation doesn't have `autoAcceptWrites`), the
 * AssistantManager opens this dialog via the `confirmToolCallExternal`
 * seam. The user accepts → manager executes the tool; rejects → an
 * error-shaped tool-result is sent back so the model can recover.
 *
 * The preview is best-effort plain-text diff for v1. A future P8
 * polish could swap to Monaco's `diffEditor` — the structural payload
 * already carries `before` / `after` strings, so the swap is local.
 */
export const ConfirmToolCall: React.FC = () => {
  const { request, resolve } = useToolConfirm();
  const { t } = useTranslation();

  const open = request !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resolve(false);
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="exclamation-circle" />
            <span>
              {request
                ? t('assistant-tools:confirm_title', {
                    toolName: request.toolName,
                  })
                : t('assistant-tools:confirm_title_fallback')}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 text-sm">
          {request && (
            <>
              <p className="text-muted-foreground">
                {t('assistant-tools:confirm_intro')}
              </p>

              {request.preview ? (
                <PreviewBlock preview={request.preview} />
              ) : (
                <ArgsBlock args={request.arguments} />
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => resolve(false)}
                  data-testid="tool-confirm-reject"
                >
                  {t('assistant-tools:confirm_reject')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => resolve(true)}
                  data-testid="tool-confirm-accept"
                >
                  {t('assistant-tools:confirm_accept')}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------- */
/*  Preview blocks                                                        */
/* -------------------------------------------------------------------- */

const PREVIEW_KIND_LABEL: Record<
  NonNullable<
    NonNullable<ReturnType<typeof useToolConfirm>['request']>['preview']
  >['kind'],
  string
> = {
  create: 'assistant-tools:preview_create',
  write: 'assistant-tools:preview_write',
  edit: 'assistant-tools:preview_edit',
  replace: 'assistant-tools:preview_replace',
  insert: 'assistant-tools:preview_insert',
};

const PreviewBlock: React.FC<{
  preview: NonNullable<
    NonNullable<ReturnType<typeof useToolConfirm>['request']>['preview']
  >;
}> = ({ preview }) => {
  const { t } = useTranslation();
  const headingKey = PREVIEW_KIND_LABEL[preview.kind];
  return (
    <div
      className="mt-3 flex flex-col gap-2"
      data-testid="tool-confirm-preview"
    >
      <p className="text-xs font-semibold">
        {t(headingKey, { path: preview.path ?? '' })}
        {preview.detail ? ` · ${preview.detail}` : ''}
      </p>
      {preview.before !== undefined && (
        <div>
          <p className="text-xs text-muted-foreground">
            {t('assistant-tools:preview_before')}
          </p>
          <pre className="max-h-40 overflow-auto rounded border border-red-400/40 bg-red-50 p-2 text-xs text-red-900 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200">
            {preview.before}
          </pre>
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">
          {t('assistant-tools:preview_after')}
        </p>
        <pre className="max-h-60 overflow-auto rounded border border-emerald-400/40 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-200">
          {preview.after}
        </pre>
      </div>
    </div>
  );
};

const ArgsBlock: React.FC<{ args: unknown }> = ({ args }) => {
  const { t } = useTranslation();
  return (
    <div className="mt-3" data-testid="tool-confirm-args">
      <p className="text-xs text-muted-foreground">
        {t('assistant-tools:args_label')}
      </p>
      <pre className="max-h-40 overflow-auto rounded border border-border bg-muted p-2 text-xs">
        {JSON.stringify(args, null, 2)}
      </pre>
    </div>
  );
};
