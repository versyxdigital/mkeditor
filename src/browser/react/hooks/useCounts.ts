import * as React from 'react';

import { countCharacters, countWords } from '../../extensions/editor/WordCount';
import { useManagers } from '../contexts/ManagersContext';

export interface Counts {
  words: number;
  characters: number;
}

const EMPTY_COUNTS: Counts = { words: 0, characters: 0 };

/**
 * Subscribes to `editor:render` and recomputes word + character counts
 * from the live editor value. The counts state moves with each dispatch
 * — the same trigger that <PreviewPane> uses for its innerHTML write —
 * so the navbar counts stay in lockstep with the preview.
 */
export function useCounts(): Counts {
  const { editorManager, dispatcher } = useManagers();
  const [counts, setCounts] = React.useState<Counts>(EMPTY_COUNTS);

  React.useEffect(() => {
    const recompute = () => {
      const value = editorManager.getValue();
      setCounts({
        words: countWords(value),
        characters: countCharacters(value),
      });
    };
    dispatcher.addEventListener('editor:render', recompute);
    // Initial compute: catches the case where editor:render was fired
    // before this effect subscribed (sibling-effect ordering during boot).
    recompute();
    return () => dispatcher.removeEventListener('editor:render', recompute);
  }, [dispatcher, editorManager]);

  return counts;
}
