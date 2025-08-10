import React from 'react';

export default function ShortcutsModal() {
  return (
    <div className="modal" tabIndex={-1} id="app-shortcuts">
      <div className="modal-dialog mw-100 w-75" role="document">
        <div className="modal-content">
          <div className="modal-header border-bottom-0">
            <h5 className="modal-title">MKEditor Shortcuts</h5>
            <button
              type="button"
              className="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
            />
          </div>
          <div className="modal-body px-4 py-0">
            <div className="row">
              <div className="col-6">
                <h6>Basic Editing</h6>
                <table className="table table-sm table-striped small">
                  <thead>
                    <tr>
                      <th scope="col">Shortcut</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Ctrl + X</strong>
                      </td>
                      <td>Cut line (empty selection)</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + C</strong>
                      </td>
                      <td>Copy line (empty selection)</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Alt + ↑ / ↓</strong>
                      </td>
                      <td>Move line up/down</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Shift + Alt + ↑ / ↓</strong>
                      </td>
                      <td>Copy line up/down</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Shift + K</strong>
                      </td>
                      <td>Delete line</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Enter</strong>
                      </td>
                      <td>Insert line below</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Shift + Enter</strong>
                      </td>
                      <td>Insert line above</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + ] / [</strong>
                      </td>
                      <td>Indent/outdent line</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Home / End</strong>
                      </td>
                      <td>Go to beginning/end of line</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Home</strong>
                      </td>
                      <td>Go to beginning of file</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + End</strong>
                      </td>
                      <td>Go to end of file</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + ↑ / ↓</strong>
                      </td>
                      <td>Scroll line up/down</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Alt + PgUp / PgDn</strong>
                      </td>
                      <td>Scroll page up/down</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="col-6">
                <div className="row">
                  <div className="col-12">
                    <h6>Text Formatting</h6>
                    <table className="table table-sm table-striped small">
                      <thead>
                        <tr>
                          <th scope="col">Shortcut</th>
                          <th scope="col">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <strong>Ctrl + B</strong>
                          </td>
                          <td>Make text bold</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Ctrl + I</strong>
                          </td>
                          <td>Make text italic</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Ctrl + G</strong>
                          </td>
                          <td>Strikethrough text</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Ctrl + 1</strong>
                          </td>
                          <td>Create unordered list</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Ctrl + 2</strong>
                          </td>
                          <td>Create ordered list</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="col-12 mt-3">
                    <h6>Search and Replace</h6>
                    <table className="table table-sm table-striped small">
                      <thead>
                        <tr>
                          <th scope="col">Shortcut</th>
                          <th scope="col">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <strong>Ctrl + F</strong>
                          </td>
                          <td>Find</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Ctrl + H</strong>
                          </td>
                          <td>Replace</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>F3 / Shift + F3</strong>
                          </td>
                          <td>Find next/previous</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Alt + Enter</strong>
                          </td>
                          <td>Select all occurrences of find match</td>
                        </tr>
                        <tr>
                          <td>
                            <strong>Alt + C / R / W</strong>
                          </td>
                          <td>Toggle case-sensitive / regex / whole word</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-12">
                <h6>Multi-cursor and selection</h6>
                <table className="table table-sm table-striped small">
                  <thead>
                    <tr>
                      <th scope="col">Shortcut</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Alt + Click</strong>
                      </td>
                      <td>Insert cursor</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Alt + ↑ / ↓</strong>
                      </td>
                      <td>Insert cursor above/below</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Shift + Alt + I</strong>
                      </td>
                      <td>Insert cursor at end of each line selected</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + L</strong>
                      </td>
                      <td>Select current line</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + F2</strong>
                      </td>
                      <td>Select all occurrences of current word</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Shift + Alt + (Drag mouse)</strong>
                      </td>
                      <td>Column (box) selection</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Shift + Alt + ↑ / ↓</strong>
                      </td>
                      <td>Column (box) selection</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Ctrl + Shift + Alt + PgUp / PgDn</strong>
                      </td>
                      <td>Column (box) selection</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>(Mousewheel pressed + drag cursor)</strong>
                      </td>
                      <td>Column (box) selection</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
