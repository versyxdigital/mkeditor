import * as React from 'react';
import { createPortal } from 'react-dom';
import type { GroupImperativeHandle } from 'react-resizable-panels';

import { HTMLExporter } from '../../core/HTMLExporter';
import { exportSettings as exportSettingsDefaults } from '../../config';
import { alertblocks, codeblocks } from '../../core/mappings/editorCommands';
import type { ToolbarDropdownKey } from '../../core/providers/CommandProvider';
import { dom } from '../../dom';
import { useManagers } from '../contexts/ManagersContext';
import { useModals } from '../contexts/ModalsContext';
import { useTranslation } from '../hooks/useTranslation';
import { Icon } from './Icon';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface EditorToolbarProps {
  /** Shared with <Workspace>; used by the split-reset button. */
  workspaceGroupRef: React.RefObject<GroupImperativeHandle | null>;
}

/**
 * The `#editor-functions` toolbar. Phase 9 swapped Bootstrap btn classes
 * for the shadcn `<Button>` primitive and Bootstrap utility classes for
 * Tailwind equivalents.
 *
 * Rendered via `createPortal` into the static `<div id="editor-functions">`
 * host inside the bottom `<nav>` shell in views/index.html.
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  workspaceGroupRef,
}) => {
  const { mode, editorManager, bridgeManager, providers } = useManagers();
  const { openModal } = useModals();
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

  const openExportSettingsModal = () => openModal('exportSettings');
  const handleDelete = () => editorManager.resetContent();

  // Find the host once; we render via createPortal into the static
  // `<div id="editor-functions">`.
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(document.getElementById('editor-functions'));
  }, []);
  if (!host) return null;

  const content = (
    <div className="flex items-center gap-1">
      <ToolbarButton
        title={t('toolbar:reset_split')}
        onClick={handleResetSplit}
      >
        <Icon name="table-columns" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton title={t('toolbar:bold_tooltip')} onClick={inline('**')}>
        <Icon name="bold" />
      </ToolbarButton>
      <ToolbarButton title={t('toolbar:italic_tooltip')} onClick={inline('_')}>
        <Icon name="italic" />
      </ToolbarButton>
      <ToolbarButton
        title={t('toolbar:strikethrough_tooltip')}
        onClick={inline('~~')}
      >
        <Icon name="strikethrough" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        title={t('toolbar:unordered_list_tooltip')}
        onClick={() => {
          providers.commands?.unorderedList();
          editorManager.getMkEditor()?.focus();
        }}
      >
        <Icon name="list-ul" />
      </ToolbarButton>
      <ToolbarButton
        title={t('toolbar:ordered_list_tooltip')}
        onClick={() => {
          providers.commands?.orderedList();
          editorManager.getMkEditor()?.focus();
        }}
      >
        <Icon name="list-ol" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton
        title={t('toolbar:insert_link_tooltip')}
        onClick={inline('[]()')}
      >
        <Icon name="link" />
      </ToolbarButton>

      {/* Tables Popover */}
      <Popover
        open={openDropdown === 'tables'}
        onOpenChange={(open) => setOpenDropdown(open ? 'tables' : null)}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title={t('toolbar:table_menu_tooltip')}
            className="h-8 w-8 p-0"
          >
            <Icon name="table" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top">
          <div className="mb-3">
            <Label htmlFor="table-rows" className="mb-1 block">
              {t('menus-tables:rows_label')}
            </Label>
            <Input
              id="table-rows"
              type="number"
              min={1}
              value={tableRows}
              onChange={(e) =>
                setTableRows(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
            />
          </div>
          <div className="mb-3">
            <Label htmlFor="table-cols" className="mb-1 block">
              {t('menus-tables:columns_label')}
            </Label>
            <Input
              id="table-cols"
              type="number"
              min={1}
              value={tableCols}
              onChange={(e) =>
                setTableCols(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={insertTable}
          >
            {t('menus-tables:insert_table')}
          </Button>
        </PopoverContent>
      </Popover>

      {/* Codeblocks menu.
          Uses Popover (not DropdownMenu) because Radix's DropdownMenu
          doesn't expose `onOpenAutoFocus` on its public types — its
          `MenuRootContentTypeProps` omits the focus-private impl props.
          We need Radix to NOT steal focus when the menu opens so the
          second chord key (e.g. Ctrl+K → J) keeps flowing to Monaco's
          chord registration. */}
      <Popover
        open={openDropdown === 'codeblocks'}
        onOpenChange={(open) => setOpenDropdown(open ? 'codeblocks' : null)}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title={t('toolbar:codeblock_menu_tooltip')}
            className="h-8 w-8 p-0"
          >
            <Icon name="code" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {codeblocks.map((block, idx) => (
            <React.Fragment key={block.type}>
              <MenuItem onClick={insertCodeblock(block.type.toLowerCase())}>
                <Icon name={block.type === 'Sh' ? 'terminal' : 'code'} />
                <span>
                  {highlightChord(block.label ?? block.type, block.key)}
                </span>
              </MenuItem>
              {(idx === 0 || idx === 6 || idx === 8) && (
                <div className="my-1 border-t border-border" />
              )}
            </React.Fragment>
          ))}
        </PopoverContent>
      </Popover>

      {/* Alertblocks menu — see codeblocks above for the Popover rationale. */}
      <Popover
        open={openDropdown === 'alertblocks'}
        onOpenChange={(open) => setOpenDropdown(open ? 'alertblocks' : null)}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title={t('toolbar:alert_menu_tooltip')}
            className="h-8 w-8 p-0"
          >
            <Icon name="exclamation-circle" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {alertblocks.map((block) => (
            <MenuItem
              key={block.type}
              onClick={insertAlert(block.type.toLowerCase())}
            >
              {highlightChord(block.label ?? block.type, block.key)}
            </MenuItem>
          ))}
        </PopoverContent>
      </Popover>

      <Separator />

      <ToolbarButton
        title={t('toolbar:save_markdown_file')}
        onClick={handleSave}
      >
        <Icon name="save" />
      </ToolbarButton>

      {mode === 'web' && (
        <ToolbarButton
          title={t('toolbar:delete_markdown_file')}
          onClick={handleDelete}
        >
          <Icon name="trash" />
        </ToolbarButton>
      )}

      <ToolbarButton
        title={t('toolbar:configure_export_settings')}
        onClick={openExportSettingsModal}
      >
        <Icon name="sliders" />
      </ToolbarButton>

      <Button
        type="button"
        size="sm"
        variant="outline"
        title={t('toolbar:export_html_tooltip')}
        onClick={handleExport('html')}
        className="h-8 gap-1"
      >
        <Icon name="file-export" />
        <span className="text-xs">
          <span className="hidden md:inline">
            {t('toolbar:export_to_prefix')}
          </span>
          {t('toolbar:export_html_label')}
        </span>
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        title={t('toolbar:export_pdf_tooltip')}
        onClick={handleExport('pdf')}
        className="h-8 gap-1"
      >
        <Icon name="file-pdf" />
        <span className="text-xs">
          <span className="hidden md:inline">
            {t('toolbar:export_to_prefix')}
          </span>
          {t('toolbar:export_pdf_label')}
        </span>
      </Button>
    </div>
  );

  return createPortal(content, host);
};

/* -------------------------------------------------------------------- */
/*  Local helpers                                                        */
/* -------------------------------------------------------------------- */

const ToolbarButton: React.FC<{
  title: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
}> = ({ title, onClick, children }) => (
  <Button
    type="button"
    size="sm"
    variant="outline"
    title={title}
    onClick={onClick}
    className="h-8 w-8 p-0"
  >
    {children}
  </Button>
);

const Separator: React.FC = () => (
  <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
);

const MenuItem: React.FC<{
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  children: React.ReactNode;
}> = ({ onClick, children }) => (
  <button
    type="button"
    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground"
    onClick={onClick}
  >
    {children}
  </button>
);

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
