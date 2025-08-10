import React from 'react';

export default function Toolbar() {
  return (
    <nav className="navbar navbar-light bg-light fixed-bottom border-top p-2">
      <div
        className="d-flex justify-content-start align-items-center"
        id="editor-functions"
      >
        <div className="btn-group btn-group-sm me-2">
          <button
            className="btn btn-outline-secondary shortcut"
            data-cmd="bold"
            data-key="B"
            data-syntax="**"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="Ctrl + B"
          >
            <i className="fa fa-bold"></i>
          </button>
          <button
            className="btn btn-outline-secondary shortcut"
            data-cmd="italic"
            data-key="I"
            data-syntax="_"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="Ctrl + I"
          >
            <i className="fa fa-italic"></i>
          </button>
          <button
            className="btn btn-outline-secondary shortcut"
            data-cmd="strikethrough"
            data-key="G"
            data-syntax="~~"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="Ctrl + G"
          >
            <i className="fa fa-strikethrough"></i>
          </button>
        </div>
        <div className="btn-group btn-group-sm me-2">
          <button
            className="btn btn-outline-secondary shortcut"
            data-cmd="unorderedList"
            data-key="1"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="Ctrl + 1"
          >
            <i className="fa fa-list-ul"></i>
          </button>
          <button
            className="btn btn-outline-secondary shortcut"
            data-cmd="orderedList"
            data-key="2"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="Ctrl + 2"
          >
            <i className="fa fa-list-ol"></i>
          </button>
        </div>
        <div
          className="btn-group btn-group-sm dropup me-2"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title="Ctrl + K"
          data-key="K"
        >
          <button
            className="btn btn-outline-secondary dropdown-toggle shortcut"
            type="button"
            id="codeblock-menu-button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i className="fas fa-code"></i>
          </button>
          <div
            className="dropdown-menu"
            id="codeblocks"
            aria-labelledby="codeblock-menu-button"
          >
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="sh"
            >
              <i className="fas fa-terminal"></i> <u>S</u>hell
            </button>
            <div className="dropdown-divider" />
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="csharp"
            >
              <i className="fas fa-code"></i> <u>C</u>
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="javascript"
            >
              <i className="fas fa-code"></i> <u>J</u>avascript
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="typescript"
            >
              <i className="fas fa-code"></i> <u>T</u>ypescript
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="php"
            >
              <i className="fas fa-code"></i> <u>P</u>HP
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="python"
            >
              <i className="fas fa-code"></i> P<u>y</u>thon
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="rust"
            >
              <i className="fas fa-code"></i> <u>R</u>ust
            </button>
            <div className="dropdown-divider" />
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="json"
            >
              <i className="fas fa-code"></i> JS<u>O</u>N
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="yaml"
            >
              <i className="fas fa-code"></i> YA<u>M</u>L
            </button>
            <div className="dropdown-divider" />
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="sql"
            >
              <i className="fas fa-code"></i> S<u>Q</u>L
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="codeblock"
              data-language="xml"
            >
              <i className="fas fa-code"></i> <u>X</u>ML
            </button>
          </div>
        </div>
        <div
          className="dropup me-2"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title="Ctrl + L"
          data-key="L"
        >
          <button
            className="btn btn-sm btn-outline-secondary dropdown-toggle shortcut"
            type="button"
            id="alert-menu-button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i className="fas fa-exclamation-circle"></i>
          </button>
          <div
            className="dropdown-menu"
            id="alertblocks"
            aria-labelledby="alert-menu-button"
          >
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="primary"
            >
              <u>P</u>rimary
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="secondary"
            >
              S<u>e</u>condary
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="success"
            >
              <u>S</u>uccess
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="danger"
            >
              <u>D</u>anger
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="warning"
            >
              <u>W</u>arning
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="info"
            >
              <u>I</u>nformation
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="light"
            >
              <u>L</u>ight
            </button>
            <button
              className="dropdown-item md-editor-btn"
              data-cmd="alert"
              data-type="dark"
            >
              Da<u>r</u>k
            </button>
          </div>
        </div>
        <div className="btn-group btn-group-sm me-2">
          <button className="btn btn-outline-secondary" id="app-markdown-save">
            <i className="fas fa-save me-1"></i>
            <span className="d-none d-md-inline">Save</span>
            <span className="d-none d-lg-inline">Markdown</span>
          </button>
        </div>
        <div className="btn-group btn-group-sm me-2">
          <button
            className="btn btn-outline-secondary"
            id="export-preview-html"
          >
            <i className="fas fa-file-export me-1"></i>
            <small className="d-none d-md-inline">
              <span className="d-none d-md-inline">Export</span>
              <span className="d-none d-lg-inline">to HTML</span>
            </small>
          </button>
        </div>
        <div className="form-check">
          <input
            id="export-preview-styled"
            className="form-check-input me-2"
            type="checkbox"
            defaultChecked
          />
          <label
            className="form-check-label small text-muted"
            htmlFor="export-preview-styled"
          >
            <span className="d-none d-sm-inline d-md-none">styles</span>
            <span className="d-none d-md-inline">with styles</span>
          </label>
        </div>
      </div>
      <ul className="navbar-nav ms-auto">
        <li className="nav-item">
          <div
            className="form-check form-switch me-2"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            title="This switch is disabled on desktop if you are using your system theme."
          >
            <input
              type="checkbox"
              className="form-check-input"
              id="darkmode-setting"
            />
            <label
              className="form-check-label ms-1"
              htmlFor="darkmode-setting"
              id="darkmode-icon"
            >
              <i className="fas fa-moon"></i>
            </label>
          </div>
        </li>
      </ul>
    </nav>
  );
}
