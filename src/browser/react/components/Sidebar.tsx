import * as React from 'react';

/**
 * Sidebar shell. Phase 3 keeps the legacy explorer markup so
 * FileTreeManager can continue to populate `#file-tree` via `dom.filetree`
 * (a lazy getter that resolves after this component mounts). Phase 5
 * turns the file tree into an actual React component.
 */
export const Sidebar: React.FC = () => (
  <div id="sidebar" className="p-3 d-flex flex-column">
    <div className="explorer-title" data-i18n-text="sidebar:explorer">
      Explorer
    </div>
    <ul id="file-tree" className="list-unstyled mb-0 flex-fill" />
  </div>
);
