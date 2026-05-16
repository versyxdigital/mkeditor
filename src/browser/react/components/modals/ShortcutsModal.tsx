import * as React from 'react';

import { useModals } from '../../contexts/ModalsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/**
 * Shortcuts reference modal. Pure data, no provider interaction.
 * Translated row labels come through `useTranslation`; the keyboard
 * combos themselves are hardcoded so they don't drift from
 * `editorCommands.ts` / `CommandProvider`.
 */
export const ShortcutsModal: React.FC = () => {
  const { open, closeModal } = useModals();
  const { t } = useTranslation();

  return (
    <Dialog
      open={open === 'shortcuts'}
      onOpenChange={(o) => !o && closeModal()}
    >
      <DialogContent
        className="small !max-w-[75vw]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('modals-shortcuts:title')}</DialogTitle>
        </DialogHeader>
        <div className="modal-body px-4 py-0 text-muted">
          <div className="row">
            <div className="col-6">
              <h6>{t('modals-shortcuts:basic_editing')}</h6>
              <ShortcutTable t={t} rows={basicEditing} />
            </div>
            <div className="col-6">
              <div className="row">
                <div className="col-12">
                  <h6>{t('modals-shortcuts:text_formatting')}</h6>
                  <ShortcutTable t={t} rows={textFormatting} />
                </div>
                <div className="col-12 mt-3">
                  <h6>{t('modals-shortcuts:search_and_replace')}</h6>
                  <ShortcutTable t={t} rows={searchAndReplace} />
                </div>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-12">
              <h6>{t('modals-shortcuts:multi_cursor_and_selection')}</h6>
              <ShortcutTable t={t} rows={multiCursor} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface ShortcutRow {
  keys: string;
  i18nKey: string;
}

const ShortcutTable: React.FC<{
  t: (key: string) => string;
  rows: ShortcutRow[];
}> = ({ t, rows }) => (
  <table className="table table-sm table-striped small">
    <thead>
      <tr>
        <th scope="col">{t('modals-shortcuts:table_header_shortcut')}</th>
        <th scope="col">{t('modals-shortcuts:table_header_description')}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.i18nKey}>
          <td>
            <strong>{row.keys}</strong>
          </td>
          <td>{t(row.i18nKey)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const basicEditing: ShortcutRow[] = [
  { keys: 'F1', i18nKey: 'modals-shortcuts:items.open_command_palette' },
  { keys: 'Ctrl + Z', i18nKey: 'modals-shortcuts:items.undo_last_edit' },
  { keys: 'Ctrl + Y', i18nKey: 'modals-shortcuts:items.redo_last_edit' },
  { keys: 'Ctrl + X', i18nKey: 'modals-shortcuts:items.cut_line_empty' },
  { keys: 'Ctrl + C', i18nKey: 'modals-shortcuts:items.copy_line_empty' },
  {
    keys: 'Ctrl + K, Ctrl + X',
    i18nKey: 'modals-shortcuts:items.trim_trailing_whitespace',
  },
  { keys: 'Alt + ↑ / ↓', i18nKey: 'modals-shortcuts:items.move_line_up_down' },
  {
    keys: 'Shift + Alt + ↑ / ↓',
    i18nKey: 'modals-shortcuts:items.copy_line_up_down',
  },
  { keys: 'Ctrl + Shift + K', i18nKey: 'modals-shortcuts:items.delete_line' },
  { keys: 'Ctrl + Enter', i18nKey: 'modals-shortcuts:items.insert_line_below' },
  {
    keys: 'Ctrl + Shift + Enter',
    i18nKey: 'modals-shortcuts:items.insert_line_above',
  },
  {
    keys: 'Ctrl + ] / [',
    i18nKey: 'modals-shortcuts:items.indent_outdent_line',
  },
  {
    keys: 'Home / End',
    i18nKey: 'modals-shortcuts:items.go_to_beginning_end_line',
  },
  {
    keys: 'Ctrl + Home',
    i18nKey: 'modals-shortcuts:items.go_to_beginning_file',
  },
  { keys: 'Ctrl + End', i18nKey: 'modals-shortcuts:items.go_to_end_file' },
  {
    keys: 'Ctrl + ↑ / ↓',
    i18nKey: 'modals-shortcuts:items.scroll_line_up_down',
  },
  {
    keys: 'Alt + PgUp / PgDn',
    i18nKey: 'modals-shortcuts:items.scroll_page_up_down',
  },
];

const textFormatting: ShortcutRow[] = [
  { keys: 'Ctrl + B', i18nKey: 'modals-shortcuts:items.make_text_bold' },
  { keys: 'Ctrl + I', i18nKey: 'modals-shortcuts:items.make_text_italic' },
  { keys: 'Ctrl + G', i18nKey: 'modals-shortcuts:items.strikethrough_text' },
  { keys: 'Ctrl + 2', i18nKey: 'modals-shortcuts:items.create_unordered_list' },
  { keys: 'Ctrl + 3', i18nKey: 'modals-shortcuts:items.create_ordered_list' },
  { keys: 'Ctrl + H', i18nKey: 'modals-shortcuts:items.insert_link' },
  { keys: 'Ctrl + T', i18nKey: 'modals-shortcuts:items.insert_markdown_table' },
  { keys: 'Ctrl + K, _', i18nKey: 'modals-shortcuts:items.insert_codeblock' },
  { keys: 'Ctrl + L, _', i18nKey: 'modals-shortcuts:items.insert_alert_block' },
];

const searchAndReplace: ShortcutRow[] = [
  { keys: 'Ctrl + F', i18nKey: 'modals-shortcuts:items.find' },
  { keys: 'Ctrl + H', i18nKey: 'modals-shortcuts:items.replace' },
  {
    keys: 'F3 / Shift + F3',
    i18nKey: 'modals-shortcuts:items.find_next_previous',
  },
  {
    keys: 'Alt + Enter',
    i18nKey: 'modals-shortcuts:items.select_all_occurrences',
  },
  {
    keys: 'Alt + C / R / W',
    i18nKey: 'modals-shortcuts:items.toggle_case_regex_whole',
  },
];

const multiCursor: ShortcutRow[] = [
  { keys: 'Alt + Click', i18nKey: 'modals-shortcuts:items.insert_cursor' },
  {
    keys: 'Ctrl + Alt + ↑ / ↓',
    i18nKey: 'modals-shortcuts:items.insert_cursor_above_below',
  },
  {
    keys: 'Shift + Alt + I',
    i18nKey: 'modals-shortcuts:items.insert_cursor_end_each_line',
  },
  { keys: 'Ctrl + L', i18nKey: 'modals-shortcuts:items.select_current_line' },
  {
    keys: 'Ctrl + F2',
    i18nKey: 'modals-shortcuts:items.select_all_occurrences_current_word',
  },
  {
    keys: 'Shift + Alt + (Drag mouse)',
    i18nKey: 'modals-shortcuts:items.column_selection',
  },
  {
    keys: 'Ctrl + Shift + Alt + ↑ / ↓',
    i18nKey: 'modals-shortcuts:items.column_selection',
  },
  {
    keys: 'Ctrl + Shift + Alt + PgUp / PgDn',
    i18nKey: 'modals-shortcuts:items.column_selection',
  },
  {
    keys: '(Mousewheel pressed + drag cursor)',
    i18nKey: 'modals-shortcuts:items.column_selection_mousewheel',
  },
];
