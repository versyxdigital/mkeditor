import React from 'react';

export default function SubMenuBar() {
  return (
    <nav className="navbar navbar-expand navbar-light bg-light">
      <ul className="navbar-nav mr-auto">
        <li className="nav-item d-flex align-items-center gap-2">
          <img src="./icon.png" className="img-fluid app-logo-tiny ms-2" />
          <span id="active-file" className="text-muted">
            MKEditor
          </span>
        </li>
      </ul>
      <ul className="navbar-nav ms-auto">
        <li className="nav-item text-muted">
          <small>
            Character Count: <span id="character-count">0</span>
          </small>
          <span className="mx-1 font-weight-lighter">|</span>
          <small>
            Word Count: <span id="word-count">0</span>
          </small>
        </li>
        <li
          className="nav-item"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title="Modify your editor settings here."
        >
          <a
            className="text-muted hover-fade ms-3"
            href="#"
            data-bs-toggle="modal"
            data-bs-target="#app-settings"
          >
            <i className="fas fa-cog hover-fade"></i>
          </a>
        </li>
        <li
          className="nav-item"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          title="View all available editor shortcuts here."
        >
          <a
            className="text-muted hover-fade mx-3"
            href="#"
            data-bs-toggle="modal"
            data-bs-target="#app-shortcuts"
          >
            <i className="fa fa-question-circle hover-fade"></i>
          </a>
        </li>
      </ul>
    </nav>
  );
}
