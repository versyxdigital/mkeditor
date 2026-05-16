import * as React from 'react';
import { createPortal } from 'react-dom';
import { Modal } from 'bootstrap';
import type { GroupImperativeHandle } from 'react-resizable-panels';

import { HTMLExporter } from '../../core/HTMLExporter';
import { exportSettings as exportSettingsDefaults } from '../../config';
import { alertblocks, codeblocks } from '../../core/mappings/editorCommands';
import type { ToolbarDropdownKey } from '../../core/providers/CommandProvider';
import { dom } from '../../dom';
import { useManagers } from '../contexts/ManagersContext';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface EditorToolbarProps {
  /** Shared with <Workspace>; used by the split-reset button. */
  workspaceGroupRef: React.RefObject<GroupImperativeHandle | null>;
}

/**
 * The `#editor-functions` toolbar. Phase 6 replaces the legacy static
 * markup (with Bootstrap dropdowns/popover and DOM-bound click handlers)
 * with this React component.
 *
 * Rendered via `createPortal` into the legacy `<div id="editor-functions">`
 * that remains in views/index.html. The bottom `<nav>` shell and its
 * right-side `<ul>` (darkmode toggle + build chip) stay legacy until a
 * later phase per the doc's Phase 6 scope.
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  workspaceGroupRef,
}) => {
  const { mode, editorManager, bridgeManager, providers } = useManagers();
  const { t } = useTranslation();

  // Controlled open state for the alert/code/table popups. Shared across
  // the three so only one is open at a time and CommandProvider can drive
  // them via setOpenDropdown for chord keybindings.
  const [openDropdown, setOpenDropdown] =
    React.useState<ToolbarDropdownKey | null>(null);

  // Table-form local state. Kept in React rather than DOM (Phase 6
  // removed `dom.commands.forms.tables.{rows,cols}.value`).
  const [tableRows, setTableRows] = React.useState(2);
  const [tableCols, setTableCols] = React.useState(2);

  // Register the dropdown open-state setter with CommandProvider so that
  // Monaco keybindings (Ctrl+L / Ctrl+K / Ctrl+T) can open the right
  // dropdown, and chord actions (Ctrl+L → P etc.) can close it again
  // after inserting. providers.commands is null on initial mount; the
  // ManagersContext refresh after onEditorReady triggers a re-render so
  // this effect re-runs against the live provider.
  React.useEffect(() => {
    const commands = providers.commands;
    if (!commands) return;
    commands.setOpenDropdown(setOpenDropdown);
    return () => commands.setOpenDropdown(null);
  }, [providers.commands]);

  const handleResetSplit = () =>
    workspaceGroupRef.current?.setLayout({
      'editor-pane': 50,
      'preview-pane': 50,
    });

  const inline = (syntax: string) => () => {
    providers.commands?.editInline(syntax);
    editorManager.getMkEditor()?.focus();
  };

  const insertCodeblock = (language: string) => () => {
    providers.commands?.codeblock(language);
    setOpenDropdown(null);
    editorManager.getMkEditor()?.focus();
  };

  const insertAlert = (type: string) => () => {
    providers.commands?.alert(type);
    setOpenDropdown(null);
    editorManager.getMkEditor()?.focus();
  };

  const insertTable = () => {
    providers.commands?.table(tableCols, tableRows);
    setOpenDropdown(null);
    editorManager.getMkEditor()?.focus();
  };

  const buildExportHtml = () => {
    const settings =
      providers.exportSettings?.getSettings() ?? exportSettingsDefaults;
    return HTMLExporter.generateHTML(dom.preview.dom.outerHTML, settings);
  };

  const handleSave = () => {
    if (mode === 'desktop' && bridgeManager) {
      bridgeManager.saveContentToFile();
    } else {
      HTMLExporter.webExport(editorManager.getValue(), 'text/plain', '.md');
    }
  };

  const handleExport = (type: 'html' | 'pdf') => () => {
    const content = buildExportHtml();
    if (mode === 'desktop' && bridgeManager) {
      bridgeManager.exportToDifferentFormat({ content, type });
    } else {
      HTMLExporter.webExport(
        content,
        'text/html',
        type === 'pdf' ? '.pdf' : '.html',
      );
    }
  };

  const openExportSettingsModal = () => {
    const el = document.getElementById('export-settings');
    if (el) Modal.getOrCreateInstance(el).show();
  };

  const handleDelete = () => editorManager.resetContent();

  // Find the host once; we render via createPortal into the legacy
  // `<div id="editor-functions">` so the bottom <nav> shell (with the
  // right-side legacy <ul>) stays as-is.
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(document.getElementById('editor-functions'));
  }, []);
  if (!host) return null;

  const content = (
    <>
      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:reset_split')}
          onClick={handleResetSplit}
        >
          <Icon name="table-columns" />
        </button>
      </div>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:bold_tooltip')}
          onClick={inline('**')}
        >
          <Icon name="bold" />
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:italic_tooltip')}
          onClick={inline('_')}
        >
          <Icon name="italic" />
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:strikethrough_tooltip')}
          onClick={inline('~~')}
        >
          <Icon name="strikethrough" />
        </button>
      </div>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:unordered_list_tooltip')}
          onClick={() => {
            providers.commands?.unorderedList();
            editorManager.getMkEditor()?.focus();
          }}
        >
          <Icon name="list-ul" />
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:ordered_list_tooltip')}
          onClick={() => {
            providers.commands?.orderedList();
            editorManager.getMkEditor()?.focus();
          }}
        >
          <Icon name="list-ol" />
        </button>
      </div>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary shortcut"
          title={t('toolbar:insert_link_tooltip')}
          onClick={inline('[]()')}
        >
          <Icon name="link" />
        </button>
      </div>

      {/* Tables Popover */}
      <Popover
        open={openDropdown === 'tables'}
        onOpenChange={(open) => setOpenDropdown(open ? 'tables' : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary shortcut me-2"
            title={t('toolbar:table_menu_tooltip')}
          >
            <Icon name="table" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top">
          <div className="mb-3">
            <label className="mb-2 small">{t('menus-tables:rows_label')}</label>
            <input
              type="number"
              className="form-control form-control-sm"
              min={1}
              value={tableRows}
              onChange={(e) =>
                setTableRows(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
            />
          </div>
          <div className="mb-3">
            <label className="mb-2 small">
              {t('menus-tables:columns_label')}
            </label>
            <input
              type="number"
              className="form-control form-control-sm"
              min={1}
              value={tableCols}
              onChange={(e) =>
                setTableCols(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={insertTable}
          >
            {t('menus-tables:insert_table')}
          </button>
        </PopoverContent>
      </Popover>

      {/* Codeblocks menu.
          Uses Popover (not DropdownMenu) because Radix's DropdownMenu
          doesn't expose `onOpenAutoFocus` on its public types — its
          `MenuRootContentTypeProps` omits the focus-private impl props.
          We need Radix to NOT steal focus when the menu opens so the
          second chord key (e.g. Ctrl+K → J) keeps flowing to Monaco's
          chord registration. Popover exposes `onOpenAutoFocus`. We
          lose `role="menu"` semantics; the menu is click-driven anyway. */}
      <Popover
        open={openDropdown === 'codeblocks'}
        onOpenChange={(open) => setOpenDropdown(open ? 'codeblocks' : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary shortcut me-2"
            title={t('toolbar:codeblock_menu_tooltip')}
          >
            <Icon name="code" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {codeblocks.map((block, idx) => (
            <React.Fragment key={block.type}>
              <button
                type="button"
                className="dropdown-item md-editor-btn"
                onClick={insertCodeblock(block.type.toLowerCase())}
              >
                <Icon name={block.type === 'Sh' ? 'terminal' : 'code'} />{' '}
                {highlightChord(block.label ?? block.type, block.key)}
              </button>
              {(idx === 0 || idx === 6 || idx === 8) && (
                <div className="dropdown-divider" />
              )}
            </React.Fragment>
          ))}
        </PopoverContent>
      </Popover>

      {/* Alertblocks menu — see codeblocks above for the Popover
          rationale (chord Ctrl+L → X). */}
      <Popover
        open={openDropdown === 'alertblocks'}
        onOpenChange={(open) => setOpenDropdown(open ? 'alertblocks' : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary shortcut me-2"
            title={t('toolbar:alert_menu_tooltip')}
          >
            <Icon name="exclamation-circle" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {alertblocks.map((block) => (
            <button
              key={block.type}
              type="button"
              className="dropdown-item md-editor-btn"
              onClick={insertAlert(block.type.toLowerCase())}
            >
              {highlightChord(block.label ?? block.type, block.key)}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          title={t('toolbar:save_markdown_file')}
          onClick={handleSave}
        >
          <Icon name="save" />
        </button>
      </div>

      {mode === 'web' && (
        <div className="btn-group btn-group-sm me-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            title={t('toolbar:delete_markdown_file')}
            onClick={handleDelete}
          >
            <Icon name="trash" />
          </button>
        </div>
      )}

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          title={t('toolbar:configure_export_settings')}
          onClick={openExportSettingsModal}
        >
          <Icon name="sliders" />
        </button>
      </div>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          title={t('toolbar:export_html_tooltip')}
          onClick={handleExport('html')}
        >
          <Icon name="file-export" className="me-1" />
          <small>
            <span className="d-none d-md-inline">
              {t('toolbar:export_to_prefix')}
            </span>
            {t('toolbar:export_html_label')}
          </small>
        </button>
      </div>

      <div className="btn-group btn-group-sm me-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          title={t('toolbar:export_pdf_tooltip')}
          onClick={handleExport('pdf')}
        >
          <Icon name="file-pdf" className="me-1" />
          <small>
            <span className="d-none d-md-inline">
              {t('toolbar:export_to_prefix')}
            </span>
            {t('toolbar:export_pdf_label')}
          </small>
        </button>
      </div>
    </>
  );

  return createPortal(content, host);
};

/**
 * Underline the first character in `text` that case-insensitively
 * matches `key`. Mirrors the legacy `<u>...</u>` markup that hinted at
 * chord shortcuts (e.g. `<u>P</u>rimary` for Ctrl+L → P).
 */
function highlightChord(text: string, key: string): React.ReactNode {
  const idx = text.toUpperCase().indexOf(key.toUpperCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <u>{text.charAt(idx)}</u>
      {text.slice(idx + 1)}
    </>
  );
}
