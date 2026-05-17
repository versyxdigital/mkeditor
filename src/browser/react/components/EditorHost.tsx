import * as React from 'react';

import { useManagers } from '../contexts/ManagersContext';

interface EditorHostProps {
  /**
   * Fires once after Monaco is created. The composition root uses this to
   * wire providers, the IPC bridge, splits, and the splash screen — work
   * that previously ran synchronously after `EditorManager` construction.
   */
  onReady?: () => void;
}

export const EditorHost: React.FC<EditorHostProps> = ({ onReady }) => {
  const { editorManager } = useManagers();
  const mountRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !editorManager) return;

    editorManager.create({ mount, watch: true });
    onReady?.();

    const observer = new ResizeObserver(() => editorManager.layout());
    observer.observe(mount);

    return () => {
      observer.disconnect();
      editorManager.dispose();
    };
    // `editorManager` is null on first mount (the Monaco chunk is
    // still loading via boot() in index.ts). The composition root
    // pushes the constructed instance into React state once it
    // lands, which re-runs this effect to actually instantiate
    // Monaco. EditorManager.create() is idempotent so we don't
    // need to track that ourselves.
  }, [editorManager, onReady]);

  return (
    <div
      ref={mountRef}
      id="editor"
      className="flex flex-col split-editor"
      data-testid="editor-host"
    />
  );
};
