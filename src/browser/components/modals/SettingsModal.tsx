import React from 'react';

export default function SettingsModal() {
  return (
    <div className="modal" tabIndex={-1} id="app-settings">
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header border-bottom-0">
            <h5 className="modal-title">MKEditor settings</h5>
            <button
              type="button"
              className="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            />
          </div>
          <div className="modal-body small pt-0">
            <p className="text-muted">
              Here you can customize various editor settings according to your
              preferences, settings are automatically saved as they are updated.
            </p>
            <p className="text-muted" id="app-settings-file-info">
              Your settings file is located at
              <span className="font-monospace small">
                ~/.mkeditor/settings.json
              </span>
              .
            </p>
            <hr />
            <p className="text-muted">
              <strong>Formatting</strong>
            </p>
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input setting"
                id="autoindent-setting"
              />
              <label
                className="form-check-label d-flex flex-column"
                htmlFor="autoindent-setting"
              >
                <span>Toggle automatic indentation</span>
                <small className="text-muted">
                  Automatically indent text on new lines.
                </small>
              </label>
            </div>
            <div className="form-check mt-3">
              <input
                type="checkbox"
                className="form-check-input setting"
                id="wordwrap-setting"
              />
              <label
                className="form-check-label d-flex flex-column"
                htmlFor="wordwrap-setting"
              >
                <span>Toggle word-wrapping</span>
                <small className="text-muted">
                  Automatically break lines to fit the width of the editor.
                </small>
              </label>
            </div>
            <hr />
            <p className="text-muted">
              <strong>Editing</strong>
            </p>
            <div className="form-check mt-3">
              <input
                type="checkbox"
                className="form-check-input setting"
                id="whitespace-setting"
              />
              <label
                className="form-check-label d-flex flex-column"
                htmlFor="whitespace-setting"
              >
                <span>Render whitespace</span>
                <small className="text-muted">
                  Display whitespace characters.
                </small>
              </label>
            </div>
            <hr />
            <p className="text-muted">
              <strong>Miscellaneous</strong>
            </p>
            <div className="form-check mt-3">
              <input
                type="checkbox"
                className="form-check-input setting"
                id="minimap-setting"
              />
              <label
                className="form-check-label d-flex flex-column"
                htmlFor="minimap-setting"
              >
                <span>Display minimap</span>
                <small className="text-muted">
                  Display the editor minimap.
                </small>
              </label>
            </div>
            <div className="form-check mt-3">
              <input
                type="checkbox"
                className="form-check-input setting"
                id="systemtheme-setting"
              />
              <label
                className="form-check-label d-flex flex-column"
                htmlFor="systemtheme-setting"
              >
                <span>Use system theme</span>
                <small className="text-muted">
                  Let your system theme override your stored settings.
                </small>
              </label>
            </div>
            <hr />
            <div className="form-group d-flex align-items-center gap-3 mt-4 mb-3">
              <button
                id="app-settings-save"
                className="btn btn-sm btn-primary rounded-1"
              >
                <i className="fas fa-save"></i>
                <span className="ms-1">Save Settings</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
