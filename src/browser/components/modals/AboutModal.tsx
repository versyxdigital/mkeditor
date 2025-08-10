import React from 'react';

export default function AboutModal() {
  return (
    <div className="modal" tabIndex={-1} id="app-about">
      <div className="modal-dialog">
        <div className="modal-content text-center p-3">
          <div className="text-muted modal-body small">
            <img src="./icon.png" className="img-fluid app-logo mb-3" />
            <p>
              Version <span id="app-version"></span>
            </p>
            <p>
              Built with love by{' '}
              <a
                className="fw-bold text-primary text-decoration-none"
                href="https://versyx.dev"
                target="_blank"
              >
                Versyx Digital
              </a>
              .
            </p>
            <p className="mb-1">
              MKEditor uses the following open-source libraries:
            </p>
            <p>
              monaco, bootstrap, fontawesome, markdown-it, highlight.js,
              split.js, sweetalert2, webpack and electron.
            </p>
            <p className="mb-0">
              View the source code{' '}
              <a
                className="fw-bold text-primary text-decoration-none"
                href="https://github.com/versyxdigital/mkeditor"
                target="_blank"
              >
                here
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
