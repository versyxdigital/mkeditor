import React from 'react';
import Toolbar from './Toolbar';

export default function EditorLayout() {
  return (
    <div id="app" className="d-flex flex-row h-100">
      <div className="w-100 border-top">
        <div id="wrapper" className="d-flex flex-row">
          <div id="editor-split">
            <div id="editor" className="flex-column split-editor" />
          </div>
          <div id="preview-split">
            <div id="preview" className="flex-column split-preview p-3" />
          </div>
        </div>
        <Toolbar />
      </div>
    </div>
  );
}
