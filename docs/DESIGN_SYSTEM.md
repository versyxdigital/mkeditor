# MKEditor visual design system

The interface follows the supplied document-first design: neutral paper and charcoal surfaces, restrained teal brand accents, system UI fonts, compact controls, and quiet navigation. Document reading and writing take priority over application chrome.

## Sources of truth

- [designTokens.ts](../src/app/shared/designTokens.ts) defines light/dark palettes and new-document defaults. [designSystem.ts](../src/browser/designSystem.ts) generates CSS variables, including the 4px spacing scale, geometry and motion tokens. These are injected before React mounts.
- [tailwind.css](../src/browser/react/styles/tailwind.css) maps those semantic variables to shared Tailwind colours and geometry. Declare theme-dependent aliases at both `:root` and `[data-theme='dark']` so inherited variables resolve against the correct palette.
- [editorTheme.ts](../src/browser/core/editorTheme.ts) applies the same surfaces, cursor, selection and widget colours to Monaco, inheriting its language token rules. Editor defaults are 14px / 1.65 with 24px vertical padding; no font-family override is imposed.
- [markdownStyles.ts](../src/browser/markdownStyles.ts) remains the shared preview/export stylesheet. Body text defaults to 16px / 1.7; heading sizes are 30/24/20/17/15/14px at that size. Paragraphs, lists, code, quotes and tables share a consistent vertical rhythm. Normal links remain underlined. Code syntax colours retain their semantic highlighting.

## Geometry and interaction

The primary toolbar is 44px high, document tabs 36px, and the combined formatting/status footer 38px. Word/character counts share the footer with formatting, theme and version controls; counts and export text labels hide progressively at narrow widths to retain usable controls. Formatting controls use quiet 30px buttons; standard buttons are 32px, compact buttons 28px, inputs/selects 34px, file rows 30px and menu items at least 32px. Radii are 4px for small controls, 6px for buttons/inputs, 8px for floating menus and 10px for dialogs.

The assistant keeps its model and thinking choices below the message input as borderless 24px dropdowns with accessible labels. Settings uses side navigation for the existing preference categories. Provider cards pair model/thinking fields, show enabled and key configuration feedback, and report connection results only after a test. Connection results reset when the tested configuration changes. Stored key values never populate the renderer.

The message input grows with typed, pasted and restored drafts, up to 160px or 30% of the chat pane. A compact expand/collapse control below it opens a larger writing area, up to 480px or 60% of the pane; overflow uses the assistant's thin scrollbar. Width and window-height changes reflow the input while retaining the draft and selection. Editing at the end keeps the caret visible; resizing alone preserves the reading scroll position. Sending returns it to compact mode. Enter sends, Shift+Enter inserts a newline, and IME/mention-picker handling remains unchanged.

Dialogs share a continuous sidebar-toned surface, including Settings and export preferences. Settings cards sit one tonal step above it. Shared inputs, selects and outline buttons use the editor surface and soft default borders throughout the application, including the assistant's New chat button, composer and rename field. Keep the teal focus ring; avoid dark inset fields and bright outlines against a lighter content panel. Define this styling in the shared primitives so new dialogs inherit it.

Keep `text-on-accent` (text on filled primary buttons) separate from Tailwind's `accent-foreground` (text on hover/selection surfaces). The latter must resolve to normal foreground text, especially in dark mode; redefining it in the palette makes selected chat titles and menu items unreadable.

Filled actions use `accent-fill`/`accent-fill-hover` with white labels in both themes. Keep this deeper teal separate from the brighter dark-theme `accent-primary` used for links, focus and indicators. Chat bubbles and checked checkboxes use the same fill/foreground pair.

Tool calls use neutral cards with compact, keyboard-accessible disclosure headers, target paths and small status indicators. Arguments and results wrap long lines in place; large payloads use character/line-limited excerpts and explicit expansion instead of nested scrollbars. The surrounding chat owns scrolling. Inline write confirmation and editor diff navigation retain their existing approval behaviour.

Explorer, assistant and Settings scroll regions, the main Monaco editor and Monaco change previews use slim 6px scrollbars with transparent tracks and rounded thumbs. Monaco uses its scrollbar options for sizing; native regions share the `thin-scrollbars` class. Plain text previews wrap instead of scrolling sideways. While a response is running, the composer shows a 32px Stop control with a filled square icon, an accessible name and a hover title. Hover and keyboard focus add a subtle red tint; avoid a solid red button with a dark label.

The explorer starts at 240px and resizes between 180px and 360px, with the existing collapse control retained. The assistant remains independently resizable. Preview padding adapts from 24px in narrow panes to 48px in larger panes. The constrained document container is 760px wide; a saved full-width preference still takes precedence. Settings forms become a single column on smaller windows, and dialogs and menus scroll within the available viewport.

Panel separators remain subtle, with usable pointer targets and keyboard focus. Shared controls have visible focus states; file rows support Tab plus Enter/Space. Hover transitions take approximately 120ms. Reduced-motion preferences suppress decorative transitions and make the startup reveal immediate. No remote interface font or new styling framework is required.

## Preference compatibility and accessibility

Only new or missing settings receive the new defaults. Existing document size, line spacing, container, export colours, wrapping, minimap, theme selection and system-theme preference are preserved. Preview/export typography is shared; exported body colours still come from the user's export settings rather than inheriting application chrome.

Primary/secondary text and interactive accents target WCAG AA contrast. Panel and field borders use the soft `border-default` token. Clear labels, tonal fills and teal focus rings distinguish fields and outline buttons. The stronger `border-control` token remains available for small controls such as checkboxes; dialogs soften their local `input` alias to match the surrounding form. Tertiary `text-muted` is reserved for secondary graphics such as scrollbar thumbs; normal UI supporting text and editor line numbers use the more readable `text-secondary`. Status feedback uses shared success, warning and error tokens.

Contrast regression tests cover the primary/secondary text pairs, link/button accents and control boundaries using the [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) thresholds. They do not constitute an accessibility certification of every application state.

Verify both themes, a narrow desktop viewport, editor/preview resizing, saved appearance preferences, keyboard operation, AI model/thinking dropdowns, and styled/unstyled exports when changing these foundations. Keep browser screenshots and interaction checks alongside unit checks during review; jsdom does not prove rendered CSS or Monaco geometry.
