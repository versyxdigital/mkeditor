import * as React from 'react';
import { createPortal } from 'react-dom';
import { useCounts } from '../hooks/useCounts';
import { useTranslation } from '../hooks/useTranslation';

/** Quiet document statistics, separate from primary navigation and formatting. */
export const DocumentStatus: React.FC = () => {
  const { t } = useTranslation();
  const counts = useCounts();
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(document.getElementById('document-status'));
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="flex min-w-0 items-center gap-4 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
      <span>
        {t('navbar:word_count')} <span id="word-count">{counts.words}</span>
      </span>
      <span className="hidden xl:inline">
        {t('navbar:character_count')}{' '}
        <span id="character-count">{counts.characters}</span>
      </span>
    </div>,
    host,
  );
};
