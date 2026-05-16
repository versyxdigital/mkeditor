/**
 * Shared DOM constants still referenced by non-React code paths:
 *   - `dom.editor.dom`     test fallback for EditorManager.create()
 *   - `dom.preview.wrapper`  ScrollSync (line-number-based scroll alignment)
 *   - `dom.preview.dom`     HTMLExporter (`outerHTML`) and
 *                           ExportSettingsProvider (live preview styling)
 *   - `dom.meta.scroll.*`   ScrollSync + HTMLExporter + LineNumber markdown
 *                           extension — agreed attribute/class names
 *
 * Phase 9 emptied everything else: splash/fade helpers moved to
 * `splash.ts`; Bootstrap-backed `refreshTooltips()` was dropped (tooltips
 * are now shadcn `<Tooltip>` components); all modal/settings/button
 * selectors were pruned in earlier phases.
 */
export const dom = {
  editor: {
    dom: <HTMLDivElement>document.querySelector('#editor'),
  },
  preview: {
    get wrapper(): HTMLDivElement {
      return document.querySelector('#preview') as HTMLDivElement;
    },
    get dom(): HTMLDivElement {
      return document.querySelector('#preview-content') as HTMLDivElement;
    },
  },
  meta: {
    scroll: {
      line: {
        class: 'has-line-data',
        start: 'data-line-start',
        end: 'data-line-end',
      },
    },
  },
};
