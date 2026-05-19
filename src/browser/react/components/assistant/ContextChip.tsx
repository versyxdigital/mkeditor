import * as React from 'react';

import type { AssistantContextChip } from '../../../core/AssistantManager';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Icon } from '../Icon';

/**
 * Row of context chips above the chat input. Renders one pill per
 * `AssistantContextChip` the manager surfaces — active file,
 * selection, and `@`-mentions. Each chip has a × button that removes
 * the corresponding context.
 *
 * Removal semantics differ by kind: × on an `active` / `selection`
 * chip flips the per-conversation toggle off (so it stays off for
 * subsequent sends until the user re-enables it via the gear
 * popover); × on a `mention` chip removes the explicit mention
 * permanently. This matches the doc's "chips re-attach automatically
 * unless the toggle is off" wording.
 */
export interface ContextChipsRowProps {
  chips: AssistantContextChip[];
  onRemoveActive: () => void;
  onRemoveSelection: () => void;
  onRemoveMention: (path: string) => void;
}

export const ContextChipsRow: React.FC<ContextChipsRowProps> = ({
  chips,
  onRemoveActive,
  onRemoveSelection,
  onRemoveMention,
}) => {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-1 border-t border-border px-2 py-1.5"
      data-testid="context-chips"
    >
      {chips.map((chip) => {
        const key =
          chip.kind === 'selection'
            ? 'selection'
            : `${chip.kind}:${chip.path ?? ''}`;
        const handleRemove = () => {
          if (chip.kind === 'active') onRemoveActive();
          else if (chip.kind === 'selection') onRemoveSelection();
          else if (chip.path) onRemoveMention(chip.path);
        };
        return (
          <span
            key={key}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs',
              chip.kind === 'active' && 'border-primary/40',
            )}
            title={chip.path ?? chip.label}
            data-testid={`context-chip-${chip.kind}`}
            data-path={chip.path ?? ''}
          >
            <span className="max-w-[200px] truncate">{chip.label}</span>
            <button
              type="button"
              onClick={handleRemove}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('assistant-chat:remove_context_chip', {
                label: chip.label,
              })}
            >
              <Icon name="times" />
            </button>
          </span>
        );
      })}
    </div>
  );
};
